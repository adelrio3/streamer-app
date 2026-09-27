// The roster: every character the account plays or plans to (name, sex,
// race, class, professions), and what the quest database says such a set
// of characters can never reach. A quest is out of reach when no character
// fits its race, class and profession requirement at once; a group of
// mutually exclusive quests (a profession specialization, a "choose one"
// reward chain) can only be covered as far as distinct characters can take
// different branches.

import { fits, SKILLS } from './questdb.js';

export const RACE_TOKENS = { human: 'Human', dwarf: 'Dwarf', 'night elf': 'NightElf', nightelf: 'NightElf', gnome: 'Gnome', orc: 'Orc', undead: 'Scourge', scourge: 'Scourge', forsaken: 'Scourge', tauren: 'Tauren', troll: 'Troll' };
export const RACE_NAMES = { Human: 'Human', Dwarf: 'Dwarf', NightElf: 'Night Elf', Gnome: 'Gnome', Orc: 'Orc', Scourge: 'Undead', Tauren: 'Tauren', Troll: 'Troll' };
export const CLASS_TOKENS = { warrior: 'WARRIOR', paladin: 'PALADIN', hunter: 'HUNTER', rogue: 'ROGUE', priest: 'PRIEST', shaman: 'SHAMAN', mage: 'MAGE', warlock: 'WARLOCK', druid: 'DRUID' };
export const PROFESSIONS = ['Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering', 'Herbalism', 'Leatherworking', 'Mining', 'Skinning', 'Tailoring'];
const SECONDARY = new Set([129, 185, 356, 762]); // First Aid, Cooking, Fishing, Riding: anyone can learn these
const ALLIANCE_RACES = new Set(['Human', 'Dwarf', 'NightElf', 'Gnome']);

export const className = (token) => (token ? token[0] + token.slice(1).toLowerCase() : '');
export const factionOf = (race) => (ALLIANCE_RACES.has(race) ? 'Alliance' : race ? 'Horde' : null);

// One line per character: "Daire  Female  Human  Mage  Herbalism  Enchanting"
// (any order after the name; tabs, commas or spaces between; "Night Elf"
// may be two words).
export function parseRoster(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const words = line.split(/[\t,]+|\s+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) continue;
    const c = { name: words[0], sex: null, race: null, cls: null, professions: [] };
    for (let i = 1; i < words.length; i++) {
      const w = words[i].toLowerCase();
      const two = i + 1 < words.length ? `${w} ${words[i + 1].toLowerCase()}` : '';
      if (w === 'male' || w === 'female') c.sex = w;
      else if (RACE_TOKENS[two]) { c.race = RACE_TOKENS[two]; i++; }
      else if (RACE_TOKENS[w]) c.race = RACE_TOKENS[w];
      else if (CLASS_TOKENS[w]) c.cls = CLASS_TOKENS[w];
      else { const p = PROFESSIONS.find((x) => x.toLowerCase() === w); if (p && !c.professions.includes(p)) c.professions.push(p); }
    }
    out.push(c);
  }
  return out;
}

export function rosterText(roster) {
  return (roster || []).map((c) => [c.name, c.sex ? c.sex[0].toUpperCase() + c.sex.slice(1) : '', RACE_NAMES[c.race] ?? '', className(c.cls), ...(c.professions || [])].filter(Boolean).join('  ')).join('\n');
}

// Characters known from play sessions become roster entries (their
// professions from the skills the addon saw); planned ones from the text
// fill in the rest, by name.
export function mergeRoster(known = [], planned = []) {
  const byName = new Map();
  for (const c of planned) byName.set(c.name.toLowerCase(), { ...c, planned: true });
  for (const k of known) {
    const key = String(k.name).toLowerCase();
    const p = byName.get(key) || { name: k.name, sex: null, race: null, cls: null, professions: [] };
    const profs = new Set(p.professions || []);
    for (const s of k.info?.skills || k.skills || []) if (PROFESSIONS.includes(s.name)) profs.add(s.name);
    byName.set(key, { ...p, name: k.name, sex: k.info?.sex ?? p.sex, race: k.info?.raceToken ?? p.race, cls: k.info?.classToken ?? p.cls, professions: [...profs], planned: false, key: k.key });
  }
  return [...byName.values()];
}

const who = (c) => ({ raceToken: c.race, classToken: c.cls, faction: factionOf(c.race) });
function professionOk(q, c) {
  if (!q.sk || SECONDARY.has(q.sk[0])) return true;
  const name = SKILLS[q.sk[0]];
  return Boolean(name) && (c.professions || []).includes(name);
}
export function eligible(q, roster) {
  return roster.filter((c) => c.race && c.cls && fits(q, who(c)) && professionOk(q, c));
}

// Kuhn's matching: how many quests of a group distinct characters can take.
function matching(quests, roster) {
  const cand = quests.map((q) => eligible(q, roster).map((c) => roster.indexOf(c)));
  const owner = new Array(roster.length).fill(-1);
  const tryQuest = (i, seen) => {
    for (const c of cand[i]) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (owner[c] < 0 || tryQuest(owner[c], seen)) { owner[c] = i; return true; }
    }
    return false;
  };
  let n = 0;
  for (let i = 0; i < quests.length; i++) if (tryQuest(i, new Set())) n++;
  return n;
}

// What the roster reaches. Returns { total, reachable, unreachable: [{ q, reason, need }],
// byReason: Map(reason -> [entries]), choices: [{ quests, coverable, characters }] }.
export function rosterCoverage(db, roster) {
  const chars = (roster || []).filter((c) => c.race && c.cls);
  const quests = [...db.quests.values()].filter((q) => !q.hidden);
  const unreachable = [];
  const byReason = new Map();
  const reachable = [];
  for (const q of quests) {
    if (eligible(q, chars).length) { reachable.push(q); continue; }
    const raceOk = chars.some((c) => fits({ ra: q.ra }, who(c)));
    const classOk = chars.some((c) => fits({ cl: q.cl }, who(c)));
    const profOk = chars.some((c) => professionOk(q, c));
    const missing = [];
    if (!raceOk) missing.push('race');
    if (!classOk) missing.push('class');
    if (!profOk) missing.push('profession');
    const reason = missing.length ? missing.join(' & ') : 'combination';
    const need = [];
    if (!raceOk || reason === 'combination') need.push(requirementRaces(q));
    if (!classOk || reason === 'combination') need.push(requirementClasses(q));
    if (!profOk || (reason === 'combination' && q.sk)) need.push(q.sk ? `${SKILLS[q.sk[0]] ?? 'a profession'} ${q.sk[1] || ''}`.trim() : '');
    const entry = { q, reason, need: need.filter(Boolean).join(' · ') };
    unreachable.push(entry);
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(entry);
  }
  // Groups of mutually exclusive quests among the reachable ones.
  const ids = new Set(reachable.map((q) => q.id));
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const q of reachable) { parent.set(q.id, q.id); }
  for (const q of reachable) for (const x of q.ex || []) if (ids.has(x)) union(q.id, x);
  const groups = new Map();
  for (const q of reachable) { const r = find(q.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(q); }
  const choices = [];
  for (const g of groups.values()) {
    if (g.length < 2 || new Set(g.map((q) => q.n)).size < 2) continue; // one quest in several race variants is not a choice
    const coverable = matching(g, chars);
    if (coverable >= g.length) continue;
    const names = new Set();
    for (const q of g) for (const c of eligible(q, chars)) names.add(c.name);
    choices.push({ quests: g.sort((a, b) => (a.l || 0) - (b.l || 0) || String(a.n).localeCompare(String(b.n))), coverable, characters: [...names] });
  }
  choices.sort((a, b) => b.quests.length - a.quests.length);
  return { total: quests.length, reachable: reachable.length, unreachable, byReason, choices, characters: chars.length };
}

import { raceNames, classNames } from './questdb.js';
const HORDE = 2 | 16 | 32 | 128;
const ALLIANCE = 1 | 4 | 8 | 64;
function requirementRaces(q) {
  if (!q.ra) return '';
  if ((q.ra & ALLIANCE) === ALLIANCE && !(q.ra & HORDE)) return 'Alliance';
  if ((q.ra & HORDE) === HORDE && !(q.ra & ALLIANCE)) return 'Horde';
  return [].concat(raceNames(q.ra)).join(', ');
}
function requirementClasses(q) {
  return q.cl ? [].concat(classNames(q.cl)).join(', ') : '';
}
