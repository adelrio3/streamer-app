import test from 'node:test';
import assert from 'node:assert/strict';
import { startFromName, aligner } from '../companion/src/recordings.js';

test('reads the start time from the default OBS file name', () => {
  const t = startFromName('C:\\Videos\\2026-09-25 20-15-42.mkv');
  assert.equal(t, new Date(2026, 8, 25, 20, 15, 42).getTime());
});

test('supports custom OBS filename formats', () => {
  assert.equal(
    startFromName('WoW %CRES 25.09.26_20.15.42 raw.mp4'.replace('%CRES', '1920x1080'), 'WoW %CRES %DD.%MM.%YY_%hh.%mm.%ss raw'),
    new Date(2026, 8, 25, 20, 15, 42).getTime(),
  );
  assert.equal(startFromName('Replay 2026-09-25_20-15-42.mkv', 'Replay %CCYY-%MM-%DD_%hh-%mm-%ss'), new Date(2026, 8, 25, 20, 15, 42).getTime());
  assert.equal(startFromName('my clip.mkv'), null);
});

test('aligns event times to the recording that covers them', () => {
  const recs = [
    { id: 'a', start: 1000_000, end: 2000_000 },
    { id: 'b', start: 3000_000, end: 4000_000 },
  ];
  const align = aligner(recs);
  assert.equal(align(1500).recording.id, 'a');
  assert.equal(align(1500).offset, 500);
  assert.equal(align(2500), null, 'gap between recordings');
  assert.equal(align(3000.25).offset, 0.25);
  assert.equal(align(500), null);
  assert.equal(aligner(recs, -1)(3001).offset, 0, 'clock offset shifts events');
});

test('finds a covering recording even when a later one overlaps', () => {
  const recs = [
    { id: 'long', start: 0, end: 10_000_000 },
    { id: 'short', start: 5_000_000, end: 6_000_000 },
  ];
  assert.equal(aligner(recs)(7000).recording.id, 'long');
});
