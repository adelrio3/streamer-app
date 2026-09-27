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
