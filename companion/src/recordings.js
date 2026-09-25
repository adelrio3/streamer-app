// Finds OBS recordings and works out the wall-clock span each one covers.
//
// Start time comes from OBS itself when the companion was connected while
// recording, otherwise from the file name (OBS names files after the moment
// recording started). End time is the file's last-modified time, which is when
// OBS stopped writing to it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.flv', '.ts', '.m4v', '.webm'];

const TOKENS = {
  '%CCYY': ['(\\d{4})', 'year'],
  '%YY': ['(\\d{2})', 'year2'],
  '%MM': ['(\\d{2})', 'month'],
  '%DD': ['(\\d{2})', 'day'],
  '%hh': ['(\\d{2})', 'hour'],
  '%mm': ['(\\d{2})', 'minute'],
  '%ss': ['(\\d{2})', 'second'],
};

// Reads the local start time out of a file name, using the same format string
// as OBS's Settings > Advanced > Recording > Filename Formatting.
export function startFromName(fileName, pattern = '%CCYY-%MM-%DD %hh-%mm-%ss') {
  const fields = [];
  let regex = '';
  for (let i = 0; i < pattern.length;) {
    const token = Object.keys(TOKENS).find((t) => pattern.startsWith(t, i));
    if (token) {
      regex += TOKENS[token][0];
      fields.push(TOKENS[token][1]);
      i += token.length;
    } else if (pattern[i] === '%') {
      // Other OBS specifiers (%FPS, %CRES...) become a lazy wildcard.
      const m = /^%[A-Za-z]+/.exec(pattern.slice(i));
      regex += '.*?';
      i += m ? m[0].length : 1;
    } else {
      regex += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const m = new RegExp(regex).exec(path.basename(fileName));
  if (!m) return null;
  const v = {};
  fields.forEach((f, idx) => { v[f] = Number(m[idx + 1]); });
  const year = v.year ?? (v.year2 !== undefined ? 2000 + v.year2 : undefined);
  if (year === undefined || v.month === undefined || v.day === undefined) return null;
  const d = new Date(year, v.month - 1, v.day, v.hour ?? 0, v.minute ?? 0, v.second ?? 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function recordingId(file) {
  return crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 12);
}

// All recordings, oldest first: { id, file, name, start, end, duration, source }.
// Times are epoch milliseconds on the game PC's clock.
//
// Where a recording's start comes from, best first:
//   sync           a sync flash was lined up in this recording
//   obs            the companion was connected to OBS when it started
//   sync-inferred  file name time, corrected by the clock gap measured by the
//                  nearest synced recording (recording on a second PC)
//   filename       the time in the file name
//   file-dates     the file's creation time
//
// overrides: { [lowercase file name]: { start?, duration? } } from the sync
// tool and from the browser reporting a video's real length.
export function scanRecordings(dir, { pattern, obsLog = [], overrides = {} } = {}) {
  // OBS on another PC reports its own paths (D:\Recordings\x.mkv) while this
  // PC sees a share or a copy, so fall back to matching by file name.
  const byPath = new Map();
  const byName = new Map();
  for (const entry of obsLog) {
    if (!entry.path) continue;
    byPath.set(path.resolve(entry.path).toLowerCase(), entry);
    byName.set(baseName(entry.path), entry);
  }
  const out = [];
  for (const file of listVideos(dir)) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    const name = path.basename(file);
    const obs = byPath.get(file.toLowerCase()) ?? byName.get(name.toLowerCase());
    let start = obs?.start ?? startFromName(file, pattern);
    let end = obs?.end ?? stat.mtimeMs;
    let source = obs?.start ? 'obs' : 'filename';
    if (start == null) {
      // No recognisable name: assume the file was created when recording began.
      start = stat.birthtimeMs && stat.birthtimeMs < end ? stat.birthtimeMs : null;
      source = 'file-dates';
    }
    if (start == null || end <= start) continue;
    const rawStart = start;
    const rawSource = source;
    let duration = (end - start) / 1000;
    const o = overrides[name.toLowerCase()];
    if (o?.duration > 0) duration = o.duration;
    if (o?.start != null) {
      start = o.start;
      source = 'sync';
    }
    out.push({
      id: recordingId(file), file, name, size: stat.size,
      start, end: start + duration * 1000, duration, source, rawSource, rawStart,
    });
  }
  // Recordings named by the recording PC's clock borrow the clock gap from
  // the nearest synced recording that was also named by that clock.
  const synced = out.filter((r) => r.source === 'sync' && r.rawSource !== 'obs');
  if (synced.length) {
    for (const r of out) {
      if (r.source !== 'filename' && r.source !== 'file-dates') continue;
      let best = null;
      for (const s of synced) {
        if (!best || Math.abs(s.rawStart - r.rawStart) < Math.abs(best.rawStart - r.rawStart)) best = s;
      }
      if (Math.abs(best.rawStart - r.rawStart) > INFER_WINDOW_MS) continue;
      const skew = best.start - best.rawStart;
      r.start += skew;
      r.end += skew;
      r.source = 'sync-inferred';
      r.syncedFrom = best.name;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// PC clocks drift, so a measured gap is only reused within a few days.
const INFER_WINDOW_MS = 3 * 24 * 3600 * 1000;

function baseName(p) {
  return String(p).split(/[\\/]/).pop().toLowerCase();
}

function listVideos(dir) {
  if (!dir) return [];
  const out = [];
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.resolve(d, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (e.isFile() && VIDEO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

// Given recordings sorted by start, returns a function mapping an event time
// (epoch seconds) to { recording, offset } where offset is seconds into the
// video, or null when nothing was recording.
export function aligner(recordings, clockOffset = 0) {
  const starts = recordings.map((r) => r.start);
  return (t) => {
    const ms = (t + clockOffset) * 1000;
    let lo = 0;
    let hi = starts.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= ms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    // Overlapping recordings (a replay buffer, a second output) are possible,
    // so look back a few files for one that covers the moment.
    for (let i = idx; i >= 0 && i >= idx - 3; i--) {
      const r = recordings[i];
      if (ms >= r.start && ms <= r.end + 1000) {
        return { recording: r, offset: Math.max(0, (ms - r.start) / 1000) };
      }
    }
    return null;
  };
}
