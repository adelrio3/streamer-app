// Source Record companions: camera and overlay files recorded beside the main recording.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecordings, recordingRole } from '../web/lib/timeline.js';
import { toFCPXML } from '../web/lib/exports.js';

test('companions pair with the recording they were made beside and take its timing', () => {
  assert.equal(recordingRole('2026-09-27 14-13-34.mkv'), 'game');
  assert.equal(recordingRole('cam 2026-09-27 14-13-34.mkv'), 'cam');
  assert.equal(recordingRole('Overlay_2026-09-27 14-13-34.mp4'), 'overlay');
  const t0 = 1_790_000_000_000;
  const rows = [
    { name: '2026-09-27 14-13-34.mkv', machine: 'Mac', start_ms: t0, duration: 600, source: 'obs', sync: { start_ms: t0 + 250 } },
    { name: 'cam 2026-09-27 14-13-35.mkv', machine: 'Mac', start_ms: t0 + 800, duration: 598, source: 'filename' },
    { name: 'overlay 2026-09-27 14-13-34.mp4', machine: 'Mac', start_ms: t0 - 300, duration: 601, source: 'filename' },
    { name: 'cam 2026-09-27 16-00-00.mkv', machine: 'Mac', start_ms: t0 + 7_000_000, duration: 100, source: 'filename' },
  ];
  const all = resolveRecordings(rows);
  const game = all.find((r) => r.role === 'game');
  assert.equal(game.companions.length, 2, 'two companions within five seconds');
  assert.deepEqual(game.companions.map((c) => c.role), ['cam', 'overlay'], 'camera first');
  assert.equal(game.companions[0].offset, 0.8);
  assert.equal(game.companions[1].offset, -0.3);
  const cam = all.find((r) => r.name.startsWith('cam 2026-09-27 14'));
  assert.equal(cam.companionOf, game.id);
  assert.equal(cam.start, game.start + 800, 'the sync correction carries over');
  assert.equal(cam.source, 'sync');
  assert.equal(all.find((r) => r.name.includes('16-00-00')).companionOf, null, 'a lone camera file pairs with nothing');
  const xml = toFCPXML(game, [], { fps: 60 });
  assert.equal((xml.match(/<track>/g) || []).length, 5, 'game video+audio, cam video+audio, overlay video');
  assert.ok(xml.includes('<start>48</start>'), 'the camera starts 48 frames in');
  assert.ok(xml.includes('<in>18</in>'), 'the overlay is trimmed by 18 frames');
  assert.ok(xml.includes('cam 2026-09-27 14-13-35.mkv') && xml.includes('overlay 2026-09-27 14-13-34.mp4'));
});

test('toFCPXML: a rendered overlay companion gets a video-only track at its own size', async () => {
  const { toFCPXML } = await import('../web/lib/exports.js');
  const rec = { name: '2026-09-25 20-15-42.mkv', path: '/Users/me/Movies/2026-09-25 20-15-42.mkv', duration: 100, companions: [
    { role: 'cam', name: 'cam 2026-09-25 20-15-43.mkv', path: '/Users/me/Movies/cam 2026-09-25 20-15-43.mkv', duration: 99, offset: 1 },
    { role: 'overlay', name: '2026-09-25 20-15-42.overlay.mp4', path: '/Users/me/Movies/2026-09-25 20-15-42.overlay.mp4', duration: 100, offset: 0, width: 1920, height: 1080 },
  ] };
  const xml = toFCPXML(rec, [], { fps: 60, width: 3840, height: 2160 });
  const videoTracks = (xml.match(/<track><clipitem id="clipitem-(?:1|c\d+v)"/g) || []).length;
  const audioTracks = (xml.match(/<track><clipitem id="clipitem-(?:2|c\d+a)"/g) || []).length;
  assert.equal(videoTracks, 3);
  assert.equal(audioTracks, 2, 'the overlay has no sound');
  assert.ok(xml.indexOf('overlay.mp4') > xml.indexOf('cam 2026'), 'the overlay is the top track');
  assert.ok(xml.includes('<width>1920</width><height>1080</height>'));
  assert.ok(xml.includes('<width>3840</width><height>2160</height>'));
});

test('a camera in a cam folder, or left recording all evening, serves every game recording it covers', () => {
  assert.equal(recordingRole('2026-09-27 20-00-00.mov', '/Users/me/Movies/cam/2026-09-27 20-00-00.mov'), 'cam');
  assert.equal(recordingRole('My Movie.mov', 'cam/My Movie.mov'), 'cam');
  assert.equal(recordingRole('2026-09-27 20-00-00.mov', '/Users/me/Movies/2026-09-27 20-00-00.mov'), 'game');
  assert.equal(recordingRole('2026-09-27 20-00-00.overlay.mp4'), 'overlay');
  const t0 = 1_790_000_000_000;
  const rows = [
    { name: 'My Movie.mov', path: '/Users/me/Movies/cam/My Movie.mov', machine: 'Mac', start_ms: t0 - 600_000, duration: 7200, source: 'file' },
    { name: '2026-09-27 20-00-00.mov', path: '/Users/me/Movies/2026-09-27 20-00-00.mov', machine: 'Mac', start_ms: t0, duration: 1800, source: 'file' },
    { name: '2026-09-27 21-00-00.mov', path: '/Users/me/Movies/2026-09-27 21-00-00.mov', machine: 'Mac', start_ms: t0 + 3_600_000, duration: 1800, source: 'file' },
    { name: '2026-09-27 23-00-00.mov', path: '/Users/me/Movies/2026-09-27 23-00-00.mov', machine: 'Mac', start_ms: t0 + 10_800_000, duration: 600, source: 'file' },
    { name: '2026-09-27 20-00-00.overlay.mp4', path: '/Users/me/Movies/2026-09-27 20-00-00.overlay.mp4', machine: 'Mac', start_ms: t0, duration: 1800, source: 'file' },
  ];
  const all = resolveRecordings(rows);
  const games = all.filter((r) => r.role === 'game');
  assert.equal(games.length, 3);
  const [g1, g2, g3] = games;
  assert.deepEqual(g1.companions.map((c) => c.role), ['cam', 'overlay']);
  assert.equal(g1.companions[0].offset, -600, 'the camera began ten minutes earlier: trimmed at its head');
  assert.equal(g1.companions[1].offset, 0);
  assert.deepEqual(g2.companions.map((c) => [c.role, c.offset]), [['cam', -4200]], 'the same camera file serves the next session too');
  assert.equal(g3.companions.length, 0, 'the camera had stopped by then');
  const cam = all.find((r) => r.role === 'cam');
  assert.equal(cam.companionOf, g1.id);
  const xml = toFCPXML(g1, [], { fps: 60 });
  assert.ok(xml.includes('<in>36000</in>'), 'the camera clip starts 600 s in');
});
