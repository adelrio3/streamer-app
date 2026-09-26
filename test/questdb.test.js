import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildCodex } from '../web/lib/codex.js';
import { indexDB, fits, questState, waitingOn, zoneCoverage, allZones, unfoundGivers, zoneRares, rarePins, progressSets, givers, objectives, searchEntries } from '../web/lib/questdb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'data', 'classic', name), 'utf8'));
const data = { quests: json('quests.json').quests, npcs: json('npcs.json').npcs, objects: json('objects.json').objects, items: json('items.json').items, zones: json('zones.json').zones };
const spawns = json('spawns.json').spawns;
const db = indexDB(data);
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const codex = buildCodex(log.sessions);
const human = { raceToken: 'Human', classToken: 'PALADIN', faction: 'Alliance' };
const orc = { raceToken: 'Orc', classToken: 'WARRIOR', faction: 'Horde' };

test('the imported database knows zones, quests and who gives them', () => {
  assert.equal(db.zoneId('Elwynn Forest'), 12);
  assert.equal(db.zoneId('elwynn forest'), 12, 'names match loosely');
  assert.equal(db.zoneName(9), 'Northshire Valley');
  assert.equal(db.zones[9].p, 12, 'Northshire is filed under Elwynn Forest');
  const q = db.quests.get(7);
  assert.equal(q.n, 'Kobold Camp Cleanup');
  assert.equal(q.zone, 12, 'quests in Northshire count for Elwynn Forest');
  assert.deepEqual(givers(db, q).map((g) => [g.kind, g.name, g.zone]), [['npc', 'Marshal McBride', 12]]);
  assert.deepEqual(objectives(db, q).map((o) => [o.kind, o.name]), [['kill', 'Kobold Vermin']]);
  assert.equal(db.item(182), "Garrick's Head");
  assert.ok(db.quests.size > 3800);
  assert.ok(searchEntries(db).length > 4000);
});

test('quest states follow faction, level and prerequisites', () => {
  assert.ok(fits(db.quests.get(7), human));
  assert.ok(!fits(db.quests.get(7), orc));
  assert.ok(fits(db.quests.get(7), null), 'anyone');
  const { done, active } = progressSets(codex.quests);
  assert.ok(done.has(7), 'the fixture turned in Kobold Camp Cleanup');
  const ctx = { who: human, level: 1, done, active };
  assert.equal(questState(db.quests.get(7), ctx), 'done');
  assert.equal(questState(db.quests.get(15), ctx), 'ready', 'next in chain, level 1');
  assert.equal(questState(db.quests.get(783), ctx), 'excluded', 'its follow-up is already done');
  assert.equal(questState(db.quests.get(18), ctx), 'later', 'needs A Threat Within');
  assert.deepEqual(waitingOn(db, db.quests.get(18), ctx), ['level 2', 'A Threat Within']);
  assert.equal(questState(db.quests.get(176), ctx), 'later', 'Hogger needs level 5');
  assert.deepEqual(waitingOn(db, db.quests.get(176), ctx), ['level 5']);
  assert.equal(questState(db.quests.get(176), { ...ctx, level: 10 }), 'ready');
  assert.equal(questState(db.quests.get(6), { ...ctx, who: orc }), 'other');
  assert.equal(questState(db.quests.get(18), { ...ctx, level: 2, done: new Set([7, 783]) }), 'ready');
});

test('zone coverage, unfound quest givers and rares', () => {
  const { done, active } = progressSets(codex.quests);
  const ctx = { who: human, level: 1, done, active };
  const cov = zoneCoverage(db, 'Elwynn Forest', ctx);
  assert.ok(cov.total > 40 && cov.total < 80, `Elwynn has ${cov.total} quests`);
  assert.equal(cov.done, 1);
  assert.equal(cov.counts.done, 1);
  assert.ok(cov.counts.ready >= 1 && cov.counts.later >= 1);
  assert.equal(cov.rows[0].state, 'ready', 'ready quests come first');
  assert.equal(zoneCoverage(db, 'Nowhere', ctx), null);

  const pins = unfoundGivers(db, spawns, cov, { seen: new Set([823]) });
  assert.ok(!pins.some((p) => p.npcId === 823), 'Deputy Willem was already met');
  const mcbride = pins.find((p) => p.npcId === 197);
  assert.ok(mcbride, 'Marshal McBride still has quests');
  assert.deepEqual([mcbride.x, mcbride.y], [48.9, 41.6]);
  assert.ok(mcbride.quests.some((x) => x.id === 15 && x.state === 'ready'));
  assert.equal(mcbride.layer, 'unfound');

  const rares = zoneRares(db, spawns, 12, { killed: new Set([471]) });
  const fang = rares.find((r) => r.name === 'Mother Fang');
  assert.ok(fang && fang.killed && fang.rank === 'rare');
  assert.ok(rares.some((r) => r.name === 'Hogger') === false, 'Hogger is elite, not rare');
  assert.ok(rarePins(rares).some((p) => p.npcId === 471 && p.layer === 'rares'));

  const zones = allZones(db, ctx);
  const elwynn = zones.find((z) => z.zoneId === 12);
  assert.equal(elwynn.name, 'Elwynn Forest');
  assert.equal(elwynn.mapId, 1429);
  assert.equal(elwynn.done, 1);
  const durotar = zones.find((z) => z.zoneId === 14);
  assert.ok(durotar.total <= 2, 'next to nothing a human can do in Durotar');
  assert.ok(durotar.counts.other > 30);
});
