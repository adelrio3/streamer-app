// Voice notes land on the timelines and export as captions with their own length.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelines } from '../web/lib/timeline.js';
import { toSRT } from '../web/lib/exports.js';

const recordings = [{ id: 'r1', name: 'a.mkv', start: 1_000_000, end: 1_600_000, duration: 600 }];
const clock = () => 0;
const sessions = [{ id: 's1', machine: 'Gaming PC', events: [{ e: 'kill', t: 1010, name: 'Hogger' }] }];
const voice = [
  { id: 'v1', start_ms: 1_005_000, end_ms: 1_008_500, text: 'Here we are in Northshire.' },
  { id: 'v2', start_ms: 1_012_000, end_ms: 1_013_000, text: 'Hogger!' },
  { id: 'v3', start_ms: 2_000_000, end_ms: 2_001_000, text: 'not in any recording' },
  { id: 'v4', start_ms: 1_020_000, end_ms: null, text: '' },
];

test('voice notes sit on the recording timeline with their length', () => {
  const tl = buildTimelines(sessions, recordings, clock, voice).get('r1');
  assert.deepEqual(tl.map((e) => [e.cat, e.offset]), [['voice', 5], ['combat', 10], ['voice', 12]]);
  const first = tl[0];
  assert.equal(first.e, 'voice');
  assert.equal(first.label, 'Here we are in Northshire.');
  assert.equal(first.until, 8.5);
  assert.equal(first.session, 'voice');
  assert.equal(buildTimelines(sessions, recordings, clock).get('r1').length, 1, 'without voice, as before');
});

test('narration captions keep each sentence for as long as it was spoken', () => {
  const tl = buildTimelines(sessions, recordings, clock, voice).get('r1').filter((e) => e.cat === 'voice');
  const srt = toSRT(tl, 3);
  assert.match(srt, /1\n00:00:05,000 --> 00:00:08,500\nHere we are in Northshire\.\n/);
  assert.match(srt, /2\n00:00:12,000 --> 00:00:13,000\nHogger!\n/);
  const plain = toSRT([{ offset: 5, label: 'a' }, { offset: 6, label: 'b' }], 3);
  assert.match(plain, /00:00:05,000 --> 00:00:05,99\d\na/, 'other cues still stop before the next one');
});
