// Putting game events on recordings when the game and OBS run on different
// computers.
//
// Every open copy of the app measures how far its computer's clock is from
// the Supabase server clock (clock samples). Game times from the addon are
// in the gaming PC's clock; recording times from the Mac are converted to the
// server clock when they are saved. Converting game times with the gaming
// PC's offset puts everything on one clock. A sync flash then corrects the
// small remaining error (capture delay) exactly.

import { describe, category } from './describe.js';

// Clock samples: [{ machine, offset_ms, measured_at (ISO or ms) }].
// Returns a function (machine, localMs) -> offset in ms to add.
export function clockModel(samples = []) {
  const byMachine = new Map();
  for (const s of samples) {
    const at = typeof s.measured_at === 'number' ? s.measured_at : Date.parse(s.measured_at);
    if (!Number.isFinite(at) || !Number.isFinite(s.offset_ms)) continue;
    if (!byMachine.has(s.machine)) byMachine.set(s.machine, []);
    byMachine.get(s.machine).push({ at, offset: s.offset_ms });
  }
  for (const list of byMachine.values()) list.sort((a, b) => a.at - b.at);
  return (machine, localMs) => {
    const list = byMachine.get(machine);
    if (!list || !list.length) return 0;
    // Samples are stamped in server time; close enough to compare with
    // local time for picking neighbours, since offsets are small.
    let lo = 0;
    let hi = list.length - 1;
    if (localMs <= list[0].at) return list[0].offset;
    if (localMs >= list[hi].at) return list[hi].offset;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (list[mid].at <= localMs) lo = mid; else hi = mid;
    }
    const a = list[lo];
    const b = list[hi];
    // Interpolate between neighbours a few hours apart at most; beyond that
    // the clock may have been corrected in between, so take the nearest.
    if (b.at - a.at > 6 * 3600 * 1000) return localMs - a.at < b.at - localMs ? a.offset : b.offset;
    return a.offset + ((b.offset - a.offset) * (localMs - a.at)) / (b.at - a.at);
  };
}

// An event's time on the shared clock, in ms.
export function eventMs(session, e, clock) {
  const local = e.t * 1000;
  return local + (session.machine ? clock(session.machine, local) : 0);
}

const TOKENS = {
  '%CCYY': ['(\\d{4})', 'year'], '%YY': ['(\\d{2})', 'year2'], '%MM': ['(\\d{2})', 'month'],
  '%DD': ['(\\d{2})', 'day'], '%hh': ['(\\d{2})', 'hour'], '%mm': ['(\\d{2})', 'minute'], '%ss': ['(\\d{2})', 'second'],
};

// Local start time (ms) from an OBS file name, using OBS's Filename Formatting
// syntax. Local means the recording computer's own clock and time zone.
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
      const m = /^%[A-Za-z]+/.exec(pattern.slice(i));
      regex += '.*?';
      i += m ? m[0].length : 1;
    } else {
      regex += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const m = new RegExp(regex).exec(baseName(fileName));
  if (!m) return null;
  const v = {};
  fields.forEach((f, idx) => { v[f] = Number(m[idx + 1]); });
  const year = v.year ?? (v.year2 !== undefined ? 2000 + v.year2 : undefined);
  if (year === undefined || v.month === undefined || v.day === undefined) return null;
  const d = new Date(year, v.month - 1, v.day, v.hour ?? 0, v.minute ?? 0, v.second ?? 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

// Stable id for a recording, from its file name.
export function recordingId(name) {
  let h = 2166136261;
  for (const ch of String(name).toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Recording rows from the database -> recordings on the shared clock.
//
// Where a start time comes from, best first:
//   sync           a sync flash was lined up in this recording
//   sync-inferred  the correction measured by the nearest synced recording
//   obs            OBS reported the start while the app was open on the Mac
//   filename       the time in the file name (app was closed while recording)
export function resolveRecordings(rows = []) {
  const out = [];
  for (const row of rows) {
    // Skip macOS "._" companion files saved by earlier versions.
    if (!Number.isFinite(row.start_ms) || String(row.name).startsWith('.')) continue;
    const rawStart = row.start_ms;
    const duration = row.duration > 0 ? row.duration : Number.isFinite(row.end_ms) && row.end_ms > rawStart ? (row.end_ms - rawStart) / 1000 : null;
    if (!duration) continue;
    const synced = Number.isFinite(row.sync?.start_ms);
    const start = synced ? row.sync.start_ms : rawStart;
    out.push({
      id: recordingId(row.name), name: row.name, path: row.path ?? null, machine: row.machine ?? null,
      start, end: start + duration * 1000, duration, rawStart, rawSource: row.source ?? 'filename',
      source: synced ? 'sync' : row.source ?? 'filename', sync: row.sync ?? null,
    });
  }
  // The correction a sync flash measured (capture delay plus any clock error)
  // carries over to nearby recordings that were not flashed.
  const synced = out.filter((r) => r.source === 'sync');
  for (const r of out) {
    if (r.source === 'sync' || !synced.length) continue;
    let best = null;
    for (const s of synced) {
      if (!best || Math.abs(s.rawStart - r.rawStart) < Math.abs(best.rawStart - r.rawStart)) best = s;
    }
    if (Math.abs(best.rawStart - r.rawStart) > 3 * 24 * 3600 * 1000) continue;
    // Only carry over between recordings timed the same way.
    if ((best.rawSource === 'obs') !== (r.rawSource === 'obs')) continue;
    const shift = best.start - best.rawStart;
    r.start += shift;
    r.end += shift;
    r.source = 'sync-inferred';
    r.syncedFrom = best.name;
  }
  return out.sort((a, b) => a.start - b.start);
}

// Maps a shared-clock time (ms) to { recording, offset (s) } or null.
export function aligner(recordings) {
  const starts = recordings.map((r) => r.start);
  return (ms) => {
    let lo = 0;
    let hi = starts.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= ms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let i = idx; i >= 0 && i >= idx - 3; i--) {
      const r = recordings[i];
      if (ms >= r.start && ms <= r.end + 1000) return { recording: r, offset: Math.max(0, (ms - r.start) / 1000) };
    }
    return null;
  };
}

// Map<recordingId, event[]> with `session`, `ms`, `offset`, `label`, `cat`
// added to each event.
export function buildTimelines(sessions, recordings, clock) {
  const align = aligner(recordings);
  const byRec = new Map(recordings.map((r) => [r.id, []]));
  for (const s of sessions) {
    for (const e of s.events) {
      const ms = eventMs(s, e, clock);
      const hit = align(ms);
      if (!hit) continue;
      byRec.get(hit.recording.id).push({ ...e, session: s.id, ms, offset: hit.offset, label: describe(e), cat: category(e) });
    }
  }
  for (const list of byRec.values()) list.sort((a, b) => a.offset - b.offset);
  return byRec;
}
