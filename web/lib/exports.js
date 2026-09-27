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

import { place } from './describe.js';

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
    let end = e.until ?? e.offset + cueSeconds;
    if (e.until == null && next && next.offset > e.offset) end = Math.min(end, next.offset - 0.001);
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

// Kill counts per creature from every session before a given time (epoch
// ms on the shared clock). toMs converts an event of a session to that clock.
export function lifetimeKillsBefore(sessions, t, toMs = (s, e) => e.t * 1000) {
  const counts = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.e === 'kill' && toMs(s, e) < t) {
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
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const markers = events.map((e) => [
    '<marker>',
    `<name>${xml(`[${e.cat}] ${e.label}`)}</name>`,
    `<comment>${xml(markerComment(e))}</comment>`,
    `<in>${frames(e.offset)}</in><out>-1</out>`,
    '</marker>',
  ].join('')).join('\n      ');
  // A file (or the parts OBS split it into) laid on a track from `at`
  // frames, trimmed at its head when it began before the sequence.
  const fileXml = (fid, f, w, h, sound) => `<file id="${fid}"><name>${xml(f.name)}</name><pathurl>${xml(fileURL(f.path || f.name))}</pathurl>${rate}<duration>${frames(f.duration)}</duration>`
    + `<media><video><samplecharacteristics>${rate}<width>${w}</width><height>${h}</height></samplecharacteristics></video>`
    + (sound ? '<audio><channelcount>2</channelcount></audio>' : '') + '</media></file>';
  const lay = (parts, at, idPrefix, w, h, sound) => {
    const video = []; const audio = []; let end = 0;
    parts.forEach((p, i) => {
      const fid = `${idPrefix}f${i + 1}`;
      const dur = frames(p.duration);
      const off = at + frames(p.offset || 0);
      const start = Math.max(0, off); const inF = Math.max(0, -off);
      const clipEnd = start + (dur - inF);
      if (clipEnd <= start) return;
      end = Math.max(end, clipEnd);
      const item = (id, mediaFile, extra = '') => `<clipitem id="${id}"><name>${xml(p.name)}</name><duration>${dur}</duration>${rate}<start>${start}</start><end>${clipEnd}</end><in>${inF}</in><out>${dur}</out>${mediaFile}${extra}</clipitem>`;
      video.push(item(`${idPrefix}v${i + 1}`, fileXml(fid, p, w, h, sound)));
      if (sound) audio.push(item(`${idPrefix}a${i + 1}`, `<file id="${fid}"/>`, '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>'));
    });
    return { video: `<track>${video.join('')}</track>`, audio: audio.length ? `<track>${audio.join('')}</track>` : '', end };
  };
  const mainParts = recording.parts?.length ? recording.parts : [{ name: recording.name, path: recording.path, duration: recording.duration, offset: 0 }];
  const main = lay(mainParts, 0, 'clipitem-', width, height, true);
  // Companions (the camera's OBS file, the overlay video drawn from the
  // events) as their own tracks, placed by their start offset: a file that
  // began later starts later on the sequence, one that began earlier is
  // trimmed at its head. The overlay goes on the top track.
  const companions = (recording.companions || []).map((c, i) => {
    const parts = c.parts?.length ? c.parts : [{ name: c.name, path: c.path, duration: c.duration, offset: 0 }];
    return { role: c.role, ...lay(parts, frames(c.offset || 0), `clipitem-c${i + 1}`, c.width || width, c.height || height, c.role === 'cam') };
  });
  const seqDuration = Math.max(main.end, ...companions.map((c) => c.end));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xml(`Compendium - ${stem(recording.name)}`)}</name>
    <duration>${seqDuration}</duration>
    ${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></format>
        ${main.video}
        ${companions.map((c) => c.video).join('\n        ')}
      </video>
      <audio>
        ${main.audio}
        ${companions.map((c) => c.audio).filter(Boolean).join('\n        ')}
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

export function xml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// "2026-09-25 20-15-42.mkv" -> "2026-09-25 20-15-42"
export function stem(name) {
  return String(name).replace(/\.[^.\\/]+$/, '');
}

function pad(n) { return String(n).padStart(2, '0'); }

// A cut sequence for Premiere: clips laid end to end from one or more
// recordings, with markers. clips: [{ file: { id, name, path, duration },
// in, out }] in seconds; markers: [{ at, name, comment }] in sequence seconds.
export function toSequenceXML({ name, clips, markers = [], fps = 60, width = 1920, height = 1080, sourceWidth = 1920, sourceHeight = 1080 }) {
  const timebase = Math.round(fps);
  const ntsc = Math.abs(fps - timebase) > 0.001 ? 'TRUE' : 'FALSE';
  const frames = (sec) => Math.round(sec * fps);
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const files = new Map();
  const fileXml = (f) => {
    if (files.has(f.id)) return `<file id="${xml(f.id)}"/>`;
    files.set(f.id, true);
    return `<file id="${xml(f.id)}"><name>${xml(f.name)}</name><pathurl>${xml(fileURL(f.path || f.name))}</pathurl>${rate}<duration>${frames(f.duration || 0)}</duration>`
      + `<media><video><samplecharacteristics>${rate}<width>${sourceWidth}</width><height>${sourceHeight}</height></samplecharacteristics></video>`
      + '<audio><channelcount>2</channelcount></audio></media></file>';
  };
  let cursor = 0;
  const placed = clips.map((c, i) => {
    const len = Math.max(1, frames(c.out - c.in));
    const item = { ...c, start: cursor, end: cursor + len, inF: frames(c.in), outF: frames(c.in) + len, n: i + 1 };
    cursor += len;
    return item;
  });
  const total = cursor;
  const clipXml = (c, id, mediaFile, extra = '') => `<clipitem id="${id}"><name>${xml(c.file.name)}</name><duration>${frames(c.file.duration || 0)}</duration>${rate}`
    + `<start>${c.start}</start><end>${c.end}</end><in>${c.inF}</in><out>${c.outF}</out>${mediaFile}${extra}</clipitem>`;
  const video = placed.map((c) => clipXml(c, `clipitem-v${c.n}`, fileXml(c.file))).join('\n        ');
  files.clear();
  const audio = placed.map((c) => clipXml(c, `clipitem-a${c.n}`, `<file id="${xml(c.file.id)}"/>`, '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>')).join('\n        ');
  const markerXml = markers.map((m) => `<marker><name>${xml(m.name)}</name><comment>${xml(m.comment || '')}</comment><in>${frames(m.at)}</in><out>-1</out></marker>`).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xml(name)}</name>
    <duration>${total}</duration>
    ${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></format>
        <track>${video}</track>
      </video>
      <audio>
        <track>${audio}</track>
      </audio>
    </media>
      ${markerXml}
  </sequence>
</xmeml>
`;
}
