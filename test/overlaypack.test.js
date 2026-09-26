// Overlay pack: which stills go where, the XML that places them, and the ZIP.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planOverlays, toOverlayXML, packReadme } from '../web/lib/overlaypack.js';
import { makeZip, crc32 } from '../web/lib/zip.js';

const timeline = [
  { e: 'kill', offset: 10, name: 'Kobold Vermin' },
  { e: 'loot', offset: 12, id: 2589, name: 'Linen Cloth', q: 1, n: 2 },
  { e: 'loot', offset: 13, id: 1121, name: 'Feet of the Lynx', q: 2, n: 1, source: 'Mother Fang' },
  { e: 'loot', offset: 14, id: 2244, name: 'Krol Blade', q: 3, n: 1 },
  { e: 'loot', offset: 30, id: 25, name: 'Crafted', q: 1, n: 1, src: 'created' },
  { e: 'kill', offset: 40, name: 'Hogger' },
  { e: 'quest_turnin', offset: 41, qid: 176, title: 'Wanted: "Hogger"' },
  { e: 'level', offset: 42, level: 12 },
  { e: 'kill', offset: 90, name: 'Kobold Worker' },
];
const recording = { name: '2026-09-25 21-00-00.mkv', path: '/Users/andres/Movies/2026-09-25 21-00-00.mkv', duration: 100 };

test('plans stills and their placements, overlapping cards on separate tracks', () => {
  const { stills, clips } = planOverlays(timeline, { duration: 100 });
  assert.deepEqual([...stills.keys()].sort(), ['item-1121.png', 'item-2244.png', 'kills-1.png', 'kills-2.png', 'kills-3.png', 'level-12.png', 'quest-176.png'], 'common and crafted items are skipped');
  const lynx = clips.find((c) => c.file === 'item-1121.png');
  const krol = clips.find((c) => c.file === 'item-2244.png');
  assert.equal(lynx.start, 13);
  assert.equal(lynx.end, 17);
  assert.equal(krol.track, lynx.track + 1, 'the second card overlaps the first, so it goes a track up');
  const quest = clips.find((c) => c.file === 'quest-176.png');
  const level = clips.find((c) => c.file === 'level-12.png');
  assert.equal(quest.track, 2, 'nothing overlaps by then, back on the first overlay track');
  assert.equal(level.track, 3);
  const kills = clips.filter((c) => c.kind === 'kills').sort((a, b) => a.start - b.start);
  assert.deepEqual(kills.map((c) => [c.file, c.start, c.end]), [['kills-1.png', 10, 40], ['kills-2.png', 40, 90], ['kills-3.png', 90, 100]], 'the counter runs from kill to kill and to the end');
  assert.ok(kills.every((c) => c.track === 4), 'the counter has a track of its own above the cards');
  assert.equal(planOverlays(timeline, { minQuality: 1, kills: false, quests: false, levels: false }).stills.size, 3, 'any quality includes the linen');
  assert.equal(planOverlays(timeline, { killsBefore: 1200 }).stills.has('kills-1201.png'), true, 'lifetime counting');
});

test('the XML puts the recording on V1 and every still above it at the right frames', () => {
  const { clips } = planOverlays(timeline, { duration: 100 });
  const xml = toOverlayXML(recording, clips, { fps: 60, width: 1920, height: 1080, folder: '/Users/andres/Movies/overlays' });
  assert.match(xml, /<pathurl>file:\/\/localhost\/Users\/andres\/Movies\/2026-09-25%2021-00-00\.mkv<\/pathurl>/);
  assert.match(xml, /<pathurl>file:\/\/localhost\/Users\/andres\/Movies\/overlays\/item-1121\.png<\/pathurl>/);
  const tracks = xml.match(/<track>/g).length;
  assert.equal(tracks, 5, 'video: the recording, three overlay tracks; audio: one');
  assert.match(xml, /<clipitem id="overlay-\d+"><name>item-1121\.png<\/name><duration>240<\/duration><rate><timebase>60<\/timebase><ntsc>FALSE<\/ntsc><\/rate><start>780<\/start><end>1020<\/end>/);
  assert.match(xml, /<clipitem id="overlay-\d+"><name>kills-3\.png<\/name><duration>600<\/duration>/);
  assert.ok(xml.split('<file id="still-').length - 1 === 7, 'each still is a file once, referenced by id after');
  assert.ok(!xml.includes('undefined'));
  assert.match(packReadme(recording, '/x', 7), /7 PNG stills/);
});

test('the zip is a real archive with the right checksums', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = await makeZip([{ name: 'overlays/a.txt', data: 'hello' }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 8, 25, 12, 0, 0));
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  const python = spawnSync('python3', ['-V']).status === 0;
  if (!python) return;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-zip-')), 't.zip');
  fs.writeFileSync(file, zip);
  const run = spawnSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist())); print(z.read('overlays/a.txt').decode())`, file], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^None\n\['b\.bin', 'overlays\/a\.txt'\]\nhello\n$/);
});
