#!/usr/bin/env node
// Imports the Classic quest database from Questie into web/data/classic/*.json
// so the app can tell you which quests, quest givers and rares in a zone you
// have not found yet.
//
//   node tools/import-questie.js <path to QuestieDB repo> [<path to Questie repo>]
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/Questie/QuestieDB
//   (cd QuestieDB && git sparse-checkout set data/Classic src)
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/Questie/Questie
//   (cd Questie && git sparse-checkout set Database Localization)
//
// The data is Questie's (https://github.com/Questie/Questie, GPL-3.0); the
// generated files say so in their `source` field. The Questie repo is only
// needed for the English zone names and the list of quests that are not in
// the game; without it names are derived from Questie's constants.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '../web/lib/luasv.js';
import { CLASSIC_ZONE_IDS } from '../web/lib/maps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dbRepo, questieRepo] = process.argv.slice(2);
if (!dbRepo) {
  console.error('usage: node tools/import-questie.js <QuestieDB repo> [<Questie repo>]');
  process.exit(1);
}
const outDir = path.join(root, 'web', 'data', 'classic');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const dataDir = path.join(dbRepo, 'data', 'Classic');
const enumDir = path.join(dbRepo, 'src', 'corrections', 'enum');
const fixDir = path.join(dbRepo, 'src', 'corrections', 'Era');

// Column numbers of the database rows (QuestieDB.questKeys and friends).
const QK = {
  name: 1, startedBy: 2, finishedBy: 3, requiredLevel: 4, questLevel: 5, requiredRaces: 6, requiredClasses: 7,
  objectivesText: 8, triggerEnd: 9, objectives: 10, sourceItemId: 11, preQuestGroup: 12, preQuestSingle: 13,
  childQuests: 14, inGroupWith: 15, exclusiveTo: 16, zoneOrSort: 17, requiredSkill: 18, requiredMinRep: 19,
  requiredMaxRep: 20, requiredSourceItems: 21, nextQuestInChain: 22, questFlags: 23, specialFlags: 24,
  parentQuest: 25, reputationReward: 26, breadcrumbForQuestId: 27, breadcrumbs: 28, extraObjectives: 29,
  requiredSpell: 30, requiredSpecialization: 31, requiredMaxLevel: 32, availableUntilCompleted: 33,
  availableStartingWith: 34, requiredRanks: 35, disabledByQuest: 36,
};
const NK = {
  name: 1, minLevelHealth: 2, maxLevelHealth: 3, minLevel: 4, maxLevel: 5, rank: 6, spawns: 7, waypoints: 8,
  zoneID: 9, questStarts: 10, questEnds: 11, factionID: 12, friendlyToFaction: 13, subName: 14, npcFlags: 15,
};
const OK = { name: 1, questStarts: 2, questEnds: 3, spawns: 4, zoneID: 5, factionID: 6, waypoints: 7 };

// Sub-areas Questie files quests under, and the zone they belong to (the
// zone the game names when you stand there). AreaTable.dbc ids.
const PARENT = {
  9: 12, 87: 12, 59: 12, 60: 12, 86: 12, 6170: 12, // Northshire, Goldshire, ... -> Elwynn Forest
  132: 1, 131: 1, 133: 1, 135: 1, 189: 1, 800: 1, 801: 1, 6176: 1, 6457: 1, 6137: 1, // Coldridge, Kharanos, ... -> Dun Morogh
  154: 85, 155: 85, 152: 85, 6454: 85, // Deathknell, Night's Web Hollow, ... -> Tirisfal Glades
  188: 141, 257: 141, 6450: 141, // Shadowglen, Shadowthread Cave -> Teldrassil
  363: 14, 365: 14, 6451: 14, 6453: 14, // Valley of Trials, Burning Blade Coven, Echo Isles -> Durotar
  220: 215, 221: 215, 6452: 215, // Red Cloud Mesa, Camp Narache -> Mulgore
  392: 17, 4709: 17, 6511: 17, // Ratchet, Southern Barrens, Wailing Caverns entrance -> The Barrens
  442: 148, 4913: 148, // Auberdine, Spitescale Cavern -> Darkshore
  146: 38, // Stonewrought Dam -> Loch Modan
  2079: 15, // Alcaz Island -> Dustwallow Marsh
  5287: 33, 5339: 33, // The Cape of Stranglethorn -> Stranglethorn Vale
  2918: 1519, 2257: 1519, // Champion's Hall, Deeprun Tram -> Stormwind City
  2917: 1637, // Hall of Legends -> Orgrimmar
  1585: 1584, // Shadowforge City -> Blackrock Depths
  1477: 1417, // The Temple of Atal'Hakkar -> Sunken Temple
  1517: 1337, // Uldaman's entrance -> Uldaman
  1717: 491, // Razorfen Kraul's entrance -> Razorfen Kraul
  978: 1176, // Zul'Farrak's entrance -> Zul'Farrak
  702: 141, // Rut'theran Village -> Teldrassil
  1116: 357, // Feathermoon Stronghold -> Feralas
  1769: 361, // Timbermaw Hold -> Felwood
};
// Names for ids that are not in Questie's constants.
const EXTRA_NAMES = {
  9: 'Northshire Valley', 87: 'Goldshire', 59: 'Northshire Abbey', 60: 'Northshire Vineyards', 86: 'Northshire Vineyards',
  132: 'Coldridge Valley', 189: 'Anvilmar', 800: 'Coldridge Pass', 154: 'Deathknell', 152: 'The Bulwark',
  188: 'Shadowglen', 363: 'Valley of Trials', 220: 'Red Cloud Mesa', 221: 'Camp Narache',
  1517: 'Uldaman', 1717: 'Razorfen Kraul', 978: "Zul'Farrak", 702: "Rut'theran Village", 1116: 'Feathermoon Stronghold',
  1769: 'Timbermaw Hold', 25: 'Blackrock Mountain',
};
const SORT_NAMES = {
  HALLOWS_END: "Hallow's End", AHN_QIRAJ_WAR: "Ahn'Qiraj War", PILGRIMS_BOUNTY: "Pilgrim's Bounty",
  LOVE_IS_IN_THE_AIR: 'Love is in the Air', CHILDRENS_WEEK: "Children's Week", DAY_OF_THE_DEAD: 'Day of the Dead',
  WINTER_VEIL: 'Feast of Winter Veil', SPECIALTEMP: 'Special', DEATHKNIGHT: 'Death Knight',
};
const SORT_KIND = {
  class: new Set(['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID', 'DEATHKNIGHT', 'MONK']),
  profession: new Set(['HERBALISM', 'FISHING', 'BLACKSMITHING', 'ALCHEMY', 'LEATHERWORKING', 'ENGINEERING', 'TAILORING', 'COOKING', 'FIRST_AID', 'RIDING', 'ARCHAEOLOGY', 'JEWELCRAFTING', 'INSCRIPTION']),
};

function titleCase(constant) {
  return constant.toLowerCase().split('_').map((w) => (['of', 'the', 'and', 'in', 'is'].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ').replace(/^the /, 'The ').replace(/^of /, 'Of ');
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// `[key] = value,` pairs of a Lua table block that starts with `header`.
function constants(text, header, indent = '') {
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`${header} not found`);
  const body = text.slice(start + header.length);
  const end = body.search(new RegExp(`^${indent}\\}`, 'm'));
  const out = {};
  for (const m of body.slice(0, end).matchAll(/^\s*\[?['"]?([A-Za-z_0-9]+)['"]?\]?\s*=\s*(-?\d+)\s*,/gm)) out[m[1]] = Number(m[2]);
  return out;
}

// The rows of one of Questie's data files (a Lua table inside a long string).
function rows(file, variable) {
  const text = read(dataDir, file);
  const head = `QuestieDB.${variable} = [[return `;
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${variable} not found in ${file}`);
  const end = text.indexOf(']]', start);
  const table = parseSavedVariables(`X = ${text.slice(start + head.length, end)}`).X;
  const out = new Map();
  for (const [id, row] of Object.entries(table)) out.set(Number(id), row);
  return out;
}

const at = (row, i) => (row == null ? undefined : Array.isArray(row) ? row[i - 1] : row[String(i)]);
const setAt = (row, i, v) => { if (Array.isArray(row)) row[i - 1] = v; else row[String(i)] = v; };
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : Object.values(v));
const isEmpty = (v) => v == null || (typeof v === 'object' && Object.keys(v).length === 0);

// Corrections: `[id] = { [questKeys.x] = value, ... }` entries of a Lua table,
// with Questie's constants replaced by their values.
function corrections(text, consts, from = /^    return \{$/m) {
  const start = text.search(from);
  if (start < 0) return new Map();
  const lines = text.slice(start).split('\n').slice(1);
  const out = new Map();
  const failed = [];
  let id = null;
  let buf = [];
  const flush = () => {
    if (id == null) return;
    const entry = parseEntry(buf.join('\n'), consts);
    if (entry) out.set(id, entry); else failed.push(id);
    id = null;
    buf = [];
  };
  for (const line of lines) {
    if (/^    \}/.test(line)) break;
    const m = /^        \[(\d+)\] = \{/.exec(line);
    if (m) { flush(); id = Number(m[1]); buf = [line.replace(/^        \[\d+\] = /, '')]; continue; }
    if (id != null) buf.push(line);
  }
  flush();
  if (failed.length) console.warn(`  ${failed.length} correction entries could not be read and were skipped (${failed.slice(0, 8).join(', ')}${failed.length > 8 ? ', …' : ''})`);
  return out;
}

function substitute(text, consts) {
  let missing = false;
  let t = text
    .replace(/l10n\("((?:[^"\\]|\\.)*)"\)/g, '"$1"')
    .replace(/Questie\.ICON_TYPE_[A-Z_]+/g, '0')
    .replace(/\(\{[^]*?\}\)\[playerClass\]/g, 'nil')
    .replace(/\b(waypointPresets|phases|Phasing)\.[A-Za-z_0-9.]+/g, 'nil')
    .replace(/\b(questKeys|zoneIDs|raceIDs|classIDs|sortKeys|specialFlags|profKeys|specKeys|factionIDs|rankKeys|npcKeys|objectKeys|npcFlags|itemKeys)\.([A-Za-z_0-9]+)\b/g, (m, group, key) => {
      const v = consts[group]?.[key];
      if (v === undefined) { missing = true; return 'nil'; }
      return String(v);
    });
  // raceIDs.HUMAN + raceIDs.DWARF
  t = t.replace(/=\s*(-?\d+(?:\s*\+\s*-?\d+)+)\s*,/g, (m, expr) => `= ${expr.split('+').reduce((a, b) => a + Number(b), 0)},`);
  return { text: t, missing };
}

function parseEntry(text, consts) {
  const { text: t } = substitute(text, consts);
  try {
    return parseSavedVariables(`X = ${t}`).X;
  } catch {
    // One key per line, skipping the ones that do not parse on their own.
    const out = {};
    let any = false;
    for (const line of t.split('\n')) {
      const m = /^\s*\[(\d+)\] = (.*?),?\s*(?:--.*)?$/.exec(line);
      if (!m) continue;
      try { out[m[1]] = parseSavedVariables(`X = ${m[2]}`).X; any = true; } catch { /* skip */ }
    }
    return any ? out : null;
  }
}

// Applies corrections: `{}` clears a field, anything else replaces it. Lists
// of quest starters / enders and spawns from faction-specific corrections are
// merged instead, since the same data serves both factions here.
function apply(table, fixes, { merge = false, mergeKeys = [] } = {}) {
  let n = 0;
  for (const [id, entry] of fixes) {
    let row = table.get(id);
    if (!row) {
      if (entry['1'] == null) continue;
      row = {};
      table.set(id, row);
    }
    for (const [k, v] of Object.entries(entry)) {
      const key = Number(k);
      const value = isEmpty(v) ? undefined : v;
      if (merge && mergeKeys.includes(key) && value !== undefined && at(row, key) != null) {
        setAt(row, key, mergeLists(at(row, key), value));
      } else if (!merge || at(row, key) == null || mergeKeys.includes(key)) {
        setAt(row, key, value);
      }
      n++;
    }
  }
  return n;
}

function mergeLists(a, b) {
  if (Array.isArray(a) && Array.isArray(b) && (a.length === 0 || typeof a[0] !== 'object')) return [...new Set([...a, ...b])];
  if (typeof a === 'object' && typeof b === 'object') {
    const out = Array.isArray(a) ? [...a] : { ...a };
    for (const [k, v] of Object.entries(b)) {
      const cur = at(out, Number(k));
      setAt(out, Number(k), cur == null ? v : mergeLists(cur, v));
    }
    return out;
  }
  return b;
}

// --- Read everything -------------------------------------------------------

console.log('Reading Questie constants…');
const zoneIDs = constants(read(enumDir, 'zones.lua'), 'constants.zoneIDs = {');
const sortKeys = constants(read(enumDir, 'quests.lua'), 'constants.sortKeys = {');
const specialFlags = constants(read(enumDir, 'quests.lua'), 'constants.specialFlags = {');
const factionIDs = constants(read(enumDir, 'factions.lua'), 'constants.factionIDs = {');
const profKeys = constants(read(enumDir, 'professions.lua'), 'constants.professionKeys = {');
const specKeys = constants(read(enumDir, 'professions.lua'), 'constants.specializationKeys = {');
const rankKeys = constants(read(enumDir, 'professions.lua'), 'constants.rankNames = {');
const expansions = read(enumDir, 'expansions.lua');
const classic = expansions.slice(expansions.indexOf('Classic = {'));
const classIDs = constants(classic, 'classKeys = {', '    ');
const raceIDs = constants(classic, 'raceKeys = {', '    ');
const npcFlags = constants(classic, 'npcFlags = {', '    ');
const consts = { questKeys: QK, npcKeys: NK, objectKeys: OK, zoneIDs, sortKeys, specialFlags, factionIDs, profKeys, specKeys, rankKeys, classIDs, raceIDs, npcFlags, itemKeys: {} };

console.log('Reading quests, NPCs, objects and items…');
const quests = rows('classicQuestDB.lua', 'questData');
const npcs = rows('classicNpcDB.lua', 'npcData');
const objects = rows('classicObjectDB.lua', 'objectData');
const itemRows = rows('classicItemDB.lua', 'itemData');
const IK = { name: 1, itemLevel: 9, requiredLevel: 10, class: 12, subClass: 13 };
const itemNames = new Map();
for (const [id, row] of itemRows) if (at(row, IK.name)) itemNames.set(id, at(row, IK.name));
console.log(`  ${quests.size} quests, ${npcs.size} NPCs, ${objects.size} objects, ${itemNames.size} item names`);

console.log('Applying corrections…');
const questFixesText = read(fixDir, 'classicQuestFixes.lua');
const factionPart = questFixesText.indexOf('function QuestieQuestFixes:LoadFactionFixes()');
let n = apply(quests, corrections(questFixesText.slice(0, factionPart), consts));
for (const side of ['questFixesHorde', 'questFixesAlliance']) {
  n += apply(quests, corrections(questFixesText, consts, new RegExp(`^    local ${side} = \\{$`, 'm')), { merge: true, mergeKeys: [QK.startedBy, QK.finishedBy] });
}
const npcFixesText = read(fixDir, 'classicNPCFixes.lua');
const npcFactionPart = npcFixesText.indexOf('function QuestieNPCFixes:LoadFactionFixes()');
n += apply(npcs, corrections(npcFactionPart > 0 ? npcFixesText.slice(0, npcFactionPart) : npcFixesText, consts));
for (const side of ['npcFixesHorde', 'npcFixesAlliance']) {
  n += apply(npcs, corrections(npcFixesText, consts, new RegExp(`^    local ${side} = \\{$`, 'm')), { merge: true, mergeKeys: [NK.spawns, NK.questStarts, NK.questEnds] });
}
const objectFixesText = read(fixDir, 'classicObjectFixes.lua');
const objectFactionPart = objectFixesText.indexOf('function QuestieObjectFixes:LoadFactionFixes()');
n += apply(objects, corrections(objectFactionPart > 0 ? objectFixesText.slice(0, objectFactionPart) : objectFixesText, consts));
for (const side of ['objectFixesHorde', 'objectFixesAlliance']) {
  n += apply(objects, corrections(objectFixesText, consts, new RegExp(`^    local ${side} = \\{$`, 'm')), { merge: true, mergeKeys: [OK.spawns, OK.questStarts, OK.questEnds] });
}
console.log(`  ${n} corrected fields`);

// Quests Questie hides because they are not in the game (duplicates, unused).
const hidden = new Set();
if (questieRepo) {
  const text = read(questieRepo, 'Database', 'Corrections', 'QuestieQuestBlacklist.lua');
  const body = text.slice(text.indexOf('local questsToBlacklist = {'));
  const block = body.slice(0, body.search(/^    \}/m));
  for (const m of block.matchAll(/^\s*\[(\d+)\] = (.+?),\s*(?:--.*)?$/gm)) {
    const expr = m[2]
      .replace(/Expansions\.Current/g, '1').replace(/Expansions\.Era/g, '1').replace(/Expansions\.Tbc/g, '2').replace(/Expansions\.Wotlk/g, '3').replace(/Expansions\.Cata/g, '4').replace(/Expansions\.MoP/g, '5')
      .replace(/Questie\.Is(Era|Classic)\b/g, 'true').replace(/Questie\.Is\w+/g, 'false')
      .replace(/\bnot\b/g, '!').replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/~=/g, '!==').replace(/(?<![=!<>])=(?!=)/g, '==');
    let hide = false;
    try { hide = Boolean(new Function(`return (${expr});`)()); } catch { hide = false; }
    if (hide) hidden.add(Number(m[1]));
  }
  console.log(`  ${hidden.size} quests are not in the game (Questie's blacklist)`);
} else {
  console.warn('  no Questie repo given: quests that are not in the game are kept');
}

// --- Zones -----------------------------------------------------------------

const english = new Set();
if (questieRepo) {
  const dir = path.join(questieRepo, 'Localization', 'Translations', 'Zones');
  for (const f of fs.readdirSync(dir)) for (const m of read(dir, f).matchAll(/^\s{4}\["((?:[^"\\]|\\.)*)"\] = \{/gm)) english.add(m[1].replace(/\\"/g, '"'));
}
const byNorm = new Map([...english].map((name) => [norm(name), name]));
const uiMap = {};
for (const [ui, area] of Object.entries(CLASSIC_ZONE_IDS)) if (!uiMap[area]) uiMap[area] = Number(ui);
const zones = {};
for (const [constant, id] of Object.entries(zoneIDs)) {
  const name = EXTRA_NAMES[id] ?? byNorm.get(norm(constant)) ?? titleCase(constant);
  zones[id] = { n: name, m: uiMap[id] ?? null, p: PARENT[id] ?? null };
}
for (const [id, name] of Object.entries(EXTRA_NAMES)) zones[id] ??= { n: name, m: uiMap[id] ?? null, p: PARENT[id] ?? null };
for (const [constant, id] of Object.entries(sortKeys)) {
  const kind = SORT_KIND.class.has(constant) ? 'class' : SORT_KIND.profession.has(constant) ? 'profession' : 'category';
  zones[id] = { n: SORT_NAMES[constant] ?? titleCase(constant), kind };
}
const zoneOf = (id) => (id > 0 ? (PARENT[id] ?? id) : null);

// --- Build the output ------------------------------------------------------

const questOut = {};
const usedNpcs = new Set();
const usedObjects = new Set();
const usedItems = new Set();
const unknownZones = new Map();
const numList = (v) => list(v).map(Number).filter((x) => Number.isFinite(x) && x > 0);
const objectiveList = (v) => list(v).filter(Boolean).map((o) => [Number(at(o, 1)), at(o, 2) ?? null]).filter((o) => o[0] > 0);

for (const [id, row] of quests) {
  const name = at(row, QK.name);
  if (!name) continue;
  const started = at(row, QK.startedBy) || {};
  const finished = at(row, QK.finishedBy) || {};
  const objectives = at(row, QK.objectives) || {};
  const zoneOrSort = Number(at(row, QK.zoneOrSort) ?? 0);
  const q = {
    id, n: name, l: Number(at(row, QK.questLevel) ?? 0), r: Number(at(row, QK.requiredLevel) ?? 0),
    ra: Number(at(row, QK.requiredRaces) ?? 0), cl: Number(at(row, QK.requiredClasses) ?? 0),
    z: zoneOrSort,
  };
  const s = numList(at(started, 1)); if (s.length) q.s = s;
  const so = numList(at(started, 2)); if (so.length) q.so = so;
  const si = numList(at(started, 3)); if (si.length) q.si = si;
  const e = numList(at(finished, 1)); if (e.length) q.e = e;
  const eo = numList(at(finished, 2)); if (eo.length) q.eo = eo;
  const text = list(at(row, QK.objectivesText)).filter((t) => typeof t === 'string').join(' ').trim();
  if (text) q.o = text;
  const ob = {};
  const c = objectiveList(at(objectives, 1)); if (c.length) ob.c = c;
  const oo = objectiveList(at(objectives, 2)); if (oo.length) ob.o = oo;
  const oi = objectiveList(at(objectives, 3)); if (oi.length) ob.i = oi;
  const rep = at(objectives, 4); if (rep && at(rep, 1)) ob.rep = [Number(at(rep, 1)), Number(at(rep, 2) ?? 0)];
  const k = list(at(objectives, 5)).filter(Boolean).map((kc) => [numList(at(kc, 1)), Number(at(kc, 2) ?? 0), at(kc, 3) ?? null]).filter((kc) => kc[0].length);
  if (k.length) ob.k = k;
  if (Object.keys(ob).length) q.ob = ob;
  const pre = numList(at(row, QK.preQuestSingle)); if (pre.length) q.pre = pre;
  const preAll = numList(at(row, QK.preQuestGroup)); if (preAll.length) q.preAll = preAll;
  const next = Number(at(row, QK.nextQuestInChain) ?? 0); if (next) q.next = next;
  const ex = numList(at(row, QK.exclusiveTo)); if (ex.length) q.ex = ex;
  const ch = numList(at(row, QK.childQuests)); if (ch.length) q.ch = ch;
  const grp = numList(at(row, QK.inGroupWith)); if (grp.length) q.grp = grp;
  const par = Number(at(row, QK.parentQuest) ?? 0); if (par) q.par = par;
  const bc = Number(at(row, QK.breadcrumbForQuestId) ?? 0); if (bc) q.bc = bc;
  const bcs = numList(at(row, QK.breadcrumbs)); if (bcs.length) q.bcs = bcs;
  const sk = at(row, QK.requiredSkill); if (sk && at(sk, 1)) q.sk = [Number(at(sk, 1)), Number(at(sk, 2) ?? 0)];
  const minRep = at(row, QK.requiredMinRep); if (minRep && at(minRep, 1)) q.minRep = [Number(at(minRep, 1)), Number(at(minRep, 2) ?? 0)];
  const maxRep = at(row, QK.requiredMaxRep); if (maxRep && at(maxRep, 1)) q.maxRep = [Number(at(maxRep, 1)), Number(at(maxRep, 2) ?? 0)];
  const maxL = Number(at(row, QK.requiredMaxLevel) ?? 0); if (maxL) q.maxL = maxL;
  const spell = Number(at(row, QK.requiredSpell) ?? 0); if (spell) q.spell = spell;
  const spec = Number(at(row, QK.requiredSpecialization) ?? 0); if (spec) q.spec = spec;
  const until = Number(at(row, QK.availableUntilCompleted) ?? 0); if (until) q.until = until;
  const flags = Number(at(row, QK.specialFlags) ?? 0); if (flags & 1) q.rep = 1;
  const src = Number(at(row, QK.sourceItemId) ?? 0); if (src) q.src = src;
  const rr = list(at(row, QK.reputationReward)).filter(Boolean).map((r) => [Number(at(r, 1)), Number(at(r, 2) ?? 0)]).filter((r) => r[0]);
  if (rr.length) q.rr = rr;
  if (hidden.has(id)) q.hidden = 1;
  // The zone, for quests filed under a class or profession: where they start.
  let zone = zoneOf(zoneOrSort);
  if (!zone) {
    const starter = npcs.get(s[0]) || (so[0] && objects.get(so[0]));
    const starterZone = starter ? Number(at(starter, s[0] ? NK.zoneID : OK.zoneID) ?? 0) : 0;
    zone = zoneOf(starterZone) || zoneOf(Number(Object.keys(at(starter, s[0] ? NK.spawns : OK.spawns) || {})[0] ?? 0));
    if (!zone && e[0] && npcs.get(e[0])) zone = zoneOf(Number(at(npcs.get(e[0]), NK.zoneID) ?? 0));
  }
  if (zone) {
    q.zone = zone;
    if (!zones[zone]) unknownZones.set(zone, (unknownZones.get(zone) || 0) + 1);
  }
  if (zoneOrSort < 0) q.sort = zoneOrSort;
  for (const x of [...s, ...e, ...c.map((o) => o[0]), ...k.flatMap((kc) => kc[0])]) usedNpcs.add(x);
  for (const x of [...so, ...eo, ...oo.map((o) => o[0])]) usedObjects.add(x);
  for (const x of [...si, ...oi.map((o) => o[0])]) usedItems.add(x);
  if (src) usedItems.add(src);
  questOut[id] = q;
}

const npcOut = {};
const spawnsOut = {};
// Spawn points per zone (sub-areas folded into their zone), capped.
const capSpawns = (spawns, cap) => {
  const out = {};
  for (const [area, points] of Object.entries(spawns || {})) {
    const zone = zoneOf(Number(area)) ?? Number(area);
    const pts = list(points).filter((p) => p && at(p, 1) != null && at(p, 1) >= 0 && at(p, 2) >= 0).map((p) => [Math.round(Number(at(p, 1)) * 10) / 10, Math.round(Number(at(p, 2)) * 10) / 10]);
    if (pts.length) out[zone] = [...(out[zone] || []), ...pts].slice(0, cap);
  }
  return Object.keys(out).length ? out : null;
};
for (const [id, row] of npcs) {
  const name = at(row, NK.name);
  if (!name || /Only GM can see/.test(name)) continue;
  const o = { n: name };
  const sub = at(row, NK.subName); if (sub) o.sub = sub;
  const min = Number(at(row, NK.minLevel) ?? 0); const max = Number(at(row, NK.maxLevel) ?? 0);
  if (min || max) o.lvl = min === max ? [min] : [min, max];
  const rank = Number(at(row, NK.rank) ?? 0); if (rank) o.rank = rank;
  const zone = Number(at(row, NK.zoneID) ?? 0); if (zone) o.z = zoneOf(zone) ?? zone;
  const f = at(row, NK.friendlyToFaction); if (f) o.f = f;
  const qs = numList(at(row, NK.questStarts)).filter((x) => questOut[x]); if (qs.length) o.qs = qs;
  const qe = numList(at(row, NK.questEnds)).filter((x) => questOut[x]); if (qe.length) o.qe = qe;
  const flags = Number(at(row, NK.npcFlags) ?? 0); if (flags) o.fl = flags;
  npcOut[id] = o;
  const questNpc = qs.length || qe.length;
  const spawns = capSpawns(at(row, NK.spawns), questNpc ? 40 : rank ? 40 : usedNpcs.has(id) ? 24 : 12);
  if (spawns) spawnsOut[`n${id}`] = spawns;
}
const objectOut = {};
for (const [id, row] of objects) {
  const name = at(row, OK.name);
  const qs = numList(at(row, OK.questStarts)).filter((x) => questOut[x]);
  const qe = numList(at(row, OK.questEnds)).filter((x) => questOut[x]);
  if (!name || (!qs.length && !qe.length && !usedObjects.has(id))) continue;
  const o = { n: name };
  const zone = Number(at(row, OK.zoneID) ?? 0); if (zone) o.z = zoneOf(zone) ?? zone;
  if (qs.length) o.qs = qs;
  if (qe.length) o.qe = qe;
  objectOut[id] = o;
  const spawns = capSpawns(at(row, OK.spawns), qs.length || qe.length ? 40 : 24);
  if (spawns) spawnsOut[`o${id}`] = spawns;
}
const itemOut = {};
for (const id of usedItems) if (itemNames.has(id)) itemOut[id] = itemNames.get(id);

if (unknownZones.size) console.warn('  quests in areas without a name:', [...unknownZones].map(([z, c]) => `${z} (${c})`).join(', '));

// --- Write -----------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });
const source = 'Questie (https://github.com/Questie/Questie), GPL-3.0. Reshaped for Chronicler by tools/import-questie.js; not affiliated with Questie.';
const generated = new Date().toISOString().slice(0, 10);
const write = (name, data) => {
  const json = JSON.stringify({ source, generated, ...data });
  fs.writeFileSync(path.join(outDir, name), json);
  console.log(`  web/data/classic/${name}: ${(json.length / 1024).toFixed(0)} KB`);
};
console.log('Writing…');
write('quests.json', { quests: questOut });
write('npcs.json', { npcs: npcOut });
write('objects.json', { objects: objectOut });
write('items.json', { items: itemOut });
// Every item in the game, for the completion journal: [name, class, subclass, item level, required level].
const itemDb = {};
for (const [id, row] of itemRows) {
  const name = at(row, IK.name);
  if (!name) continue;
  itemDb[id] = [name, Number(at(row, IK.class) ?? -1), Number(at(row, IK.subClass) ?? -1), Number(at(row, IK.itemLevel) ?? 0), Number(at(row, IK.requiredLevel) ?? 0)];
}
write('itemdb.json', { items: itemDb });
write('zones.json', { zones });
write('spawns.json', { spawns: spawnsOut });
console.log(`Done: ${Object.keys(questOut).length} quests (${Object.values(questOut).filter((q) => q.hidden).length} hidden), ${Object.keys(npcOut).length} NPCs, ${Object.keys(objectOut).length} objects, ${Object.keys(itemOut).length} item names, ${Object.keys(zones).length} zones and categories.`);
