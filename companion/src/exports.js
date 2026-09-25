// Files for the edit, one set per recording:
//
//   .xml           Final Cut Pro 7 XML (xmeml). Premiere imports it as a
//                  sequence holding the recording with a marker per event.
//   .srt           Subtitles, one cue per event. Premiere imports these as a
//                  caption track, which is an easy way to see events on the
//                  timeline without any marker support.
//   .csv           Every event with its timecode, for spreadsheets or scripts.
//   chapters.txt   YouTube chapters from zone changes, for raw longplays.
//   kills.csv      Running kill counts per creature, for counter overlays.

import path from 'node:path';
import { describe, category, place } from './describe.js';
import { aligner } from './recordings.js';

// Events of every session placed onto recordings: Map<recordingId, event[]>.
// Each event gets `session`, `offset` (seconds into the video), `label`, `cat`.
export function buildTimelines(sessions, recordings, clockOffset = 0) {
  const align = aligner(recordings, clockOffset);
  const byRec = new Map(recordings.map((r) => [r.id, []]));
  for (const s of sessions) {
    for (const e of s.events) {
      const hit = align(e.t);
      if (!hit) continue;
      byRec.get(hit.recording.id).push({ ...e, session: s.id, offset: hit.offset, label: describe(e), cat: category(e) });
    }
  }
  for (const list of byRec.values()) list.sort((a, b) => a.offset - b.offset);
  return byRec;
}

export function timecode(seconds, { ms = false } = {}) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return ms ? `${base},${String(Math.floor((total % 1) * 1000)).padStart(3, '0')}` : base;
}

export function toSRT(events, cueSeconds = 3) {
  const cues = [];
  events.forEach((e, i) => {
    const next = events[i + 1];
    let end = e.offset + cueSeconds;
    if (next && next.offset > e.offset) end = Math.min(end, next.offset - 0.001);
    if (end <= e.offset) end = e.offset + 0.5;
    cues.push(`${cues.length + 1}\n${timecode(e.offset, { ms: true })} --> ${timecode(end, { ms: true })}\n${e.label}\n`);
  });
  return cues.join('\n');
}

const CSV_COLUMNS = ['timecode', 'seconds', 'type', 'category', 'description', 'zone', 'subzone', 'x', 'y', 'level', 'quest_id', 'npc_id', 'item_id', 'wall_clock'];

export function toCSV(events) {
  const rows = [CSV_COLUMNS];
  for (const e of events) {
    rows.push([
      timecode(e.offset), e.offset.toFixed(3), e.e, e.cat, e.label, e.z ?? '', e.sz ?? '', e.x ?? '', e.y ?? '', e.lvl ?? '',
      e.qid ?? '', e.npcId ?? '', e.e === 'loot' ? (e.id ?? '') : '', new Date(e.t * 1000).toISOString(),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// YouTube chapters need the first at 00:00, at least three, each 10s+ long.
export function toChapters(events, { minGap = 60 } = {}) {
  const chapters = [];
  for (const e of events) {
    if (!['session_start', 'zone'].includes(e.e) || !e.z) continue;
    const title = place(e);
    const last = chapters.at(-1);
    if (last && last.title === title) continue;
    if (last && e.offset - last.offset < minGap) {
      // Passed straight through; the later place is the one you stayed in.
      last.title = title;
      if (chapters.at(-2)?.title === title) chapters.pop();
      continue;
    }
    chapters.push({ offset: e.offset, title });
  }
  if (chapters.length === 0) return '';
  chapters[0].offset = 0;
  const lines = chapters.map((c) => `${timecode(c.offset)} ${c.title}`);
  if (chapters.length < 3) lines.push('', '# YouTube needs at least three chapters; add more before pasting.');
  return lines.join('\n') + '\n';
}

// One row per kill with the running count for that creature in this video,
// all kills in this video, and your lifetime count for that creature.
export function toKillsCSV(events, lifetimeBefore = new Map()) {
  const inVideo = new Map();
  const lifetime = new Map(lifetimeBefore);
  let total = 0;
  const rows = [['timecode', 'seconds', 'creature', 'npc_id', 'count_in_video', 'total_kills_in_video', 'lifetime_count']];
  for (const e of events) {
    if (e.e !== 'kill') continue;
    const key = e.npcId ?? e.name;
    inVideo.set(key, (inVideo.get(key) || 0) + 1);
    lifetime.set(key, (lifetime.get(key) || 0) + 1);
    total++;
    rows.push([timecode(e.offset), e.offset.toFixed(3), e.name ?? '', e.npcId ?? '', inVideo.get(key), total, lifetime.get(key)]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Kill counts per creature from every session before a given time.
export function lifetimeKillsBefore(sessions, t) {
  const counts = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.e === 'kill' && e.t < t) {
        const key = e.npcId ?? e.name;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

// Premiere marker colours can't be set from xmeml, so the category goes in
// the marker name where it is easy to filter on.
export function toFCPXML(recording, events, { fps = 60, width = 1920, height = 1080 } = {}) {
  const timebase = Math.round(fps);
  const ntsc = Math.abs(fps - timebase) > 0.001 ? 'TRUE' : 'FALSE'; // 59.94 is timebase 60, NTSC
  const frames = (sec) => Math.round(sec * fps);
  const duration = frames(recording.duration);
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const name = xml(recording.name);
  const markers = events.map((e) => [
    '<marker>',
    `<name>${xml(`[${e.cat}] ${e.label}`)}</name>`,
    `<comment>${xml(markerComment(e))}</comment>`,
    `<in>${frames(e.offset)}</in><out>-1</out>`,
    '</marker>',
  ].join('')).join('\n      ');
  const file = `<file id="file-1"><name>${name}</name><pathurl>${xml(fileURL(recording.file))}</pathurl>${rate}<duration>${duration}</duration>`
    + `<media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video>`
    + '<audio><channelcount>2</channelcount></audio></media></file>';
  const clip = (id, mediaFile, extra = '') => `<clipitem id="${id}"><name>${name}</name><duration>${duration}</duration>${rate}`
    + `<start>0</start><end>${duration}</end><in>0</in><out>${duration}</out>${mediaFile}${extra}</clipitem>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xml(`Chronicler - ${path.parse(recording.name).name}`)}</name>
    <duration>${duration}</duration>
    ${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></format>
        <track>${clip('clipitem-1', file)}</track>
      </video>
      <audio>
        <track>${clip('clipitem-2', '<file id="file-1"/>', '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>')}</track>
      </audio>
    </media>
      ${markers}
  </sequence>
</xmeml>
`;
}

function markerComment(e) {
  const bits = [place(e)];
  if (e.lvl) bits.push(`level ${e.lvl}`);
  if (e.x != null) bits.push(`${e.x}, ${e.y}`);
  if (e.e === 'quest_detail' && e.obj) bits.push(e.obj);
  if (e.e === 'speech' || e.e === 'gossip') bits.push(e.text ?? '');
  return bits.filter(Boolean).join(' | ');
}

// Premiere writes Windows paths as file://localhost/C%3a/Folder/My%20File.mkv
export function fileURL(file) {
  const normalized = file.replace(/\\/g, '/');
  const parts = normalized.split('/').map((part, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(part)) return `${part[0]}%3a`;
    return encodeURIComponent(part);
  });
  const joined = parts.join('/');
  return `file://localhost${joined.startsWith('/') ? '' : '/'}${joined}`;
}

function xml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pad(n) { return String(n).padStart(2, '0'); }
