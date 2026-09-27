import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexDB } from '../web/lib/questdb.js';
import { parseRoster, rosterText, rosterCoverage, mergeRoster, eligible } from '../web/lib/roster.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../web/data/classic/${n}.json`, import.meta.url), 'utf8'))[n];
const db = indexDB({ quests: load('quests'), npcs: load('npcs'), objects: load('objects'), zones: load('zones'), items: null });

const TEXT = `Daire\tFemale\tHuman\tMage\tHerbalism\tEnchanting
Hoxx  Male  Dwarf  Priest  Mining  Herbalism
Vallerie, Female, Night Elf, Druid, Herbalism, Alchemy
Peebs Female Gnome Rogue Skinning Leatherworking
Varena Female Orc Warrior Mining Blacksmithing
Semperus Male Undead Warlock Skinning Tailoring
Eigan Male Tauren Hunter Mining Engineering
Vesch Male Troll Shaman Herbalism Alchemy
Eriad Male Human Paladin Mining Blacksmithing`;

test('parseRoster reads a pasted table in any separator, two-word races included', () => {
  const r = parseRoster(TEXT);
  assert.equal(r.length, 9);
  assert.deepEqual(r[2], { name: 'Vallerie', sex: 'female', race: 'NightElf', cls: 'DRUID', professions: ['Herbalism', 'Alchemy'] });
  assert.equal(r[5].race, 'Scourge');
  assert.equal(r[8].cls, 'PALADIN');
  const again = parseRoster(rosterText(r));
  assert.deepEqual(again, r);
});

test('mergeRoster: characters from play fill in over the plan, professions from their skills', () => {
  const known = [{ key: 'Daire-Mankrik', name: 'Daire', info: { raceToken: 'Human', classToken: 'MAGE', sex: 'female' }, skills: [{ name: 'Herbalism', rank: 40 }, { name: 'Cooking', rank: 5 }] }];
  const r = mergeRoster(known, parseRoster(TEXT));
  const d = r.find((c) => c.name === 'Daire');
  assert.equal(d.planned, false);
  assert.deepEqual(d.professions.sort(), ['Enchanting', 'Herbalism']);
  assert.equal(r.filter((c) => c.planned).length, 8);
});

test('rosterCoverage: a full roster reaches nearly everything; the profession choices are the gaps', () => {
  const cov = rosterCoverage(db, parseRoster(TEXT));
  assert.equal(cov.characters, 9);
  assert.ok(cov.total > 3000);
  assert.ok(cov.reachable / cov.total > 0.9, `reachable ${cov.reachable} of ${cov.total}`);
  // what is missed is the race-and-class combinations the roster lacks (a Tauren druid, an Alliance warlock)
  assert.ok(cov.byReason.get('combination').some((e) => e.need === 'Tauren · Druid'));
  // every class and race is present, so nothing is locked by race or class alone
  assert.ok(!cov.byReason.has('race'), [...cov.byReason.keys()].join());
  assert.ok(!cov.byReason.has('class'));
  // one engineer: the gnome / goblin branches cannot both be walked
  const eng = cov.choices.find((g) => g.quests.some((q) => /Gnome Engineering/.test(q.n)));
  assert.ok(eng, 'engineering specialization is a choice');
  assert.ok(eng.coverable < eng.quests.length);
  assert.deepEqual(eng.characters, ['Eigan']);
  // one leatherworker: the three specializations are a choice too
  const lw = cov.choices.find((g) => g.characters.length === 1 && g.characters[0] === 'Peebs');
  assert.ok(lw);
});

test('rosterCoverage: an Alliance-only roster misses the Horde', () => {
  const cov = rosterCoverage(db, parseRoster('Daire Female Human Mage Herbalism Enchanting'));
  assert.ok(cov.byReason.get('race').length > 800);
  assert.ok(cov.byReason.get('class').length > 100, 'other classes');
  const prof = cov.byReason.get('profession') || [];
  assert.ok(prof.some((e) => /Blacksmith/.test(e.need)));
  assert.ok(cov.reachable < cov.total * 0.6);
  const q = db.quests.get(5283); // The Art of the Armorsmith
  assert.equal(eligible(q, parseRoster(TEXT)).map((c) => c.name).sort().join(), 'Eriad', 'the Alliance armorsmith quest: the Horde blacksmith has her own');
});
