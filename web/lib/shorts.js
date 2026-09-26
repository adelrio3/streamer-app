// Shorts finder: the moments worth a 30 to 60 second vertical, cut from
// the highlights with a window around each, overlapping ones merged, and a
// 9:16 Premiere sequence for any of them (a 16:9 clip in a 1080×1920
// sequence keeps its size, so Premiere shows the centre of the frame).

import { toSequenceXML } from './exports.js';

// Seconds before and after the moment, and how much it is worth.
export const SHORT_WINDOWS = {
  death: { before: 26, after: 8, score: 60 },
  close: { before: 24, after: 12, score: 85 },
  loot: { before: 8, after: 14, score: 40 },
  rare: { before: 6, after: 22, score: 70 },
  level: { before: 8, after: 10, score: 50 },
  discovery: { before: 10, after: 10, score: 30 },
  elite: { before: 28, after: 10, score: 55 },
  brawl: { before: 22, after: 10, score: 45 },
  mark: { before: 15, after: 15, score: 80 },
};
export const MIN_SHORT = 20;
export const MAX_SHORT = 60;

// highlights: from findHighlights (each with footage { rec, offset } when
// recorded). Returns candidates with in/out on their recording, best first.
export function findShorts(highlights, { windows = SHORT_WINDOWS } = {}) {
  const raw = [];
  for (const h of highlights) {
    if (!h.footage) continue;
    const w = windows[h.kind];
    if (!w) continue;
    const score = w.score + (h.kind === 'loot' ? (h.quality || 0) * 12 : 0) + (h.kind === 'close' ? Math.max(0, 100 - (h.score ?? 100)) / 4 : 0);
    raw.push({ rec: h.footage.rec, in: Math.max(0, h.footage.offset - w.before), out: h.footage.offset + w.after, at: h.footage.offset, kinds: [h.kind], labels: [h.label], score, t: h.t, zone: h.zone ?? null, char: h.char ?? null, m: h.m ?? null });
  }
  raw.sort((a, b) => a.rec.localeCompare(b.rec) || a.in - b.in);
  const out = [];
  for (const c of raw) {
    const last = out.at(-1);
    if (last && last.rec === c.rec && c.in <= last.out && c.out - last.in <= MAX_SHORT) {
      last.out = Math.max(last.out, c.out);
      last.kinds.push(...c.kinds.filter((k) => !last.kinds.includes(k)));
      last.labels.push(...c.labels);
      last.score = Math.max(last.score, c.score) + 10;
      continue;
    }
    out.push({ ...c, kinds: [...c.kinds], labels: [...c.labels] });
  }
  for (const s of out) {
    if (s.out - s.in < MIN_SHORT) s.out = s.in + MIN_SHORT;
    s.duration = s.out - s.in;
  }
  return out.sort((a, b) => b.score - a.score || b.t - a.t);
}

// recording: { id, name, path, duration }. One clip, vertical sequence.
export function toShortXML(recording, short, { fps = 60, sourceWidth = 1920, sourceHeight = 1080 } = {}) {
  const out = Math.min(short.out, recording.duration || short.out);
  return toSequenceXML({
    name: `Short - ${short.labels[0]}`,
    fps, width: 1080, height: 1920, sourceWidth, sourceHeight,
    clips: [{ file: { id: 'file-1', name: recording.name, path: recording.path || recording.name, duration: recording.duration }, in: short.in, out }],
    markers: [{ at: short.at - short.in, name: `[${short.kinds.join('+')}] ${short.labels.join(' / ')}`, comment: [short.zone, short.char].filter(Boolean).join(' | ') }],
  });
}

export function shortsCSV(shorts, recordings = new Map()) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['recording', 'in', 'out', 'seconds', 'kinds', 'moment', 'zone', 'character', 'score']];
  for (const s of shorts) rows.push([recordings.get(s.rec)?.name ?? s.rec, s.in.toFixed(2), s.out.toFixed(2), s.duration.toFixed(1), s.kinds.join('+'), s.labels.join(' / '), s.zone ?? '', s.char ?? '', Math.round(s.score)]);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
