import test from 'node:test';
import assert from 'node:assert/strict';
import { Mp4Writer, memorySink, parseBoxes } from '../web/lib/mp4.js';

const find = (boxes, type) => boxes.find((b) => b.type === type);

test('mp4: one video track, samples streamed to mdat, tables in moov', async () => {
  const sink = memorySink();
  const w = new Mp4Writer(sink, { width: 1920, height: 1080, timescale: 90000 });
  await w.start();
  w.setDescription(new Uint8Array([1, 100, 0, 40, 255, 225, 0, 4, 0x67, 1, 2, 3, 1, 0, 2, 0x68, 4]));
  const sizes = [1200, 40, 42, 1100, 38];
  for (let i = 0; i < sizes.length; i++) await w.addSample(new Uint8Array(sizes[i]).fill(i + 1), { key: i % 3 === 0, duration: 3000 });
  const out = await w.finish();
  assert.equal(out.samples, 5);
  assert.equal(out.seconds, (5 * 3000) / 90000);
  const bytes = sink.bytes();
  assert.equal(bytes.length, out.bytes);
  const boxes = parseBoxes(bytes);
  assert.deepEqual(boxes.map((b) => b.type), ['ftyp', 'mdat', 'moov']);
  const mdat = find(boxes, 'mdat');
  assert.equal(mdat.size, 16 + sizes.reduce((a, b) => a + b, 0));
  const moov = find(boxes, 'moov');
  const trak = find(moov.children, 'trak');
  const stbl = find(find(find(trak.children, 'mdia').children, 'minf').children, 'stbl');
  const types = stbl.children.map((b) => b.type);
  assert.deepEqual(types, ['stsd', 'stts', 'stss', 'stsc', 'stsz', 'co64']);
  // stsz lists every size; stss the key frames 1 and 4; co64 offsets inside the mdat
  const dv = new DataView(bytes.buffer);
  const stsz = find(stbl.children, 'stsz');
  assert.equal(dv.getUint32(stsz.offset + 16), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => dv.getUint32(stsz.offset + 20 + i * 4)), sizes);
  const stss = find(stbl.children, 'stss');
  assert.equal(dv.getUint32(stss.offset + 12), 2);
  assert.deepEqual([dv.getUint32(stss.offset + 16), dv.getUint32(stss.offset + 20)], [1, 4]);
  const co64 = find(stbl.children, 'co64');
  const first = Number(dv.getBigUint64(co64.offset + 16));
  assert.equal(first, mdat.offset + 16);
  assert.equal(bytes[first], 1);
  // the avcC record sits in the sample description
  const text = Buffer.from(bytes.subarray(moov.offset)).toString('latin1');
  assert.ok(text.includes('avc1') && text.includes('avcC'));
  // a single run of equal durations
  const stts = find(stbl.children, 'stts');
  assert.equal(dv.getUint32(stts.offset + 12), 1);
  assert.equal(dv.getUint32(stts.offset + 16), 5);
  assert.equal(dv.getUint32(stts.offset + 20), 3000);
});

test('mp4: the memory sink patches the mdat header in place', async () => {
  const sink = memorySink();
  const w = new Mp4Writer(sink, { width: 640, height: 360 });
  await w.addSample(new Uint8Array(10), { key: true, duration: 3000 });
  await w.finish();
  const boxes = parseBoxes(sink.bytes());
  assert.equal(find(boxes, 'mdat').size, 26);
  assert.throws(() => sink.patch(10_000, new Uint8Array(2)));
});
