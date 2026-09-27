import test from 'node:test';
import assert from 'node:assert/strict';
import { readMovieInfo, isMovieFile } from '../web/lib/mov.js';
import { Mp4Writer, memorySink } from '../web/lib/mp4.js';

// A File-like: slice(start, end).arrayBuffer() over bytes.
const fileOf = (bytes) => ({ size: bytes.length, slice: (a, b) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }) });
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const box = (type, ...bodies) => { const body = bodies.flat(); return [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body]; };

test('readMovieInfo: what this app\'s own writer says', async () => {
  const sink = memorySink();
  const createdAt = Date.UTC(2026, 8, 27, 20, 15, 42);
  const w = new Mp4Writer(sink, { width: 640, height: 360, timescale: 90000, createdAt });
  for (let i = 0; i < 90; i++) await w.addSample(new Uint8Array(20), { key: i === 0, duration: 3000 });
  await w.finish();
  const info = await readMovieInfo(fileOf(sink.bytes()));
  assert.equal(info.created, createdAt);
  assert.equal(info.duration, 3);
});

test('readMovieInfo: a QuickTime file with the header last, and one still being written', async () => {
  const created = 3_900_000_000; // seconds since 1904
  const mvhd = box('mvhd', [0, 0, 0, 0], be32(created), be32(created), be32(600), be32(600 * 125), be32(0x10000), [0, 0], ...Array(76).fill(0));
  const mov = new Uint8Array([...box('ftyp', [...'qt  '].map((c) => c.charCodeAt(0)), be32(0)), ...box('wide'), ...box('mdat', ...Array(500).fill(7)), ...box('moov', mvhd)]);
  const info = await readMovieInfo(fileOf(mov));
  assert.equal(info.created, (created - 2082844800) * 1000);
  assert.equal(info.duration, 125);
  const growing = new Uint8Array([...box('ftyp', [...'isom'].map((c) => c.charCodeAt(0)), be32(0)), ...box('moov', box('mvhd', [0, 0, 0, 0], be32(created), be32(created), be32(1000), be32(0), ...Array(80).fill(0))), ...box('moof'), ...box('mdat', 1, 2, 3)]);
  const g = await readMovieInfo(fileOf(growing));
  assert.equal(g.created, (created - 2082844800) * 1000);
  assert.equal(g.duration, null, 'a fragmented file under way has no length yet');
  assert.equal(await readMovieInfo(fileOf(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(40).fill(0)]))), null, 'not a QuickTime file (Matroska)');
  assert.equal(isMovieFile('cam.MOV'), true);
  assert.equal(isMovieFile('game.mkv'), false);
});
