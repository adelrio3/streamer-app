// What a QuickTime / MP4 file says about itself: when it was created and
// how long it is, from the movie header (moov › mvhd). OBS, Source Record
// and QuickTime Player all write it, ProRes included, so a recording is
// timed from the file itself even when the browser cannot decode it and the
// name carries no timestamp. Only box headers are read (a few bytes each),
// so a 300 GB file costs nothing to probe.

const MAC_EPOCH = 2082844800; // seconds from 1904-01-01 (QuickTime) to 1970-01-01
const CONTAINERS = new Set(['moov']);

async function readAt(file, offset, length) {
  const end = Math.min(file.size, offset + length);
  if (end <= offset) return null;
  const buf = await file.slice(offset, end).arrayBuffer();
  return new DataView(buf);
}

function type(dv, at) {
  return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
}

// Walks the boxes at one level: yields { type, offset, size, head }.
async function* boxes(file, start, end) {
  let p = start;
  while (p + 8 <= end) {
    const dv = await readAt(file, p, 16);
    if (!dv || dv.byteLength < 8) return;
    let size = dv.getUint32(0);
    const t = type(dv, 4);
    let head = 8;
    if (size === 1) { if (dv.byteLength < 16) return; size = Number(dv.getBigUint64(8)); head = 16; }
    if (size === 0) size = end - p;
    if (size < head) return;
    yield { type: t, offset: p, size, head };
    p += size;
  }
}

// { created: ms since 1970 (null when the file does not say), duration:
// seconds (null when unknown, e.g. a fragmented file still being written),
// timescale } or null when the file is not a QuickTime/MP4 file.
export async function readMovieInfo(file) {
  if (!file || file.size < 16) return null;
  const first = await readAt(file, 0, 12);
  const firstType = type(first, 4);
  if (!['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot'].includes(firstType)) return null;
  for await (const b of boxes(file, 0, file.size)) {
    if (!CONTAINERS.has(b.type)) continue;
    for await (const c of boxes(file, b.offset + b.head, b.offset + b.size)) {
      if (c.type !== 'mvhd') continue;
      const dv = await readAt(file, c.offset + c.head, 32);
      if (!dv) return null;
      const version = dv.getUint8(0);
      let created; let timescale; let duration;
      if (version === 1) { created = Number(dv.getBigUint64(4)); timescale = dv.getUint32(20); duration = Number(dv.getBigUint64(24)); }
      else { created = dv.getUint32(4); timescale = dv.getUint32(12); duration = dv.getUint32(16); }
      const unknownDur = duration === 0 || (version === 0 && duration === 0xffffffff) || !timescale;
      return {
        created: created > MAC_EPOCH ? (created - MAC_EPOCH) * 1000 : null,
        duration: unknownDur ? null : duration / timescale,
        timescale: timescale || null,
      };
    }
  }
  return null;
}

export const MOVIE_EXTENSIONS = ['.mov', '.mp4', '.m4v'];
export function isMovieFile(name) {
  const n = String(name).toLowerCase();
  return MOVIE_EXTENSIONS.some((ext) => n.endsWith(ext));
}
