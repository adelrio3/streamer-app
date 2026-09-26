// Bestiary, item catalog, vendors, character journeys, footage finder,
// highlights and search, built from the simulated play session.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters, recordingCharacters } from '../web/lib/journey.js';
import { findSegments, findHighlights, parsePoint, timeOfDay } from '../web/lib/footage.js';
import { buildTimelines, resolveRecordings, clockModel, recordingId } from '../web/lib/timeline.js';
import { buildCodex } from '../web/lib/codex.js';
import { buildIndex, search } from '../web/lib/search.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: null });

test('bestiary: sightings, kills, drops with rates, vendor, trainer, dialogue, killers', () => {
  const world = buildWorld(sessions, log.items, moment);
  const thug = world.byNpc.get('n38');
  assert.equal(thug.name, 'Defias Thug');
  assert.equal(thug.sightings, 1);
  assert.equal(thug.kills, 1);
  assert.equal(thug.loots, 1);
  assert.deepEqual(thug.drops.map((d) => [d.name, d.times, d.qty, d.rate]), [['Linen Cloth', 1, 2, 1], ['Refreshing Spring Water', 1, 1, 1]]);
  assert.equal(thug.moneyDrops, 1);
  assert.equal(thug.fights, 1);
  assert.equal(thug.minLevel, 3);
  const kobold = world.byNpc.get('n6');
  assert.equal(kobold.sightings, 3);
  assert.equal(kobold.kills, 2);
  const fang = world.byNpc.get('n471');
  assert.deepEqual(fang.ranks, ['rareelite']);
  assert.equal(fang.rare, true);
  const danil = world.byNpc.get('n152');
  assert.equal(danil.vendor.items.length, 2);
  assert.equal(danil.trainer.services.length, 2);
  assert.deepEqual(danil.titles, ['General Supplies']);
  assert.equal(world.vendors.length, 1);
  assert.equal(world.byNpc.get('n448').killedYou, 1);
  assert.ok(world.byNpc.get('n197').lines[0].text.startsWith('Gnolls'));
  assert.ok(world.byNpc.get('n823').quests.has('q7'));
});

test('items: full catalog info and every source', () => {
  const world = buildWorld(sessions, log.items, moment);
  const cloth = world.byItem.get(2589);
  assert.equal(cloth.quality, 1);
  assert.equal(cloth.info.sell, 13);
  assert.deepEqual(cloth.droppedBy.map((d) => [d.name, d.times, d.rate]), [['Defias Thug', 1, 1], ['Object 200', 1, 1], ['Solid Chest', 1, 1]], 'a corpse, an unnamed object and a chest');
  assert.equal(cloth.looted, 2);
  assert.deepEqual(cloth.costOf.map((c) => [c.name, c.value]), [['Gladius', 3]], 'used as currency');
  const gladius = world.byItem.get(2488);
  assert.deepEqual(gladius.soldBy.map((v) => [v.name, v.price, v.stock]), [['Brother Danil', 700, 2]]);
  assert.equal(gladius.equippedBy[0].slot, 16);
  const vest = world.byItem.get(1372);
  assert.deepEqual(vest.rewardFrom.map((r) => r.title), ['Kobold Camp Cleanup']);
  assert.equal(vest.icon, 135009);
});

test('character journey', () => {
  const [c] = buildCharacters(sessions, moment);
  assert.equal(c.name, 'Aldric');
  assert.equal(c.info.guild, 'Chroniclers');
  assert.equal(c.info.bind, "Lion's Pride Inn", 'latest hearthstone, not the one at login');
  assert.equal(c.questsDone, 1);
  assert.deepEqual(c.levels.map((l) => l.level), [2]);
  assert.deepEqual(c.gear.map((g) => [g.slotName, g.name]), [['Chest', 'Ragged Leather Vest'], ['Main hand', 'Gladius']]);
  assert.deepEqual(c.gearHistory.map((g) => g.name), ['Ragged Leather Vest', 'Gladius']);
  assert.equal(c.deaths[0].killer, 'Hogger');
  assert.equal(c.money.at(-1).total, 1025);
  assert.equal(c.skills[0].name, 'Mining');
  assert.ok(c.stats.length >= 1);
  assert.equal(c.zones[0].name, 'Elwynn Forest');
});

test('footage finder and highlights', () => {
  const [s] = sessions;
  s.machine = 'pc';
  const clock = clockModel([]);
  const first = parsePoint(s.track[0]).t * 1000;
  const recordings = resolveRecordings([{ name: 'take.mp4', start_ms: first - 10_000, duration: 600, source: 'obs' }]);
  const toMs = (sess, t) => t * 1000;
  const all = findSegments(sessions, new Map(), recordings, toMs, { minSeconds: 0 });
  assert.ok(all.length >= 1);
  assert.equal(all[0].zones[0], 'Elwynn Forest');
  const clean = findSegments(sessions, new Map(), recordings, toMs, { minSeconds: 0, ui: 'hidden' });
  assert.equal(clean.length, 1);
  assert.equal(clean[0].mounted, true);
  assert.equal(findSegments(sessions, new Map(), recordings, toMs, { minSeconds: 0, motion: 'flight' }).length, 1);
  assert.equal(timeOfDay(19 * 60 + 30), 'dusk');
  assert.equal(findSegments(sessions, new Map(), recordings, toMs, { minSeconds: 0, time: 'dawn' }).length, 0);

  const kinds = findHighlights(sessions, moment).map((h) => h.kind).sort();
  for (const k of ['close', 'death', 'rare', 'level', 'discovery', 'mark']) assert.ok(kinds.includes(k), k);

  const tl = buildTimelines(sessions, recordings, clock);
  assert.deepEqual(recordingCharacters(sessions, tl).get(recordingId('take.mp4')), ['Aldric']);
  const [c] = buildCharacters(sessions, moment, tl, recordings);
  assert.equal(c.recordings[0].name, 'take.mp4');
});

test('search finds quests, NPCs, items by tooltip text, vendors', () => {
  const codex = buildCodex(sessions);
  const world = buildWorld(sessions, log.items, moment);
  const characters = buildCharacters(sessions, moment);
  const index = buildIndex({ codex, world, characters });
  assert.equal(search(index, 'kobold camp')[0].type, 'Quest');
  assert.equal(search(index, 'humble')[0].title, 'Linen Cloth', 'flavor text');
  assert.equal(search(index, 'general supplies')[0].title, 'Brother Danil');
  assert.equal(search(index, 'spider')[0].title, 'Mother Fang');
  assert.ok(search(index, 'aldric').some((h) => h.type === 'Character'));
  assert.deepEqual(search(index, ''), []);
});

test('objects keep the name they were opened under, not the last tooltip on screen', () => {
  // Older addons named a cactus after whatever tooltip was last shown: a scorpid, a player, the apple itself.
  const win = (t, name) => ({ e: 'loot_window', t, z: 'Durotar', items: [{ id: 11583, name: 'Cactus Apple', n: 1 }], sources: [{ kind: 'GameObject', id: 171938, name }] });
  const sessions = [{ id: 'old', char: { name: 'Aldric', realm: 'Mankrik' }, events: [
    { e: 'npc', t: 1, name: 'Scorpid Worker', npcId: 3124, npcKind: 'Creature', z: 'Durotar' },
    win(2, null), win(3, null), win(4, 'Scorpid Worker'), win(5, 'Emogan-Mankrik'), win(6, 'Cactus Apple'), win(7, 'Scorpid Worker'), win(8, null),
  ] }];
  const world = buildWorld(sessions, [], (s, e) => ({ session: s.id, t: e.t, footage: null }));
  assert.deepEqual(world.objects.map((o) => [o.key, o.name, o.loots, o.unnamed]), [['o171938', 'Cactus Apple', 7, false]], 'one cactus, named after the majority vote, players and creatures excluded');
  assert.ok(world.creatures.some((c) => c.name === 'Scorpid Worker') || world.people.some((c) => c.name === 'Scorpid Worker'), 'the scorpid stays an NPC');
  assert.ok(!world.npcs.some((n) => n.name === 'Emogan-Mankrik'));
  // The new addon's own record settles it even against many wrong votes.
  const fixed = buildWorld([{ id: 'new', char: { name: 'Aldric', realm: 'Mankrik' }, events: [win(1, 'Wrong'), win(2, 'Wrong'), { e: 'object', t: 3, objId: 171938, name: 'Cactus Apple' }] }], [], (s, e) => ({ session: s.id, t: e.t, footage: null }));
  assert.equal(fixed.objects[0].name, 'Cactus Apple');
  // Never named: flagged, still one entry.
  const none = buildWorld([{ id: 'x', char: {}, events: [win(1, null), win(2, null)] }], [], (s, e) => ({ session: s.id, t: e.t, footage: null }));
  assert.deepEqual([none.objects[0].name, none.objects[0].unnamed], ['Object 171938', true]);
});

test('journal flags: items obtained versus seen, people met versus seen, critters in the bestiary', () => {
  const m = (s, e) => ({ session: s.id, t: e.t, footage: null });
  const sessions = [{ id: 'j', char: { name: 'Aldric', realm: 'Mankrik' }, events: [
    { e: 'npc', t: 1, name: 'Rabbit', npcId: 721, npcKind: 'Creature', ctype: 'Critter', z: 'Elwynn Forest' },
    { e: 'npc', t: 2, name: 'Innkeeper Farley', npcId: 295, npcKind: 'Creature', react: 5, z: 'Elwynn Forest' },
    { e: 'npc', t: 3, name: 'Marshal Dughan', npcId: 240, npcKind: 'Creature', react: 5, z: 'Elwynn Forest' },
    { e: 'gossip', t: 4, npc: 'Marshal Dughan', npcId: 240, text: 'Greetings.' },
    { e: 'loot', t: 5, id: 2589, name: 'Linen Cloth', n: 2 },
    { e: 'bags', t: 6, items: [{ id: 159, n: 3 }], money: 100 },
    { e: 'equip', t: 7, slot: 16, id: 2488, name: 'Gladius' },
  ] }];
  const world = buildWorld(sessions, [{ item_id: 6948, data: { name: 'Hearthstone', type: 'Miscellaneous' } }], m);
  const by = (id) => world.byItem.get(id);
  assert.equal(by(2589).obtained, true, 'looted');
  assert.equal(by(159).obtained, true, 'carried in bags');
  assert.equal(by(2488).obtained, true, 'worn');
  assert.equal(by(6948).obtained, false, 'only catalogued');
  const rabbit = world.creatures.find((n) => n.name === 'Rabbit');
  assert.ok(rabbit && rabbit.ctype === 'Critter', 'critters belong in the bestiary');
  const farley = world.people.find((n) => n.name === 'Innkeeper Farley');
  const dughan = world.people.find((n) => n.name === 'Marshal Dughan');
  assert.equal(farley.met, false, 'walked past');
  assert.equal(dughan.met, true, 'talked to');
});
