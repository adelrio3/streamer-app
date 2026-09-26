// Storylines, the shorts finder, episode assembly and the route replay.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { indexDB } from '../web/lib/questdb.js';
import { storylines, storylinesByContinent, storylineOutline } from '../web/lib/story.js';
import { findShorts, toShortXML, shortsCSV } from '../web/lib/shorts.js';
import { assembleEpisode, toEpisodeXML, episodeChapters } from '../web/lib/episode.js';
import { planReplay, routeAt, drawReplayFrame, easeProgress } from '../web/lib/replay.js';
import { findHighlights, parsePoint } from '../web/lib/footage.js';
import { resolveRecordings, aligner } from '../web/lib/timeline.js';
import { toSequenceXML } from '../web/lib/exports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'data', 'classic', name), 'utf8'));
const db = indexDB({ quests: json('quests.json').quests, npcs: json('npcs.json').npcs, objects: json('objects.json').objects, items: json('items.json').items, zones: json('zones.json').zones });
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;

test('storylines: quest chains in order, named after their finale, spanning zones', () => {
  const list = storylines(db, {});
  assert.ok(list.length > 100, `many chains: ${list.length}`);
  const fargodeep = list.find((s) => s.quests.some((r) => r.q.id === 62));
  assert.ok(fargodeep, 'The Fargodeep Mine is in a chain');
  const ids = fargodeep.quests.map((r) => r.q.id);
  assert.ok(ids.indexOf(62) < ids.indexOf(76), 'the next quest in chain comes after');
  assert.equal(fargodeep.startZone, 'Elwynn Forest');
  assert.equal(fargodeep.continent, 'Eastern Kingdoms');
  assert.ok(fargodeep.total >= 2 && fargodeep.done === 0);
  for (const s of list) {
    // Every chapter's prerequisites within the chain come before it.
    const pos = new Map(s.quests.map((r, i) => [r.q.id, i]));
    for (const r of s.quests) for (const p of [...(r.q.pre || []), ...(r.q.preAll || [])]) if (pos.has(p)) assert.ok(pos.get(p) < pos.get(r.q.id), `${s.name}: ${p} before ${r.q.id}`);
  }
  const crossing = list.find((s) => s.zones.includes('Elwynn Forest') && s.zones.includes('Stormwind City'));
  assert.ok(crossing, 'a chain runs from Elwynn into Stormwind');
  const groups = storylinesByContinent(list);
  assert.ok(groups.find((g) => g.name === 'Eastern Kingdoms').storylines.length > 30);
  const outline = storylineOutline(fargodeep, new Map([['q62', { text: 'Go look at the mine.' }]]));
  assert.ok(outline.startsWith(`# ${fargodeep.name}`));
  assert.ok(outline.includes('## 1.') && outline.includes('Go look at the mine.') && outline.includes('Objective:'));
});

test('storylines for a character leave out chains it cannot do', () => {
  const all = storylines(db, {});
  const horde = storylines(db, { race: 'Orc', cls: 'WARRIOR', level: 60, faction: 'H' });
  assert.ok(horde.length < all.length);
});

test('shorts: windows around highlights, merged when they overlap, vertical XML', () => {
  const [s] = sessions;
  const first = parsePoint(s.track[0]).t * 1000;
  const recordings = resolveRecordings([{ name: 'take.mp4', path: 'C:\\Videos\\take.mp4', start_ms: first - 10_000, duration: 600, source: 'obs' }]);
  const align = aligner(recordings);
  const moment = (sess, e) => { const hit = align(e.t * 1000); return { session: sess.id, t: e.t, footage: hit ? { rec: hit.recording.id, offset: hit.offset } : null }; };
  const highlights = findHighlights(sessions, moment, () => null);
  assert.ok(highlights.some((h) => h.footage), 'highlights land on the recording');
  const shorts = findShorts(highlights);
  assert.ok(shorts.length >= 1);
  for (const sh of shorts) {
    assert.ok(sh.duration >= 20 && sh.duration <= 70, `sensible length: ${sh.duration}`);
    assert.ok(sh.in >= 0 && sh.in <= sh.at && sh.at <= sh.out);
  }
  assert.ok(shorts[0].score >= shorts.at(-1).score, 'best first');
  const death = shorts.find((sh) => sh.kinds.includes('death'));
  assert.ok(death, 'the death is a short');
  const xml = toShortXML(recordings[0], death);
  assert.ok(xml.includes('<width>1080</width><height>1920</height>'), 'a vertical sequence');
  assert.ok(xml.includes('<in>') && xml.includes('take.mp4') && xml.includes('[death'));
  const csv = shortsCSV(shorts, new Map(recordings.map((r) => [r.id, r])));
  assert.ok(csv.split('\n')[0].startsWith('"recording","in","out"') && csv.includes('take.mp4'));
});

test('episode: the stretches spent in a zone, in order, with turn-in markers', () => {
  const [s] = sessions;
  const first = parsePoint(s.track[0]).t * 1000;
  const recordings = resolveRecordings([{ name: 'take.mp4', start_ms: first - 10_000, duration: 600, source: 'obs' }]);
  const toMs = (sess, t) => t * 1000;
  const align = aligner(recordings);
  const turnins = [];
  for (const sess of sessions) for (const e of sess.events) if (e.e === 'quest_turnin') { const hit = align(e.t * 1000); if (hit) turnins.push({ rec: hit.recording.id, offset: hit.offset, label: e.title, comment: e.z }); }
  const ep = assembleEpisode({ mapIds: [1429], sessions, tracks: new Map(), recordings, toMs, markers: turnins, minSeconds: 0 });
  assert.ok(ep.clips.length >= 1 && ep.duration > 0);
  assert.ok(ep.clips.every((c) => c.out > c.in));
  assert.ok(ep.markers.length >= 1, 'the turn-in is marked');
  assert.ok(ep.markers.every((m) => m.at >= 0 && m.at <= ep.duration));
  const xml = toEpisodeXML('Elwynn Forest', ep, recordings);
  assert.ok(xml.includes('Episode - Elwynn Forest') && xml.includes('<marker>'));
  assert.equal((xml.match(/<clipitem id="clipitem-v/g) || []).length, ep.clips.length);
  assert.ok(episodeChapters(ep).startsWith('0:00 Arrival'));
  const empty = assembleEpisode({ mapIds: [9999], sessions, tracks: new Map(), recordings, toMs });
  assert.equal(empty.clips.length, 0);
});

test('sequence XML lays clips end to end', () => {
  const xml = toSequenceXML({ name: 'x', fps: 30, clips: [{ file: { id: 'f1', name: 'a.mp4', duration: 100 }, in: 10, out: 20 }, { file: { id: 'f2', name: 'b.mp4', duration: 50 }, in: 0, out: 5 }], markers: [{ at: 12, name: 'm' }] });
  assert.ok(xml.includes('<start>0</start><end>300</end><in>300</in><out>600</out>'));
  assert.ok(xml.includes('<start>300</start><end>450</end><in>0</in><out>150</out>'));
  assert.ok(xml.includes('<duration>450</duration>') && xml.includes('<in>360</in><out>-1</out>'));
});

test('route replay: a plan over time, the route so far, frames drawn', () => {
  const routes = [
    { char: 'A', points: [[10, 10, 100, 0], [20, 10, 102, 0], [20, 20, 104, 0]] },
    { char: 'A', points: [[50, 50, 300, 0], [60, 50, 302, 0]] },
  ];
  const plan = planReplay(routes, { seconds: 4, fps: 10, gap: 2 });
  assert.equal(plan.frames, 40);
  assert.equal(plan.total, 8, '4 s walking, a 2 s gap, 2 s walking');
  assert.equal(routeAt(plan, 0)[0].points.length, 1);
  const half = routeAt(plan, 0.25);
  assert.equal(half.length, 1);
  assert.deepEqual([half[0].head.x, half[0].head.y], [20, 10], 'two seconds in, at the corner');
  const end = routeAt(plan, 1);
  assert.equal(end.length, 2);
  assert.equal(end[1].points.length, 2);
  assert.ok(easeProgress(0, 40) === 0 && easeProgress(39, 40) === 1 && easeProgress(20, 40) > 0.5);
  // A fake context records what was drawn.
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' || k === 'lineWidth' ? 1 : (...a) => calls.push([k, a])) });
  const drawn = drawReplayFrame(ctx, { width: 200, height: 100, image: null, plan, progress: 1 });
  assert.equal(drawn.length, 2);
  assert.ok(calls.some(([k]) => k === 'stroke') && calls.some(([k, a]) => k === 'lineTo' && a[0] === 40 && a[1] === 10), 'map percent scaled to the canvas');
});
