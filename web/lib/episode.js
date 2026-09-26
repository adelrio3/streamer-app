// Episode assembly: every recorded stretch spent in one zone, in order, as
// one Premiere sequence with a marker at each quest turned in. The cut is a
// starting point: the segments come from the tracked route (where you were
// every couple of seconds), so travel, fights and turn-ins are all in.

import { findSegments } from './footage.js';
import { toSequenceXML } from './exports.js';

const JOIN_GAP = 6; // seconds between two stretches that count as one
const LEAD = 4; // seconds of room before and after each stretch (the route is sampled every 2 s)

// mapIds: the zone's map ids. events: [{ rec, offset, label, comment }] for
// the markers (quest turn-ins in the zone, with footage). Returns the
// clips in order, with total length and the markers placed on the sequence.
export function assembleEpisode({ mapIds, sessions, tracks, recordings, toMs, markers = [], minSeconds = 20 }) {
  const byRec = new Map(recordings.map((r) => [r.id, r]));
  let segs = [];
  for (const m of mapIds) segs.push(...findSegments(sessions, tracks, recordings, toMs, { map: m, minSeconds, noCombat: false, allowDead: true }));
  // In the order they were recorded: by recording start, then by offset.
  segs.sort((a, b) => (byRec.get(a.rec)?.start ?? 0) - (byRec.get(b.rec)?.start ?? 0) || a.rec.localeCompare(b.rec) || a.from - b.from);
  const clips = [];
  for (const s of segs) {
    const last = clips.at(-1);
    if (last && last.rec === s.rec && s.from - LEAD <= last.out + JOIN_GAP) { last.out = Math.max(last.out, s.to + LEAD); continue; }
    clips.push({ rec: s.rec, recName: s.recName, char: s.char, in: Math.max(0, s.from - LEAD), out: s.to + LEAD, zones: s.zones });
  }
  let cursor = 0;
  for (const c of clips) {
    c.start = cursor;
    c.duration = c.out - c.in;
    cursor += c.duration;
  }
  const placed = [];
  for (const m of markers) {
    const c = clips.find((x) => x.rec === m.rec && m.offset >= x.in && m.offset <= x.out);
    if (c) placed.push({ at: c.start + (m.offset - c.in), name: m.label, comment: m.comment || '' });
  }
  placed.sort((a, b) => a.at - b.at);
  return { clips, markers: placed, duration: cursor };
}

export function toEpisodeXML(name, episode, recordings, { fps = 60 } = {}) {
  const byRec = new Map(recordings.map((r) => [r.id, r]));
  const clips = episode.clips.map((c) => {
    const r = byRec.get(c.rec) || { name: c.recName, path: c.recName, duration: c.out };
    return { file: { id: `file-${c.rec}`, name: r.name, path: r.path || r.name, duration: r.duration }, in: c.in, out: Math.min(c.out, r.duration || c.out) };
  });
  return toSequenceXML({ name: `Episode - ${name}`, fps, clips, markers: episode.markers });
}

// YouTube-style chapters for the episode's markers.
export function episodeChapters(episode) {
  const tc = (sec) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };
  const lines = ['0:00 Arrival'];
  for (const m of episode.markers) if (m.at > 30) lines.push(`${tc(m.at)} ${m.name}`);
  return lines.join('\n');
}
