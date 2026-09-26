// The live link: chat log lines -> events -> running totals for the overlay.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseChatLine, parseItemLink, parseNativeLoot, parseProgress, decodeEvents, eventsFromChatLog, LiveState, counterValues, dropsBetween, pastLoot, randomToken } from '../web/lib/live.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lua = ['lua5.1', 'luajit', 'lua'].find((bin) => spawnSync(bin, ['-v']).status === 0);
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

test('chat log lines: time stamps, item links, the game\'s loot line and quest progress', () => {
  const line = parseChatLine('9/25 21:14:03.771  You receive loot: |cff1eff00|Hitem:1121::::::::1:::::::|h[Feet of the Lynx]|h|r.', NOW);
  assert.equal(new Date(line.at).getHours(), 21);
  assert.equal(new Date(line.at).getMonth(), 8);
  assert.equal(new Date(line.at).getMilliseconds(), 771);
  assert.equal(parseChatLine('not a log line', NOW), null);
  // A date later than today is from last year.
  assert.equal(new Date(parseChatLine('12/31 23:00:00.000  x', NOW).at).getFullYear(), 2025);
  assert.deepEqual(parseItemLink(line.text), { id: 1121, name: 'Feet of the Lynx', q: 2 });
  assert.deepEqual(parseNativeLoot(line.text), { kind: 'loot', id: 1121, name: 'Feet of the Lynx', q: 2, n: 1, source: null, sourceId: null });
  assert.equal(parseNativeLoot('You receive loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|rx2.').n, 2);
  assert.equal(parseNativeLoot('Bob receives loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|r.'), null);
  assert.deepEqual(parseProgress('Kobold Vermin slain: 3/10'), { label: 'Kobold Vermin slain', n: 3, m: 10 });
  assert.deepEqual(parseProgress('Linen Cloth: 7/8 (Bag 1)'), { label: 'Linen Cloth', n: 7, m: 8 });
  assert.equal(parseProgress('Not enough rage'), null);
});

test('the addon\'s packed lines decode into events', () => {
  const events = decodeEvents('[7. chron0abcdef1] [Aldric]: CHRON1~L~2589~Linen Cloth~1~2~Kobold Vermin~6~~Q~progress~-~Kobold Vermin slain: 2/10~~K~6~Kobold Vermin~~D~Hogger~448~~V~2~~H~2~50~400~Elwynn Forest~Northshire Valley~48~42~1050');
  assert.deepEqual(events.map((e) => e.kind), ['loot', 'quest', 'kill', 'death', 'level', 'heartbeat']);
  assert.deepEqual(events[0], { kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 2, source: 'Kobold Vermin', sourceId: 6 });
  assert.deepEqual(events[1], { kind: 'quest', action: 'progress', qid: null, title: null, text: 'Kobold Vermin slain: 2/10', xp: null, money: null });
  assert.deepEqual(events[3], { kind: 'death', killer: 'Hogger', killerId: 448 });
  assert.equal(events[5].zone, 'Elwynn Forest');
  assert.equal(events[5].money, 1050);
  assert.deepEqual(decodeEvents('[1. General] [Bob]: hello'), []);
  // An unknown kind is skipped, the rest kept.
  assert.deepEqual(decodeEvents('CHRON1~ZZ~x~~V~5').map((e) => e.kind), ['level']);
});

test('a chunk of chat log becomes events; the game\'s own loot lines only count without the link', () => {
  const chunk = [
    '9/25 14:13:34.000  To Aldric: CHRON1~B~0.4.1~Aldric~Mankrik~1~~K~6~Kobold Vermin',
    '9/25 14:13:34.000  Aldric whispers: CHRON1~B~0.4.1~Aldric~Mankrik~1~~K~6~Kobold Vermin',
    '9/25 14:13:35.000  You receive loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|rx2.',
    'garbage',
    '9/25 16:20:00.000  You receive loot: |cff1eff00|Hitem:1121::::::::1:::::::|h[Feet of the Lynx]|h|r.',
  ].join('\n');
  const { events, linkSeenAt } = eventsFromChatLog(chunk, { now: NOW });
  assert.deepEqual(events.map((e) => e.kind), ['begin', 'kill', 'loot']);
  assert.equal(events[2].name, 'Feet of the Lynx', 'two hours after the last link line, the game line counts');
  assert.ok(events[2].fromGame);
  assert.equal(new Date(linkSeenAt).getHours(), 14);
  const again = eventsFromChatLog('9/25 16:21:00.000  You receive loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|r.', { now: NOW, linkSeenAt: new Date(2026, 8, 25, 16, 20, 30).getTime() });
  assert.equal(again.events.length, 0, 'the link is alive, so the duplicate game line is ignored');
});

test('a whisper to yourself is logged twice; the echo is dropped, even across chunks, but a repeat later is not', () => {
  const one = eventsFromChatLog('9/25 14:13:34.000  To Aldric: CHRON1~K~6~Kobold Vermin', { now: NOW });
  assert.equal(one.events.length, 1);
  const two = eventsFromChatLog([
    '9/25 14:13:34.100  Aldric whispers: CHRON1~K~6~Kobold Vermin',
    '9/25 14:13:36.000  To Aldric: CHRON1~K~6~Kobold Vermin',
    '9/25 14:13:36.100  Aldric whispers: CHRON1~K~6~Kobold Vermin',
  ].join('\n'), { now: NOW, linkSeenAt: one.linkSeenAt, lastPayload: one.lastPayload });
  assert.equal(two.events.length, 1, 'the echo from the previous chunk is dropped; the second kill counts once');
});

test('running totals: drops, kills and streaks, deaths, quests, character', () => {
  const t0 = 1_000_000;
  const live = new LiveState(t0);
  const ev = (at, e) => live.apply({ at: t0 + at, ...e });
  ev(-5000, { kind: 'kill', npcId: 1, name: 'Old' });
  assert.equal(live.kills, 0, 'events from before the session start are ignored');
  ev(100, { kind: 'begin', name: 'Aldric', realm: 'Mankrik', level: 5 });
  ev(200, { kind: 'quest', action: 'accept', qid: 7, title: 'Kobold Camp Cleanup' });
  ev(1000, { kind: 'kill', npcId: 6, name: 'Kobold Vermin' });
  ev(1100, { kind: 'quest', action: 'progress', text: 'Kobold Vermin slain: 1/10' });
  ev(3000, { kind: 'kill', npcId: 6, name: 'Kobold Vermin' });
  ev(5000, { kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 2, source: 'Kobold Vermin', sourceId: 6 });
  ev(5100, { kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 1, source: 'Kobold Worker', sourceId: 257 });
  ev(5200, { kind: 'loot', id: 1121, name: 'Feet of the Lynx', q: 2, n: 1, source: 'Kobold Vermin', sourceId: 6 });
  ev(30000, { kind: 'kill', npcId: 448, name: 'Hogger' });
  ev(31000, { kind: 'death', killer: 'Hogger', killerId: 448 });
  ev(40000, { kind: 'quest', action: 'progress', text: 'Kobold Vermin slain: 10/10' });
  ev(41000, { kind: 'quest', action: 'turnin', qid: 7, title: 'Kobold Camp Cleanup', xp: 170, money: 50 });
  ev(42000, { kind: 'level', level: 6 });
  ev(43000, { kind: 'heartbeat', level: 6, xp: 10, xpMax: 900, zone: 'Elwynn Forest', sub: 'Goldshire', x: 40, y: 60, money: 1500 });
  assert.equal(live.kills, 3);
  assert.equal(live.bestStreak, 2, 'two kills within 12 seconds, then a gap');
  assert.equal(live.deaths, 1);
  assert.equal(live.streak, 0, 'a death ends the streak');
  const snap = live.snapshot(t0 + 44000);
  assert.deepEqual(snap.drops.map((d) => [d.id, d.n, d.times]), [[2589, 3, 2], [1121, 1, 1]]);
  assert.deepEqual(snap.drops[0].sources, { 'Kobold Vermin': 2, 'Kobold Worker': 1 });
  assert.equal(snap.loot.length, 3);
  const q = snap.quests.find((x) => x.qid === 7);
  assert.equal(q.state, 'done');
  assert.deepEqual(q.objectives.map((o) => [o.label, o.n, o.m]), [['Kobold Vermin slain', 10, 10]]);
  assert.equal(snap.questsDone, 1);
  assert.equal(snap.character.level, 6);
  assert.equal(snap.character.zone, 'Elwynn Forest');
  assert.equal(snap.character.gold, 1500);
  assert.equal(snap.topKills[0].name, 'Kobold Vermin');
  assert.equal(snap.events.at(-1).kind, 'level');
  assert.ok(snap.events.every((e, i, a) => i === 0 || e.seq > a[i - 1].seq), 'events carry increasing sequence numbers');
  assert.equal(snap.killsPerMinute, 3 / (44 / 60) > 4 ? snap.killsPerMinute : snap.killsPerMinute);
});

test('item counters and drop summaries combine uploaded sessions with the live session', () => {
  const live = new LiveState(2000);
  live.uploadedUntil = 2500;
  live.apply({ at: 2400, kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 5 }); // already uploaded, not counted twice
  live.apply({ at: 3000, kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 2 });
  const past = [{ at: 1000, id: 2589, n: 3 }, { at: 2400, id: 2589, n: 5 }, { at: 2450, id: 1121, n: 1 }];
  const values = counterValues([{ id: 2589, name: 'Linen Cloth', mode: 'session' }, { id: 2589, name: 'Linen Cloth', mode: 'ongoing', add: 100 }, { id: 1121, mode: 'session' }], past, live);
  assert.deepEqual(values.map((v) => v.n), [7, 110, 1]);

  const sessions = [{ id: 's1', machine: 'Gaming PC', events: [
    { e: 'loot_window', t: 10, sources: [{ name: 'Kobold Vermin', id: 6 }] },
    { e: 'loot', t: 11, id: 2589, name: 'Linen Cloth', q: 1, n: 2 },
    { e: 'loot', t: 12, id: 25, name: 'Crafted', src: 'created', n: 1 },
    { e: 'loot', t: 20, id: 1121, name: 'Feet of the Lynx', q: 2, n: 1 },
  ] }];
  const loot = pastLoot(sessions, (s, e) => e.t * 1000);
  assert.deepEqual(loot.map((l) => [l.id, l.source]), [[2589, 'Kobold Vermin'], [1121, 'Kobold Vermin']]);
  const summary = dropsBetween([...loot, ...live.loot], 10000, 20000);
  assert.equal(summary.items, 3);
  assert.deepEqual(summary.rows.map((r) => [r.id, r.n]), [[1121, 1], [2589, 2]], 'rarest first');
  assert.equal(dropsBetween(loot, 0, 5000).items, 0);
  assert.match(randomToken(), /^[0-9a-f]{32}$/);
});

test('what the real addon sends decodes end to end', { skip: !lua && 'no Lua interpreter installed' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-')), 'Compendium.lua');
  const run = spawnSync(lua, [path.join(root, 'test/addon/harness.lua'), path.join(root, 'addon/Compendium'), out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const chatLog = fs.readFileSync(`${out}.chatlog.txt`, 'utf8');
  const { events } = eventsFromChatLog(chatLog, { now: NOW });
  const kinds = events.map((e) => e.kind);
  for (const k of ['begin', 'quest', 'kill', 'loot', 'money', 'level', 'heartbeat', 'xp', 'skill', 'zone', 'explore', 'mark', 'death', 'rare', 'test']) assert.ok(kinds.includes(k), `${k} arrives`);
  const live = new LiveState(0);
  for (const e of events) live.apply(e);
  assert.equal(live.kills, 3);
  assert.equal(live.deaths, 1);
  assert.equal(live.drops.get(2589).n, 2);
  assert.equal([...live.quests.values()].find((q) => q.qid === 7).state, 'done');
  assert.equal(live.character.level, 2);
  assert.ok(live.lastTestAt > 0, 'the test line is noted');
  assert.equal(events.filter((e) => e.fromGame).length, 1, 'the game\'s own loot line counts only hours after the last link line');
});
