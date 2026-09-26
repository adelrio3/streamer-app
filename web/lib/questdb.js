// The Classic quest database (web/data/classic/*.json, imported from Questie
// by tools/import-questie.js): every quest in the game, who gives it, where,
// and what it needs. Combined with what you have logged, it tells you what
// a zone still holds for a character.

export const RACE_BITS = { Human: 1, Orc: 2, Dwarf: 4, NightElf: 8, Scourge: 16, Undead: 16, Tauren: 32, Gnome: 64, Troll: 128 };
export const CLASS_BITS = { WARRIOR: 1, PALADIN: 2, HUNTER: 4, ROGUE: 8, PRIEST: 16, SHAMAN: 64, MAGE: 128, WARLOCK: 256, DRUID: 1024 };
export const ALLIANCE = 77;
export const HORDE = 178;
export const RANK_NAMES = { 0: '', 1: 'elite', 2: 'rare elite', 3: 'boss', 4: 'rare' };
export const STATES = {
  done: 'Done', active: 'In progress', ready: 'Ready to pick up', later: 'Later', other: 'Other faction or class',
  excluded: 'No longer offered', hidden: 'Not in the game',
};
export const STATE_ORDER = ['active', 'ready', 'later', 'done', 'excluded', 'other', 'hidden'];
export const FACTIONS = {
  72: 'Stormwind', 47: 'Ironforge', 69: 'Darnassus', 54: 'Gnomeregan Exiles', 76: 'Orgrimmar', 68: 'Undercity', 81: 'Thunder Bluff', 530: 'Darkspear Trolls',
  469: 'Alliance', 67: 'Horde', 59: 'Thorium Brotherhood', 576: 'Timbermaw Hold', 609: 'Cenarion Circle', 529: 'Argent Dawn', 270: 'Zandalar Tribe',
  749: 'Hydraxian Waterlords', 910: 'Brood of Nozdormu', 589: 'Wintersaber Trainers', 92: 'Gelkis Clan Centaur', 93: 'Magram Clan Centaur', 349: 'Ravenholdt',
  70: 'Syndicate', 87: 'Bloodsail Buccaneers', 21: 'Booty Bay', 369: 'Gadgetzan', 470: 'Ratchet', 577: 'Everlook', 509: 'The League of Arathor', 510: 'The Defilers',
  730: 'Stormpike Guard', 729: 'Frostwolf Clan', 889: 'Warsong Outriders', 890: 'Silverwing Sentinels', 809: "Shen'dralar", 909: 'Darkmoon Faire',
};
const RACE_NAMES = { 1: 'Human', 2: 'Orc', 4: 'Dwarf', 8: 'Night Elf', 16: 'Undead', 32: 'Tauren', 64: 'Gnome', 128: 'Troll' };
const CLASS_NAMES = { 1: 'Warrior', 2: 'Paladin', 4: 'Hunter', 8: 'Rogue', 16: 'Priest', 64: 'Shaman', 128: 'Mage', 256: 'Warlock', 1024: 'Druid' };

// "Alliance", "Horde", or the races a quest is limited to.
export function raceNames(mask) {
  if (!mask) return '';
  if ((mask & 255) === ALLIANCE) return 'Alliance';
  if ((mask & 255) === HORDE) return 'Horde';
  return Object.entries(RACE_NAMES).filter(([bit]) => mask & bit).map(([, n]) => n).join(', ');
}

export function classNames(mask) {
  if (!mask) return '';
  return Object.entries(CLASS_NAMES).filter(([bit]) => mask & bit).map(([, n]) => n).join(', ');
}

const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// data: { quests, npcs, objects, items, zones } as the JSON files hold them.
export function indexDB(data) {
  const quests = new Map();
  for (const [id, q] of Object.entries(data.quests)) quests.set(Number(id), { ...q, id: Number(id) });
  const zones = {};
  for (const [id, z] of Object.entries(data.zones)) zones[Number(id)] = z;
  const zoneByName = new Map();
  for (const [id, z] of Object.entries(zones)) if (!z.kind && !z.p && !zoneByName.has(norm(z.n))) zoneByName.set(norm(z.n), Number(id));
  const questsByZone = new Map();
  const questsBySort = new Map();
  const unlocks = new Map();
  const previous = new Map();
  for (const q of quests.values()) {
    if (q.zone) push(questsByZone, q.zone, q);
    if (q.sort) push(questsBySort, q.sort, q);
    for (const id of [...(q.pre || []), ...(q.preAll || [])]) push(unlocks, id, q);
    if (q.next) push(previous, q.next, q);
  }
  const npcs = data.npcs;
  const objects = data.objects;
  const items = data.items;
  let countable = 0;
  for (const q of quests.values()) if (!q.hidden && !q.rep) countable++;
  return {
    quests, npcs, objects, items, zones, questsByZone, questsBySort, unlocks, previous, countable,
    zoneId: (name) => zoneByName.get(norm(name)) ?? null,
    zoneName: (id) => zones[id]?.n ?? (id ? `Area ${id}` : ''),
    npc: (id) => (npcs[id] ? { id: Number(id), ...npcs[id] } : null),
    object: (id) => (objects[id] ? { id: Number(id), ...objects[id] } : null),
    item: (id) => items[id] ?? null,
  };
}

// Whether a character can take a quest at all (faction, race, class).
// who: { raceToken, classToken, faction } or null for "anyone".
export function fits(q, who) {
  if (!who) return true;
  const race = RACE_BITS[who.raceToken] ?? (who.faction === 'Horde' ? HORDE : who.faction === 'Alliance' ? ALLIANCE : 0);
  const cls = CLASS_BITS[who.classToken] ?? 0;
  if (q.ra && race && !(q.ra & race)) return false;
  if (q.cl && cls && !(q.cl & cls)) return false;
  return true;
}

// One quest's state for a character: done, active, ready, later, other,
// excluded or hidden. ctx: { who, level, done: Set, active: Set }.
export function questState(q, { who = null, level = 0, done = new Set(), active = new Set() } = {}) {
  if (q.hidden) return 'hidden';
  if (done.has(q.id)) return 'done';
  if (active.has(q.id)) return 'active';
  if (!fits(q, who)) return 'other';
  const gone = (id) => done.has(id) || active.has(id);
  if ((q.ex || []).some(gone)) return 'excluded';
  if (q.until && done.has(q.until)) return 'excluded';
  if (q.next && gone(q.next)) return 'excluded';
  if (q.bc && gone(q.bc)) return 'excluded';
  if (q.maxL && level && level > q.maxL) return 'excluded';
  const prereqs = (!q.pre || q.pre.some((id) => done.has(id))) && (!q.preAll || q.preAll.every((id) => done.has(id))) && (!q.par || gone(q.par));
  const levelOk = !level || (q.r || 0) <= level;
  return prereqs && levelOk ? 'ready' : 'later';
}

// Why a quest is "later": the level it needs and the quests before it.
export function waitingOn(db, q, { level = 0, done = new Set() } = {}) {
  const out = [];
  if (level && (q.r || 0) > level) out.push(`level ${q.r}`);
  const missing = (ids, all) => ids.filter((id) => !done.has(id)).map((id) => db.quests.get(id)?.n ?? `quest ${id}`);
  if (q.pre && !q.pre.some((id) => done.has(id))) out.push(`${q.pre.length > 1 ? 'one of: ' : ''}${missing(q.pre).join(', ')}`);
  if (q.preAll) { const m = missing(q.preAll, true); if (m.length) out.push(m.join(', ')); }
  if (q.par && !done.has(q.par)) out.push(`${db.quests.get(q.par)?.n ?? `quest ${q.par}`} (active)`);
  if (q.sk) out.push(`${SKILLS[q.sk[0]] ?? `skill ${q.sk[0]}`} ${q.sk[1]}`);
  return out;
}

export const SKILLS = { 164: 'Blacksmithing', 165: 'Leatherworking', 171: 'Alchemy', 197: 'Tailoring', 202: 'Engineering', 333: 'Enchanting', 182: 'Herbalism', 186: 'Mining', 393: 'Skinning', 129: 'First Aid', 185: 'Cooking', 356: 'Fishing', 762: 'Riding' };

// Who gives a quest: NPCs, objects or items, with the NPC's zone.
export function givers(db, q) {
  const out = [];
  for (const id of q.s || []) { const n = db.npc(id); out.push({ kind: 'npc', id, name: n?.n ?? `NPC ${id}`, sub: n?.sub ?? null, zone: n?.z ?? null }); }
  for (const id of q.so || []) { const o = db.object(id); out.push({ kind: 'object', id, name: o?.n ?? `Object ${id}`, zone: o?.z ?? null }); }
  for (const id of q.si || []) out.push({ kind: 'item', id, name: db.item(id) ?? `Item ${id}`, zone: null });
  return out;
}

export function enders(db, q) {
  const out = [];
  for (const id of q.e || []) { const n = db.npc(id); out.push({ kind: 'npc', id, name: n?.n ?? `NPC ${id}`, sub: n?.sub ?? null, zone: n?.z ?? null }); }
  for (const id of q.eo || []) { const o = db.object(id); out.push({ kind: 'object', id, name: o?.n ?? `Object ${id}`, zone: o?.z ?? null }); }
  return out;
}

// A quest's objectives as words: kills, items, objects, reputation.
export function objectives(db, q) {
  const out = [];
  for (const [id, text] of q.ob?.c || []) out.push({ kind: 'kill', id, name: db.npc(id)?.n ?? `NPC ${id}`, text: text ?? null });
  for (const [ids, base, text] of q.ob?.k || []) out.push({ kind: 'kill', id: base || ids[0], ids, name: text ?? db.npc(base || ids[0])?.n ?? `NPC ${ids[0]}`, text: text ?? null });
  for (const [id, text] of q.ob?.i || []) out.push({ kind: 'item', id, name: db.item(id) ?? `Item ${id}`, text: text ?? null });
  for (const [id, text] of q.ob?.o || []) out.push({ kind: 'object', id, name: db.object(id)?.n ?? `Object ${id}`, text: text ?? null });
  if (q.ob?.rep) out.push({ kind: 'reputation', id: q.ob.rep[0], name: `Reputation ${q.ob.rep[1]}`, text: null });
  return out;
}

// Every quest of a zone with its state for a character.
// ctx: { who, level, done, active }; done/active are sets of quest ids.
export function zoneCoverage(db, zoneName, ctx = {}) {
  const zoneId = typeof zoneName === 'number' ? zoneName : db.zoneId(zoneName);
  if (!zoneId) return null;
  const rows = (db.questsByZone.get(zoneId) || []).filter((q) => !q.hidden).map((q) => ({ q, state: questState(q, ctx), givers: givers(db, q) }));
  return summarize(zoneId, rows);
}

// Quests filed under a class, profession or category (sort < 0).
export function sortCoverage(db, sortId, ctx = {}) {
  const rows = (db.questsBySort.get(sortId) || []).filter((q) => !q.hidden).map((q) => ({ q, state: questState(q, ctx), givers: givers(db, q) }));
  return summarize(sortId, rows);
}

// All zones with quests, with done/total for the character.
export function allZones(db, ctx = {}) {
  const out = [];
  for (const [zoneId, list] of db.questsByZone) {
    const rows = list.filter((q) => !q.hidden).map((q) => ({ q, state: questState(q, ctx) }));
    const s = summarize(zoneId, rows);
    if (s.total || s.counts.other) out.push({ zoneId, name: db.zoneName(zoneId), mapId: db.zones[zoneId]?.m ?? null, ...s });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function summarize(zoneId, rows) {
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  const countable = rows.filter((r) => !r.q.rep && r.state !== 'other' && r.state !== 'excluded');
  const done = countable.filter((r) => r.state === 'done').length;
  rows.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (a.q.l || 0) - (b.q.l || 0) || a.q.n.localeCompare(b.q.n));
  return { zoneId, rows, counts, total: countable.length, done, repeatable: rows.filter((r) => r.q.rep).length };
}

// Quest givers you have not talked to yet, as map pins (percent
// coordinates on the zone's map). spawns: the spawns.json table.
// seen: Set of NPC ids you have already met.
export function unfoundGivers(db, spawns, coverage, { seen = new Set(), states = ['ready', 'later', 'active'] } = {}) {
  if (!coverage) return [];
  const byGiver = new Map();
  for (const r of coverage.rows) {
    if (!states.includes(r.state)) continue;
    for (const g of r.givers) {
      if (g.kind === 'item') continue;
      if (g.kind === 'npc' && seen.has(g.id)) continue;
      const key = `${g.kind[0]}${g.id}`;
      const points = spawns?.[key]?.[coverage.zoneId];
      if (!points?.length) continue;
      if (!byGiver.has(key)) byGiver.set(key, { key, kind: g.kind, id: g.id, name: g.name, sub: g.sub ?? null, points, quests: [] });
      byGiver.get(key).quests.push({ id: r.q.id, name: r.q.n, state: r.state, level: r.q.l });
    }
  }
  const out = [];
  for (const g of byGiver.values()) {
    const ready = g.quests.filter((x) => x.state === 'ready').length;
    for (const [x, y] of g.points.slice(0, 6)) {
      out.push({
        x, y, layer: 'unfound', key: g.key, npcId: g.kind === 'npc' ? g.id : null, objectId: g.kind === 'object' ? g.id : null,
        label: `${g.name}${g.sub ? ` <${g.sub}>` : ''}: ${g.quests.map((x) => x.name).slice(0, 4).join(', ')}${g.quests.length > 4 ? ` +${g.quests.length - 4}` : ''}`,
        sub2: `${g.quests.length} quest${g.quests.length === 1 ? '' : 's'}${ready ? `, ${ready} ready` : ''}`,
        href: g.kind === 'npc' ? `#/npc/n${g.id}` : `#/quest/q${g.quests[0].id}`,
        quests: g.quests,
      });
    }
  }
  return out;
}

// Rare and rare-elite creatures of a zone, with their spawn points.
export function zoneRares(db, spawns, zoneId, { killed = new Set() } = {}) {
  const out = [];
  for (const [id, n] of Object.entries(db.npcs)) {
    if (n.rank !== 2 && n.rank !== 4) continue;
    const points = spawns?.[`n${id}`]?.[zoneId];
    if (n.z !== zoneId && !points) continue;
    out.push({ id: Number(id), name: n.n, level: n.lvl ?? null, rank: RANK_NAMES[n.rank], points: points || [], killed: killed.has(Number(id)) });
  }
  return out.sort((a, b) => (a.level?.[0] ?? 0) - (b.level?.[0] ?? 0) || a.name.localeCompare(b.name));
}

export function rarePins(rares) {
  return rares.flatMap((r) => r.points.slice(0, 8).map(([x, y]) => ({
    x, y, layer: 'rares', key: `r${r.id}`, npcId: r.id, label: `${r.name} (${r.rank}${r.level ? `, level ${r.level.join('–')}` : ''})${r.killed ? ' — killed' : ''}`, href: `#/npc/n${r.id}`,
  })));
}

// Quest ids a character (or everyone, when who is null) has finished or has
// active, from the codex. Abandoned counts as neither.
export function progressSets(codexQuests, who = null) {
  const done = new Set();
  const active = new Set();
  for (const q of codexQuests) {
    if (!q.qid) continue;
    if (who && !(q.characters || []).includes(who)) continue;
    if (q.status === 'done') done.add(q.qid);
    else if (q.status === 'active') active.add(q.qid);
  }
  return { done, active };
}

// Entries for the search box: every quest in the game and everyone who
// gives one, so you can look up a quest you have not found yet.
export function searchEntries(db) {
  const out = [];
  for (const q of db.quests.values()) {
    if (q.hidden) continue;
    out.push({ type: 'Database quest', title: q.n, href: `#/quest/q${q.id}`, sub: [db.zoneName(q.zone), q.l ? `level ${q.l}` : ''].filter(Boolean).join(' · '), text: `${q.n} ${db.zoneName(q.zone)} ${q.o ?? ''}`.toLowerCase() });
  }
  for (const [id, n] of Object.entries(db.npcs)) {
    if (!n.qs && !n.qe && n.rank !== 2 && n.rank !== 4 && n.rank !== 3) continue;
    out.push({ type: 'Database NPC', title: n.n, href: `#/npc/n${id}`, sub: [n.sub, db.zoneName(n.z), RANK_NAMES[n.rank]].filter(Boolean).join(' · '), text: `${n.n} ${n.sub ?? ''} ${db.zoneName(n.z)}`.toLowerCase() });
  }
  return out;
}

// Item classes and subclasses as the game names them (ItemClass.db2).
export const ITEM_CLASSES = {
  0: ['Consumable', { 0: 'Consumable', 1: 'Potion', 2: 'Elixir', 3: 'Flask', 4: 'Scroll', 5: 'Food & Drink', 6: 'Item Enhancement', 7: 'Bandage', 8: 'Other' }],
  1: ['Container', { 0: 'Bag', 1: 'Soul Bag', 2: 'Herb Bag', 3: 'Enchanting Bag', 4: 'Engineering Bag' }],
  2: ['Weapon', { 0: 'One-Handed Axes', 1: 'Two-Handed Axes', 2: 'Bows', 3: 'Guns', 4: 'One-Handed Maces', 5: 'Two-Handed Maces', 6: 'Polearms', 7: 'One-Handed Swords', 8: 'Two-Handed Swords', 10: 'Staves', 13: 'Fist Weapons', 14: 'Miscellaneous', 15: 'Daggers', 16: 'Thrown', 17: 'Spears', 18: 'Crossbows', 19: 'Wands', 20: 'Fishing Poles' }],
  3: ['Gem', {}],
  4: ['Armor', { 0: 'Miscellaneous', 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shields', 7: 'Librams', 8: 'Idols', 9: 'Totems' }],
  5: ['Reagent', {}],
  6: ['Projectile', { 2: 'Arrow', 3: 'Bullet' }],
  7: ['Trade Goods', { 0: 'Trade Goods', 1: 'Parts', 2: 'Explosives', 3: 'Devices', 5: 'Cloth', 6: 'Leather', 7: 'Metal & Stone', 8: 'Meat', 9: 'Herb', 10: 'Elemental', 11: 'Other', 12: 'Enchanting' }],
  9: ['Recipe', { 0: 'Book', 1: 'Leatherworking', 2: 'Tailoring', 3: 'Engineering', 4: 'Blacksmithing', 5: 'Cooking', 6: 'Alchemy', 7: 'First Aid', 8: 'Enchanting', 9: 'Fishing' }],
  10: ['Money', {}],
  11: ['Quiver', { 2: 'Quiver', 3: 'Ammo Pouch' }],
  12: ['Quest', {}],
  13: ['Key', { 0: 'Key', 1: 'Lockpick' }],
  15: ['Miscellaneous', { 0: 'Junk', 1: 'Reagent', 2: 'Pet', 3: 'Holiday', 4: 'Other', 5: 'Mount' }],
};
export const ITEM_CLASS_ORDER = ['Weapon', 'Armor', 'Consumable', 'Trade Goods', 'Recipe', 'Quest', 'Container', 'Reagent', 'Projectile', 'Quiver', 'Key', 'Gem', 'Miscellaneous', 'Money', 'Unknown'];
export function itemClassName(cls, sub) {
  const c = ITEM_CLASSES[cls];
  if (!c) return { type: 'Unknown', sub: null };
  return { type: c[0], sub: c[1][sub] ?? null };
}
