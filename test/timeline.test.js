// The two-computer pipeline: addon log from the gaming PC, recordings from
// the Mac, clocks bridged through the server, and sync flashes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionsFromSavedVariables, mergeSession, expansionOf } from '../web/lib/sessions.js';
import { clockModel, eventMs, startFromName, resolveRecordings, aligner, buildTimelines, recordingId } from '../web/lib/timeline.js';
import { buildCodex } from '../web/lib/codex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8');

test('reads the start time from OBS file names', () => {
  assert.equal(startFromName('/Users/me/Movies/2026-09-25 20-15-42.mkv'), new Date(2026, 8, 25, 20, 15, 42).getTime());
  assert.equal(startFromName('C:\\Videos\\2026-09-25 20-15-42.mp4'), new Date(2026, 8, 25, 20, 15, 42).getTime());
  assert.equal(
    startFromName('WoW 1920x1080 25.09.26_20.15.42 raw.mp4', 'WoW %CRES %DD.%MM.%YY_%hh.%mm.%ss raw'),
    new Date(2026, 8, 25, 20, 15, 42).getTime(),
  );
  assert.equal(startFromName('my clip.mkv'), null);
});

test('sessions from the addon log', () => {
  const [s] = sessionsFromSavedVariables(fixture, { flavor: '_classic_era_', account: 'ACC' });
  assert.equal(s.char.name, 'Aldric');
  assert.equal(s.expansion, 'classic');
  assert.equal(s.flavor, '_classic_era_');
  assert.equal(s.events.length, 26);
  assert.equal(expansionOf(11509), 'classic');
  assert.equal(expansionOf(50500), 'mop');
});

test('merging a session only reports real changes', () => {
  const a = { id: 'x', events: [{ e: 'kill', t: 1, name: 'A' }] };
  assert.equal(mergeSession(a, { id: 'x', events: [{ name: 'A', t: 1, e: 'kill' }] }), null, 'key order does not matter');
  assert.deepEqual(mergeSession(a, { id: 'x', events: [{ e: 'kill', t: 2, name: 'B' }] }).events.map((e) => e.name), ['A', 'B']);
  assert.equal(mergeSession(null, a), a);
});

test('clock model interpolates each computer separately', () => {
  const clock = clockModel([
    { machine: 'pc', offset_ms: 100, measured_at: 1_000_000 },
    { machine: 'pc', offset_ms: 200, measured_at: 2_000_000 },
    { machine: 'mac', offset_ms: -50, measured_at: '1970-01-01T00:16:40.000Z' },
  ]);
  assert.equal(clock('pc', 500_000), 100);
  assert.equal(clock('pc', 1_500_000), 150);
  assert.equal(clock('pc', 9_000_000), 200);
  assert.equal(clock('mac', 5), -50);
  assert.equal(clock('unknown', 5), 0);
});

test('aligner finds the recording covering a moment', () => {
  const recs = [{ id: 'a', start: 10_000, end: 20_000 }, { id: 'b', start: 30_000, end: 40_000 }];
  const align = aligner(recs);
  assert.equal(align(15_000).recording.id, 'a');
  assert.equal(align(15_000).offset, 5);
  assert.equal(align(25_000), null);
  assert.equal(aligner([{ id: 'long', start: 0, end: 100_000 }, { id: 'short', start: 50_000, end: 60_000 }])(70_000).recording.id, 'long');
});

test('gaming PC and Mac with different clocks line up through the server clock', () => {
  const [session] = sessionsFromSavedVariables(fixture);
  session.machine = 'Gaming PC';
  const syncLocal = session.events.find((e) => e.e === 'sync').t * 1000;

  // The PC clock is 42 s behind the server, the Mac 7 s ahead. The Mac saved
  // its recording already converted to server time. Recording truly started
  // 20 s before the session on the server clock.
  const clock = clockModel([
    { machine: 'Gaming PC', offset_ms: 42_000, measured_at: syncLocal },
    { machine: 'Recording Mac', offset_ms: -7_000, measured_at: syncLocal },
  ]);
  const sessionStartServer = session.events[0].t * 1000 + 42_000;
  const rows = [{ name: 'take1.mp4', machine: 'Recording Mac', start_ms: sessionStartServer - 20_000, end_ms: sessionStartServer + 100_000, source: 'obs' }];
  const recordings = resolveRecordings(rows);
  const timelines = buildTimelines([session], recordings, clock);
  const events = timelines.get(recordingId('take1.mp4'));
  assert.equal(events.length, 26);
  assert.equal(events[0].offset, 20);

  // A sync flash seen 0.15 s late in the video (capture delay) corrects it.
  const flashAt = (eventMs(session, session.events.find((e) => e.e === 'sync'), clock) - (sessionStartServer - 20_000)) / 1000 + 0.15;
  const flashMs = eventMs(session, session.events.find((e) => e.e === 'sync'), clock);
  const synced = resolveRecordings([
    { ...rows[0], sync: { start_ms: flashMs - flashAt * 1000, flash_ms: flashMs, videoTime: flashAt } },
    // A later recording the same evening without a flash borrows the correction.
    { name: 'take2.mp4', machine: 'Recording Mac', start_ms: sessionStartServer + 3_600_000, end_ms: sessionStartServer + 3_700_000, source: 'obs' },
  ]);
  assert.equal(synced[0].source, 'sync');
  assert.ok(Math.abs(synced[0].start - (sessionStartServer - 20_000 - 150)) < 0.001);
  assert.equal(synced[1].source, 'sync-inferred');
  assert.ok(Math.abs(synced[1].start - (sessionStartServer + 3_600_000 - 150)) < 0.001);
  assert.equal(synced[1].syncedFrom, 'take1.mp4');
  const after = buildTimelines([session], synced, clock).get(recordingId('take1.mp4'));
  assert.ok(Math.abs(after.find((e) => e.e === 'sync').offset - flashAt) < 0.001, 'flash event sits on the flash frame');

  // The codex links moments to footage.
  const where = new Map();
  for (const [rec, list] of buildTimelines([session], synced, clock)) for (const e of list) where.set(`${e.session}|${e.t}`, { rec, offset: e.offset });
  const codex = buildCodex([session], (sid, t) => where.get(`${sid}|${t}`) ?? null);
  const quest = codex.quests.find((q) => q.qid === 7);
  assert.equal(quest.status, 'done');
  assert.equal(quest.accepted[0].footage.rec, recordingId('take1.mp4'));
  assert.equal(codex.creatures.find((c) => c.npcId === 6).kills, 2);
});

test('recordings still being recorded or missing times are skipped', () => {
  assert.equal(resolveRecordings([{ name: 'a.mp4', start_ms: 1000, end_ms: null, duration: null }]).length, 0);
  assert.equal(resolveRecordings([{ name: 'a.mp4', start_ms: null, duration: 5 }]).length, 0);
  assert.equal(resolveRecordings([{ name: 'a.mp4', start_ms: 1000, duration: 5 }])[0].end, 6000);
});
