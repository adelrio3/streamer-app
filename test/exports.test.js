import test from 'node:test';
import assert from 'node:assert/strict';
import { toSRT, toChapters, toKillsCSV, toFCPXML, toCSV, fileURL, timecode } from '../companion/src/exports.js';

const ev = (offset, e, extra = {}) => ({ offset, t: 1790000000 + offset, e, label: `${e} at ${offset}`, cat: 'quest', ...extra });

test('timecodes', () => {
  assert.equal(timecode(3725.5), '01:02:05');
  assert.equal(timecode(3725.5, { ms: true }), '01:02:05,500');
});

test('SRT cues do not overlap', () => {
  const srt = toSRT([ev(1, 'a'), ev(2, 'b'), ev(10, 'c')], 3);
  assert.match(srt, /^1\n00:00:01,000 --> 00:00:01,999\na at 1\n/);
  assert.match(srt, /3\n00:00:10,000 --> 00:00:13,000\nc at 10/);
});

test('chapters start at zero and skip pass-throughs', () => {
  const txt = toChapters([
    ev(5, 'session_start', { z: 'Elwynn Forest', sz: 'Northshire Valley' }),
    ev(400, 'zone', { z: 'Elwynn Forest', sz: 'Goldshire' }),
    ev(420, 'zone', { z: 'Elwynn Forest', sz: 'Lion\'s Pride Inn' }),
    ev(900, 'zone', { z: 'Westfall', sz: 'Sentinel Hill' }),
  ]);
  assert.equal(txt, "00:00:00 Elwynn Forest: Northshire Valley\n00:06:40 Elwynn Forest: Lion's Pride Inn\n00:15:00 Westfall: Sentinel Hill\n");
});

test('kill counter keeps running counts', () => {
  const kills = [ev(1, 'kill', { name: 'Kobold', npcId: 6 }), ev(2, 'kill', { name: 'Wolf', npcId: 299 }), ev(3, 'kill', { name: 'Kobold', npcId: 6 })];
  const csv = toKillsCSV(kills, new Map([[6, 10]])).trim().split('\r\n');
  assert.equal(csv.length, 4);
  assert.equal(csv[3], '00:00:03,3.000,Kobold,6,2,3,12');
});

test('CSV escapes quotes and commas', () => {
  const csv = toCSV([ev(1, 'speech', { label: 'He said "hi", then left' })]);
  assert.match(csv, /"He said ""hi"", then left"/);
});

test('Premiere XML has a clip and frame-accurate markers', () => {
  const rec = { name: '2026-09-25 20-15-42.mkv', file: 'C:\\Videos\\2026-09-25 20-15-42.mkv', duration: 120 };
  const xml = toFCPXML(rec, [ev(1.5, 'kill', { label: 'Killed <Kobold> & friends', cat: 'combat', z: 'Elwynn' })], { fps: 60 });
  assert.match(xml, /<xmeml version="4">/);
  assert.match(xml, /<duration>7200<\/duration>/);
  assert.match(xml, /<in>90<\/in><out>-1<\/out>/);
  assert.match(xml, /\[combat\] Killed &lt;Kobold&gt; &amp; friends/);
  assert.match(xml, /file:\/\/localhost\/C%3a\/Videos\/2026-09-25%2020-15-42\.mkv/);
  assert.match(xml, /<ntsc>FALSE<\/ntsc>/);
  assert.match(toFCPXML(rec, [], { fps: 59.94 }), /<timebase>60<\/timebase><ntsc>TRUE<\/ntsc>/);
  // Balanced tags (a cheap well-formedness check).
  const opens = (xml.match(/<marker>/g) || []).length;
  assert.equal(opens, (xml.match(/<\/marker>/g) || []).length);
});

test('file URLs for POSIX paths', () => {
  assert.equal(fileURL('/Users/me/Movies/a b.mov'), 'file://localhost/Users/me/Movies/a%20b.mov');
});
