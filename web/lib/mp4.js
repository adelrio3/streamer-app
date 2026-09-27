// A small MP4 (ISO BMFF) writer for one H.264 video track, fed by
// WebCodecs: each EncodedVideoChunk (in AVCC "avc" format, length-prefixed
// NAL units) becomes one sample, the encoder's description becomes the avcC
// box. Samples stream straight to the sink as they come (the mdat box is
// first, its size patched at the end), so a long overlay video never sits in
// memory; the moov box with the sample tables is written last. Premiere Pro
// reads the result like any other .mp4.

const enc = new TextEncoder();

function u8(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const be16 = (v) => new Uint8Array([(v >>> 8) & 255, v & 255]);
const be32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
function be64(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(Math.round(v)));
  return b;
}
const str = (s) => enc.encode(s);
const zeros = (n) => new Uint8Array(n);
const box = (type, ...parts) => { const body = u8(...parts); return u8(be32(8 + body.length), str(type), body); };
const full = (type, version, flags, ...parts) => box(type, new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...parts);
const MAX32 = 0xffffffff;

export function ftyp() {
  return box('ftyp', str('isom'), be32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
}

// The mdat header with a 64-bit size, patched once the samples are in.
function mdatHeader(size) {
  return u8(be32(1), str('mdat'), be64(size));
}

export class Mp4Writer {
  // sink: { write(bytes) (append), patch(offset, bytes), close() }.
  constructor(sink, { width, height, timescale = 90000, movieTimescale = 1000 } = {}) {
    this.sink = sink;
    this.width = width;
    this.height = height;
    this.timescale = timescale;
    this.movieTimescale = movieTimescale;
    this.samples = []; // { offset, size, duration, key }
    this.description = null;
    this.pos = 0;
    this.mdatAt = 0;
    this.started = false;
  }

  async #put(bytes) {
    await this.sink.write(bytes);
    this.pos += bytes.length;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.#put(ftyp());
    this.mdatAt = this.pos;
    await this.#put(mdatHeader(16));
  }

  setDescription(bytes) {
    if (bytes && !this.description) this.description = new Uint8Array(bytes);
  }

  // bytes: the chunk's data (AVCC); duration in track timescale units.
  async addSample(bytes, { key = false, duration } = {}) {
    if (!this.started) await this.start();
    this.samples.push({ offset: this.pos, size: bytes.length, duration: Math.max(1, Math.round(duration)), key: Boolean(key) });
    await this.#put(bytes);
  }

  get duration() {
    let d = 0;
    for (const s of this.samples) d += s.duration;
    return d;
  }

  async finish() {
    if (!this.started) await this.start();
    const mdatSize = this.pos - this.mdatAt;
    await this.sink.patch(this.mdatAt, mdatHeader(mdatSize));
    await this.#put(this.moov());
    await this.sink.close?.();
    return { bytes: this.pos, samples: this.samples.length, seconds: this.duration / this.timescale };
  }

  moov() {
    const s = this.samples;
    const dur = this.duration;
    const movieDur = Math.round((dur / this.timescale) * this.movieTimescale);
    const wide = dur > MAX32 || movieDur > MAX32;
    const time = wide ? be64 : be32;
    const v = wide ? 1 : 0;
    const mvhd = full('mvhd', v, 0, time(0), time(0), be32(this.movieTimescale), time(movieDur),
      be32(0x00010000), be16(0x0100), zeros(10), be32(0x10000), be32(0), be32(0), be32(0), be32(0x10000), be32(0), be32(0), be32(0), be32(0x40000000), zeros(24), be32(2));
    const tkhd = full('tkhd', v, 3, time(0), time(0), be32(1), be32(0), time(movieDur), zeros(8), be16(0), be16(0), be16(0), be16(0),
      be32(0x10000), be32(0), be32(0), be32(0), be32(0x10000), be32(0), be32(0), be32(0), be32(0x40000000), be32(this.width << 16), be32(this.height << 16));
    const mdhd = full('mdhd', v, 0, time(0), time(0), be32(this.timescale), time(dur), be16(0x55c4), be16(0));
    const hdlr = full('hdlr', 0, 0, be32(0), str('vide'), zeros(12), str('VideoHandler'), zeros(1));
    const vmhd = full('vmhd', 0, 1, zeros(8));
    const dinf = box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1)));
    const avcC = this.description ? box('avcC', this.description) : new Uint8Array(0);
    const avc1 = box('avc1', zeros(6), be16(1), be16(0), be16(0), zeros(12), be16(this.width), be16(this.height), be32(0x00480000), be32(0x00480000), be32(0), be16(1),
      new Uint8Array([10]), str('Compendium'), zeros(21), be16(24), be16(0xffff), avcC);
    const stsd = full('stsd', 0, 0, be32(1), avc1);
    // stts: runs of equal durations
    const runs = [];
    for (const x of s) { const last = runs.at(-1); if (last && last.d === x.duration) last.n++; else runs.push({ n: 1, d: x.duration }); }
    const stts = full('stts', 0, 0, be32(runs.length), ...runs.flatMap((r) => [be32(r.n), be32(r.d)]));
    const keys = s.map((x, i) => (x.key ? i + 1 : 0)).filter(Boolean);
    const stss = full('stss', 0, 0, be32(keys.length), ...keys.map(be32));
    const stsc = full('stsc', 0, 0, be32(1), be32(1), be32(1), be32(1)); // one sample per chunk
    const stsz = full('stsz', 0, 0, be32(0), be32(s.length), ...s.map((x) => be32(x.size)));
    const co64 = full('co64', 0, 0, be32(s.length), ...s.map((x) => be64(x.offset)));
    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, co64);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    return box('moov', mvhd, trak);
  }
}

// A sink that keeps everything in memory (for a download at the end).
export function memorySink() {
  const parts = [];
  const offsets = [];
  let pos = 0;
  return {
    write(bytes) { parts.push(new Uint8Array(bytes)); offsets.push(pos); pos += bytes.length; },
    patch(offset, bytes) {
      for (let i = 0; i < parts.length; i++) {
        const o = offsets[i];
        if (offset >= o && offset + bytes.length <= o + parts[i].length) { parts[i].set(bytes, offset - o); return; }
      }
      throw new Error('patch outside a written part');
    },
    close() {},
    bytes() { return u8(...parts); },
    blob(type = 'video/mp4') { return new Blob(parts, { type }); },
    get size() { return pos; },
  };
}

// A sink over a FileSystemWritableFileStream (positioned writes).
export function fileSink(writable) {
  let pos = 0;
  return {
    async write(bytes) { await writable.write({ type: 'write', position: pos, data: bytes }); pos += bytes.length; },
    async patch(offset, bytes) { await writable.write({ type: 'write', position: offset, data: bytes }); },
    async close() { await writable.close(); },
    get size() { return pos; },
  };
}

// Reads the box tree back (for checks): [{ type, size, offset, children }].
export function parseBoxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = start;
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    let head = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); head = 16; }
    if (size === 0) size = end - p;
    const b = { type, size, offset: p, head };
    if (CONTAINERS.has(type)) b.children = parseBoxes(bytes, p + head, p + size);
    out.push(b);
    p += size;
  }
  return out;
}
