// Runs the real addon Lua against a fake WoW client (test/addon/harness.lua)
// and checks what it logged. Skipped when no Lua 5.1 interpreter is installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '../web/lib/luasv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lua = ['lua5.1', 'luajit', 'lua'].find((bin) => spawnSync(bin, ['-v']).status === 0);

test('addon logs a full play session', { skip: !lua && 'no Lua interpreter installed' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-')), 'Chronicler.lua');
  const run = spawnSync(lua, [path.join(root, 'test/addon/harness.lua'), path.join(root, 'addon/Chronicler'), out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const db = parseSavedVariables(fs.readFileSync(out, 'utf8')).ChroniclerDB;
  assert.equal(db.sessions.length, 1);
  assert.equal(db.schema, 2);
  const s = db.sessions[0];
  assert.equal(s.char.name, 'Aldric');
  assert.equal(s.char.classToken, 'PALADIN');
  assert.equal(s.build.interface, 11507);

  const events = s.events;
  const kinds = events.map((e) => e.e);
  const of = (k) => events.filter((e) => e.e === k);

  // The core story, in order.
  const core = kinds.filter((k) => ['session_start', 'quest_detail', 'quest_accept', 'quest_progress', 'quest_complete', 'quest_turnin', 'level', 'sync', 'death', 'session_end'].includes(k));
  assert.deepEqual(core, ['session_start', 'quest_detail', 'quest_accept', 'quest_progress', 'quest_complete', 'quest_turnin', 'level', 'sync', 'death', 'session_end']);

  // Timestamps are calibrated to sub-second precision after the first tick
  // and never go backwards.
  assert.ok(events.slice(1).some((e) => e.t % 1 !== 0));
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t);

  const detail = of('quest_detail')[0];
  assert.equal(detail.qid, 7);
  assert.equal(detail.npc, 'Deputy Willem');
  assert.equal(detail.npcId, 823);
  assert.match(detail.text, /cleansing\.\nA clan/);
  assert.equal(detail.z, 'Elwynn Forest');
  assert.equal(detail.x, 48);
  assert.deepEqual(detail.rewards, [{ id: 1372, n: 1, name: 'Ragged Leather Vest' }]);
  assert.equal(detail.rewardMoney, 50);

  assert.equal(of('quest_accept')[0].title, 'Kobold Camp Cleanup');
  assert.equal(of('quest_turnin')[0].title, 'Kobold Camp Cleanup');
  assert.equal(of('quest_abandon')[0].title, 'Kobold Camp Cleanup');

  const kills = of('kill');
  assert.equal(kills.length, 3, 'killing blow, DoT kill, the thug; not the stranger kill');
  assert.equal(kills[0].blow, true);
  assert.equal(kills[1].blow, undefined);

  const loot = of('loot');
  assert.equal(loot[0].name, 'Ragged Leather Vest');
  assert.equal(loot[1].n, 2);

  const speech = of('speech')[0];
  assert.equal(speech.speaker, 'Marshal McBride');
  assert.equal(speech.npcId, 197);

  assert.deepEqual(of('book')[0].pages, ['Here lie the brave.', 'May they rest.']);
  assert.deepEqual(of('gossip')[0].options, ['I would like to train.']);
  assert.equal(of('learn')[0].what, 'Holy Light');
  assert.equal(of('learn')[0].desc, 'Heals a friendly target.');
  assert.equal(of('explore')[0].area, 'Goldshire');

  const marks = of('mark');
  assert.deepEqual(marks.map((m) => [m.kind, m.note]), [['lore', undefined], ['shot', 'sunset over the lake'], ['mark', 'wolf pathing weird']]);
  assert.ok(of('sync')[0].t % 1 !== 0, 'sync has sub-second precision');

  // NPCs: every spawn once, from any source, with details when a unit was visible.
  const npcs = of('npc');
  const byName = Object.fromEntries(npcs.map((n) => [n.name, n]));
  assert.equal(npcs.filter((n) => n.name === 'Kobold Vermin').length, 3, 'one per spawn');
  assert.equal(byName['Defias Thug'].src, 'nameplate');
  assert.equal(byName['Defias Thug'].level, 3);
  assert.equal(byName['Mother Fang'].rank, 'rareelite');
  assert.equal(byName['Mother Fang'].family, 'Spider');
  assert.equal(byName['Mother Fang'].rare, true);
  assert.equal(byName['Young Wolf'].src, 'combat', 'fighting nearby');
  assert.equal(byName['Young Wolf'].react, 4, 'neutral from combat log flags');
  assert.equal(byName['Marshal McBride'].src, 'speech');
  assert.equal(byName['Brother Danil'].title, 'General Supplies');

  // Fights, death.
  const fight = of('fight')[0];
  assert.equal(fight.close, true);
  assert.equal(fight.minHp, 12);
  assert.equal(fight.done, 90);
  assert.equal(fight.taken, 88);
  assert.equal(fight.enemies[0].name, 'Defias Thug');
  assert.deepEqual(of('death')[0].killer, 'Hogger');

  // Loot window with its source; opened twice, recorded once. Then a cactus,
  // an object you only interact with, named from the opening cast.
  const lw = of('loot_window');
  assert.equal(lw.length, 2);
  assert.deepEqual(lw[0].items.map((i) => [i.id, i.n]), [[2589, 2], [159, 1]]);
  assert.equal(lw[0].money, '12 Copper');
  assert.equal(lw[0].sources[0].name, 'Defias Thug');
  assert.deepEqual(lw[1].sources[0], { kind: 'GameObject', id: 171938, name: 'Cactus Apple' });
  assert.deepEqual(of('object').map((e) => [e.objId, e.name]), [[171938, 'Cactus Apple']]);
  assert.equal(db.objects[171938], 'Cactus Apple');

  // Vendor stock, trainer, flights, hearthstone, money with context.
  const vendor = of('vendor')[0];
  assert.equal(vendor.npc, 'Brother Danil');
  assert.equal(vendor.items[1].stock, 2);
  assert.deepEqual(vendor.items[1].costs, [{ id: 2589, name: 'Linen Cloth', value: 3 }]);
  assert.equal(of('trainer')[0].services[0].cost, 100);
  assert.equal(of('taxi_map')[0].nodes[1].name, 'Sentinel Hill');
  assert.equal(of('flight')[0].to, 'Sentinel Hill');
  assert.equal(of('flight_end').length, 1);
  assert.equal(of('bind')[0].where, "Lion's Pride Inn");
  assert.deepEqual(of('money').map((m) => [m.delta, m.ctx]), [[50, 'quest'], [-25, 'merchant']]);

  // Character: gear, talents, stats, reputation, skills, bags.
  assert.equal(of('gear')[0].slots[0].name, 'Ragged Leather Vest');
  assert.deepEqual(of('equip').map((e) => [e.slot, e.name]), [[16, 'Gladius']]);
  assert.equal(of('talents').at(-1).tabs[0].talents[0].name, 'Divine Strength');
  assert.equal(of('stats')[0].stats.armor, 45);
  assert.equal(of('reputation')[0].factions[0].name, 'Stormwind');
  assert.equal(of('skills')[0].skills[0].name, 'Mining');
  assert.deepEqual(of('bags')[0].items, [{ id: 159, n: 5 }]);
  assert.equal(of('rep')[0].amount, 25);
  assert.equal(of('xp')[0].amount, 45);
  assert.equal(s.char.guild, 'Chroniclers');

  // Screenshots, social.
  assert.deepEqual(of('screenshot').map((e) => e.reason).sort(), ['death', 'discovery', 'level', 'rare']);
  assert.deepEqual(of('chat').map((c) => c.text), ['anyone for Hogger?'], 'only after /chron social on');

  // Track: compact points, standing still skipped, flags for mounted + UI hidden.
  assert.ok(s.track.length >= 5);
  const flags = s.track.map((p) => Number(p.split(',')[6]));
  assert.ok(flags.includes(1 + 128), 'mounted with the UI hidden');
  assert.ok(flags.includes(2), 'on a flight path');

  // Item catalog: every line of the tooltip, stats, use effects; late items too.
  const items = Object.values(db.items);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId[2589].tip[1], 'Stitched together from threads spun by the humble.|ffd100', 'flavor text with its gold colour');
  assert.equal(byId[2589].sell, 13);
  assert.deepEqual(byId[2488].stats, { ITEM_MOD_STRENGTH_SHORT: 1 });
  assert.equal(byId[159].spell, 'Drink');
  assert.equal(byId[1372].icon, 135009);
  assert.ok(items.every((i) => i.scanned));

  assert.equal(of('death')[0].x, undefined, 'no coordinates when the map has none');
});

test('the .toc loads on the current Classic Era client (1.15.9)', () => {
  const toc = fs.readFileSync(path.join(root, 'addon/Chronicler/Chronicler.toc'), 'utf8');
  const versions = /^## Interface:(.*)$/m.exec(toc)[1].split(',').map((s) => Number(s.trim()));
  assert.ok(versions.includes(11509));
  assert.ok(/^Boot\.lua\s*$/m.test(toc) && toc.indexOf('Boot.lua') < toc.indexOf('Chronicler.lua'));
});
