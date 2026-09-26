// Tales: a storyline retold as one story for the Lore page. Not a journal
// and not a list of errands: the whole chain is read first (its places, the
// people who keep asking, the enemy that keeps coming back, the thing that
// ends it), then told in acts with a setup, rising action, a turn and what
// was left behind. Third person, past tense, the voice of a young-adult
// fantasy narrator: confident, concrete, a little dry. The protagonist is
// never named: an adventurer whose pronouns follow the account (he by
// default, she when asked), never they. Every fact comes from the database
// and what was logged; the atmosphere is the storyteller's. Nothing about
// the game leaks in: only people, places and what happened.
//
// Chapters that only differ by class (the letters and tablets a village
// sends its newcomers to different teachers) are rolled into one event:
// nobody lives all of them, and the story is the same one.

import { givers, enders, objectives, CLASS_BITS } from './questdb.js';
import { storylines } from './story.js';

// ---------------------------------------------------------------------------
// Which tales there are

// db: indexDB. codex: buildCodex (quests keyed q<id>). world: buildWorld or
// null. characters: buildCharacters. ctx: the storylines context.
// One tale per storyline and one per lone quest, only those with at least
// one chapter done; complete ones first, then the most recently finished.
export function tales({ db, codex, world = null, characters = [], ctx = {} }) {
  const cq = codexQuests(codex);
  const heroBook = heroLookup(codex, characters);
  const out = [];
  const inChain = new Set();
  for (const s of storylines(db, ctx)) {
    for (const r of s.quests) inChain.add(r.q.id);
    const chapters = rollUp(s.quests.map((r) => chapterOf(r.q, r.state, cq)));
    const tale = makeTale({ id: `s${s.id}`, kind: 'storyline', title: s.name, zones: s.zones, level: s.minLevel, chapters, heroBook, ctx });
    if (tale) out.push(tale);
  }
  for (const q of db.quests.values()) {
    if (q.hidden || inChain.has(q.id)) continue;
    const c = cq.get(`q${q.id}`);
    if (c?.status !== 'done') continue;
    const chapters = [chapterOf(q, 'ready', cq)];
    const zone = q.zone ?? q.z;
    const tale = makeTale({ id: `q${q.id}`, kind: 'quest', title: cleanTitle(q.n), zones: zone ? [db.zoneName(zone)] : [], level: q.l || null, chapters, heroBook, ctx });
    if (tale) out.push(tale);
  }
  return out.sort((a, b) => Number(b.complete) - Number(a.complete) || (b.finishedAt ?? 0) - (a.finishedAt ?? 0) || String(a.title).localeCompare(String(b.title)));
}

function chapterOf(q, state, cq) {
  const c = cq.get(`q${q.id}`);
  const s = c?.status === 'done' ? 'done' : c?.status === 'active' ? 'active' : state;
  return { q, state: s };
}

const ANY_CLASS = Object.values(CLASS_BITS).reduce((a, b) => a | b, 0);
const RANK = { done: 3, active: 2, ready: 1 };

// Class-only variants of one event, told once. A run of chapters that are
// each for some classes only, handed out by the same person after the same
// prerequisites, becomes one chapter: the one that was done (or the first)
// stands for it, with the others kept as `variants`.
export function rollUp(chapters) {
  const sig = (ch) => (ch.q.cl && ch.q.cl !== ANY_CLASS ? `${JSON.stringify(ch.q.s ?? null)}|${JSON.stringify(ch.q.pre ?? null)}|${JSON.stringify(ch.q.preAll ?? null)}` : null);
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const best = run.slice().sort((a, b) => (RANK[b.state] || 0) - (RANK[a.state] || 0))[0];
      out.push({ q: best.q, state: best.state, variants: run.map((ch) => ({ q: ch.q, state: ch.state })) });
    } else out.push(...run);
    run = [];
  };
  for (const ch of chapters) {
    const k = sig(ch);
    if (k && run.length && sig(run[0]) === k) { run.push(ch); continue; }
    flush();
    if (k) run.push(ch); else out.push(ch);
  }
  flush();
  return out;
}

function makeTale({ id, kind, title, zones, level, chapters, heroBook, ctx }) {
  const cq = heroBook.cq;
  const done = chapters.filter((ch) => ch.state === 'done').length;
  if (!done) return null;
  // Chapters that nobody could take (the other faction) do not count against the tale.
  const counted = chapters.filter((ch) => Object.keys(ctx).length ? ch.state !== 'other' && ch.state !== 'hidden' : ch.state !== 'hidden');
  const total = counted.length || chapters.length;
  const complete = counted.every((ch) => ch.state === 'done');
  const heroes = [];
  let startedAt = null;
  let finishedAt = null;
  for (const ch of chapters.flatMap((x) => x.variants || [x])) {
    const c = cq.get(`q${ch.q.id}`);
    if (!c) continue;
    for (const m of [...(c.accepted || []), ...(c.offered || [])]) if (m?.t != null && (startedAt == null || m.t < startedAt)) startedAt = m.t;
    for (const m of c.turnedIn || []) {
      if (m?.t == null) continue;
      if (startedAt == null || m.t < startedAt) startedAt = m.t;
      if (finishedAt == null || m.t > finishedAt) finishedAt = m.t;
    }
    if (c.status === 'done') for (const key of c.characters || []) {
      const h = heroBook.get(key);
      if (h && !heroes.some((x) => x.name === h.name)) heroes.push(h);
    }
  }
  return { id, kind, title, zones, level, chapters, done, total, complete, heroes, startedAt, finishedAt };
}

function codexQuests(codex) {
  const src = codex?.quests;
  if (src instanceof Map) return src;
  const m = new Map();
  for (const q of src || []) m.set(q.key ?? `q${q.qid}`, q);
  return m;
}

// Character key -> { name, race, class, sex, level } for the shelf's "who
// lived it" line. The tales themselves never name anyone.
function heroLookup(codex, characters) {
  const m = new Map();
  for (const c of codex?.characters || []) if (c.key) m.set(c.key, { name: c.name, race: c.race ?? null, class: c.class ?? null, sex: null, level: c.level || null });
  for (const c of characters || []) if (c.key) m.set(c.key, { name: c.name, race: c.info?.race ?? null, class: c.info?.class ?? null, sex: c.info?.sex ?? null, level: c.level || null });
  const cq = codexQuests(codex);
  return { get: (k) => m.get(k) ?? null, cq };
}

// ---------------------------------------------------------------------------
// Telling one

// tale: from tales(). pretend: tell every chapter as if it were done, from
// the database alone where nothing was logged. defaultSex: the adventurer's
// pronouns ('male' unless set otherwise); the tale never says "they". hero
// is accepted for callers that still pass one and ignored: no tale is about
// a named character.
export function tellTale(tale, { db, codex, world = null, hero = null, pretend = false, defaultSex = 'male' } = {}) {
  void hero;
  const cq = codexQuests(codex);
  const chapters = tale.chapters.some((ch) => ch.variants) ? tale.chapters : rollUp(tale.chapters);
  const told = pretend ? chapters : chapters.filter((ch) => ch.state === 'done');
  const finished = pretend || told.length === chapters.length;
  const voice = voiceOf(defaultSex, chapters);
  const beats = told.map((ch, i) => beatOf(db, ch, cq.get(`q${ch.q.id}`), world, voice, i));
  const arc = planArc(beats, { title: tale.title, zones: tale.zones || [], level: tale.level, finished, lone: chapters.length === 1 });
  const parts = arc.acts.map((act) => ({ heading: act.heading, paragraphs: writeAct(act, arc, voice).filter(Boolean).map(tidy) }));
  const ending = tidy(finished ? resolutionLine(arc, voice) : openLine(arc, voice));
  return { title: tale.title, dedication: subtitle(arc), parts, ending };
}

export function taleText(story) {
  const lines = [`# ${story.title}`, ''];
  if (story.dedication) lines.push(`*${story.dedication}*`, '');
  for (const p of story.parts) {
    if (story.parts.length > 1) lines.push(`## ${p.heading}`, '');
    for (const para of p.paragraphs) lines.push(para, '');
  }
  if (story.ending) lines.push(story.ending, '');
  return lines.join('\n');
}

// A short subtitle that names the place and the kind of story, never a person.
function subtitle(arc) {
  const zones = arc.zones.filter(Boolean);
  const d = arc.drive;
  const what = d.kind === 'foe' || d.kind === 'hunt' ? `the ${d.plural}` : d.kind === 'named' ? d.name : d.kind === 'explore' ? placeRef(d.place) : '';
  if (!zones.length) return what ? `A tale of ${what}` : 'A tale';
  const where = zones.length === 1 ? `A tale of ${zones[0]}` : `A tale from ${zones[0]} to ${zones.at(-1)}`;
  return what ? `${where} and ${what}` : where;
}

// ---------------------------------------------------------------------------
// The facts of one chapter, gathered before any words are chosen

function beatOf(db, ch, c, world, voice, index) {
  const q = ch.q;
  const f = chapterFacts(db, q, c, world, voice);
  f.index = index;
  if (ch.variants) {
    f.rolled = rolledFacts(ch);
    f.kind = 'rolled';
    // Every variant is a chapter someone lived, so each one's places count.
    for (const v of ch.variants) f.landmarks.push(...landmarksIn(v.q.o));
    return f;
  }
  const kills = f.tasks.filter((t) => t.kind === 'kill');
  const named = namedFoe(f);
  if (named) { f.kind = 'named'; f.named = named; }
  else if (kills.length) f.kind = 'kill';
  else if (f.tasks.length) f.kind = 'gather';
  else if (f.explore) f.kind = 'explore';
  else if (f.errand) f.kind = 'errand';
  else f.kind = 'other';
  if (f.kind === 'gather' && f.tasks.every((t) => t.kind === 'object')) {
    f.objectOnly = true;
    const m = String(f.objective || '').match(/^(?:Bring|Take|Deliver|Carry|Return|Place)\s+(.+?)\s+(?:to|at|in|on)\s+/);
    if (m && short(m[1])) f.parcel = m[1].trim();
  }
  if (f.kind === 'named') f.epithet = String(f.objective || '').match(new RegExp(`${f.named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s+(the [^,.]{3,30}),`))?.[1] || null;
  return f;
}

function chapterFacts(db, q, c, world, voice) {
  const dbGivers = givers(db, q);
  const giver = c?.giver?.name || dbGivers.find((g) => g.kind === 'npc')?.name || dbGivers[0]?.name || null;
  const giverKind = c?.giver?.name ? (c.giver.kind === 'GameObject' ? 'object' : 'npc') : dbGivers[0]?.kind ?? null;
  const dbEnders = enders(db, q);
  const ender = c?.turnInNpc?.name || dbEnders.find((g) => g.kind === 'npc')?.name || dbEnders[0]?.name || null;
  const zoneId = q.zone ?? q.z;
  const zone = zoneId ? db.zoneName(zoneId) : (c?.zone || null);
  const objective = c?.objectives || q.o || '';
  const tasks = [];
  for (const o of objectives(db, q)) {
    if (o.kind === 'reputation') continue;
    const count = countIn(objective, o.name);
    const t = { kind: o.kind, id: o.id, name: o.name, count: count?.n ?? null, plural: count?.plural ?? null, hunted: null };
    if (world && o.kind === 'kill') {
      const ids = o.ids || [o.id];
      let n = 0;
      for (const id of ids) n += world.byNpc?.get(`n${id}`)?.kills || 0;
      t.hunted = n || null;
    }
    if (world && o.kind === 'item') t.hunted = world.byItem?.get(o.id)?.looted || null;
    if (world && o.kind === 'object') t.hunted = world.objects?.find((x) => x.key === `o${o.id}`)?.loots || null;
    tasks.push(t);
  }
  // "Listen to the Fallen Hero tell his story": a person to find, not a kill.
  if (tasks.length && tasks.every((t) => t.kind === 'kill' && t.count == null) && /^(?:Listen|Speak|Talk|Wait|Escort|Meet|Accompany|Help|Aid|Assist|Protect|Defend|Find|Heal|Cure|Bring)\b/.test(String(objective))) tasks.length = 0;
  const explore = !tasks.length ? matchPlace(objective, /^(?:Explore|Scout|Investigate|Find)\s+(?:the\s+)?([^,.]+?)(?:,|\.|\s+then\b|\s+and\b|$)/i) : null;
  const carry = !tasks.length && !explore ? String(objective).match(/^(?:Bring|Take|Deliver|Carry|Return)\s+(.+?)\s+to\s+([^,.]+?)(?:,|\.|\s+in\b|\s+at\b|\s+outside\b|\s+inside\b|$)/) : null;
  const errand = !tasks.length && !explore ? (carry && short(carry[2]) ? carry[2].trim() : matchPlace(objective, /(?:[Ss]peak|[Tt]alk|[Rr]eport)\s+(?:with|to|back to)\s+([^,.]+?)(?:,|\.|\s+in\b|\s+at\b|\s+outside\b|\s+inside\b|\s+next\b|\s+near\b|$)/)) : null;
  const parcel = carry && short(carry[1]) ? carry[1].trim() : null;
  const hint = matchPlace(objective, /(?:could|can|may) be found ([^.]+)/i);
  const people = [giver, ender, errand, ...dbGivers.map((g) => g.name), ...dbEnders.map((g) => g.name)].filter(Boolean);
  const landmarks = landmarksIn(objective).filter((l) => !people.some((n) => n === l || n.includes(l)) && !TITLE_WORD.test(l.split(' ')[0]));
  const foeSex = /\bhis\b/.test(objective) ? 'his' : /\bher\b/.test(objective) ? 'her' : null;
  return {
    id: q.id, title: cleanTitle(q.n), giver, giverKind, ender, zone, tasks, explore, errand, parcel, hint, landmarks, objective, foeSex,
    said: quoteFrom(c?.text, voice), thanks: quoteFrom(c?.reward, voice), progress: quoteFrom(c?.progress, voice),
  };
}

// A named enemy: a kill with no count whose name reads like a person's, or
// "Kill Garrick Padfoot and bring his head" in the objective.
function namedFoe(f) {
  const t = f.tasks.find((x) => x.kind === 'kill' && x.count == null && looksLikeName(x.name));
  if (t) return t.name;
  const m = String(f.objective || '').match(/^(?:Kill|Slay|Defeat|Destroy|Hunt down|Bring down)\s+([A-Z][\w']+(?:\s+(?:the\s+)?[A-Z][\w']+){0,3})(?:\s+and\b|,|\.)/);
  return m && looksLikeName(m[1]) ? m[1] : null;
}

function looksLikeName(s) {
  const words = String(s || '').split(/\s+/);
  if (!words.length || words.length > 4) return false;
  if (words.some((w) => /^\d/.test(w))) return false;
  const last = words.at(-1);
  return !/s$/i.test(last) || /'s$/.test(last) || words.length >= 2 && /^[A-Z]/.test(words[0]) && !/^(the|of)$/i.test(words[1]);
}

// A place or a person from the objective text, when it is short enough to
// read like a name and not a whole errand.
function matchPlace(text, re) {
  const m = String(text || '').match(re);
  return m && short(m[1]) ? m[1].trim() : null;
}

function short(s) {
  return String(s || '').trim().split(/\s+/).length <= 6;
}

// Named places in an objective: "in Goldshire", "at Northshire Abbey",
// "in the Valley of Trials".
function landmarksIn(text) {
  const out = [];
  const re = /\b(?:in|at|near|outside|inside|behind)\s+((?:the\s+)?[A-Z][\w']+(?:\s+(?:of|the)\s+[A-Z][\w']+|\s+[A-Z][\w']+){0,2})(?=[,.]|\s+(?:in|at|near|and|then|to)\b|$)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const name = m[1].trim();
    if (/^(?:the\s+)?(?:Read|Speak|Kill|Bring|Take|Return|Explore|Go|Get|Deliver)\b/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// "10 Cactus Apples" in the objective text: the count and the plural as written.
function countIn(text, name) {
  if (!text || !name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`(\\d+)\\s+((?:pieces?|bags?|crates?|bundles?|vials?|jars?|samples?|sets?|handfuls?|stacks?|bottles?|flasks?|pinches|pinch|bunches|bunch|lumps?) of\\s+)?(${esc}(?:e?s)?)\\b`, 'i'));
  if (!m) return null;
  return { n: Number(m[1]), plural: `${m[2] || ''}${m[3]}` };
}

// A short line they said, as read: the first sentence of at most fourteen
// words that says something (no greetings), with the game's name tokens
// filled in. Null when nothing fits.
function quoteFrom(text, voice) {
  if (!text) return null;
  const t = fillNames(String(text).replace(/\$[Bb]/g, ' ').replace(/\s+/g, ' ').trim(), voice);
  for (const raw of t.split(/(?<=[.!?])\s+/)) {
    let s = raw.trim().replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/[.?]$/, '').trim();
    s = s.replace(/^(?:hello|greetings|well met|ah|oh|hm|hmm|so)[, ]+/i, '');
    if (!s) continue;
    const n = s.split(/\s+/).length;
    if (n < 3 || n > 14) continue;
    if (/^(?:have you|are you|did you|do you)\b/i.test(s)) continue;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return null;
}

// $N is the name (dropped: nobody is named), $C the class, $R the race,
// $G male;female; picks by the adventurer's pronouns.
function fillNames(t, voice) {
  return t
    .replace(/,?\s*\$[Nn]\b/g, '')
    .replace(/\$[Cc]/g, voice.craft || 'friend')
    .replace(/\$[Rr]/g, 'stranger')
    .replace(/\$[Gg]\s*([^;]*);([^;]*);?/g, (_, m, f) => (voice.female ? f : m).trim())
    .replace(/<([^/<>]+)\/([^<>]+)>/g, (_, m, f) => (voice.female ? f : m).trim())
    .replace(/\s+([,.])/g, '$1');
}

// What the rolled-up variants have in common: the thing handed over (the
// last word of every title, "Letter" or "Tablet") and how many roads it led to.
function rolledFacts(ch) {
  const kinds = [...new Set(ch.variants.map((v) => cleanTitle(v.q.n).split(' ').at(-1).toLowerCase()))];
  const known = kinds.every((w) => /^(letter|tablet|parchment|note|scroll|rune|sigil|summons|message|missive)$/.test(w));
  const thing = known && kinds.length <= 2 ? kinds.join(' or ') : 'message';
  const head = kinds.length === 1 && known ? `The ${cap(thing)}s` : 'The Summons';
  return { thing, count: ch.variants.length, heading: head };
}

// ---------------------------------------------------------------------------
// The arc: what the whole chain is about, before a word is written

const CREATURE_WORDS = /^(kobold|gnoll|murloc|boar|scorpid|wolf|spider|bear|troll|orc|harpy|quilboar|raptor|crocolisk|zombie|skeleton|ghoul|bandit|thief|thug|cutpurse|wildkin|plainstrider|prowler|cougar|naga|satyr|furbolg|centaur|ogre|worg|bat|crab|rat|imp|cultist|worker|laborer|vermin|miner|pillager|trapper|scout|raider|thistle|timber|grizzly|mottled|young|giant|elder|dire|rabid|forest|moonstalker|nightsaber|webwood|grell|sprite|tallstrider|lion|stag|hyena|zhevra|swoop|coyote|tarantula|vulture|jackal|lynx|owl|bloodtalon|deviate|razormane|bristleback|brute|shaman|mystic|witch|geomancer|tunneler|digger|ambusher|bruiser|shadow|watcher|wanderer|guard|defender|whelp|drake|dragon|hatchling|serpent|snake|lurker|hunter|warrior|mage|priest|rogue|warlock|paladin|druid|adept|acolyte|initiate|invader|marauder|smuggler|pirate|buccaneer|bandit|highwayman|outlaw|deserter|renegade|rebel|conspirator|spy|assassin|footpad|zealot|fanatic|fiend|worm|slime|ooze|elemental|spirit|ghost|wraith|shade|specter|banshee|lich|mongrel|hound|mastiff|pup|cub|matriarch|patriarch|alpha|chief|chieftain|overseer|foreman|taskmaster|warlord|captain|lieutenant|sergeant)$/i;

// The enemy the chain keeps coming back to: a word shared by two or more
// kills, else the last kill's own name.
function foeFamily(beats) {
  const names = [];
  for (const b of beats) for (const t of b.tasks) if (t.kind === 'kill' && !names.includes(t.name)) names.push(t.name);
  for (const b of beats) if (b.named && !names.includes(b.named)) names.push(b.named);
  if (!names.length) return null;
  // The words two names share at the start ("Kobold Vermin", "Kobold Worker")
  // or at the end ("Young Night Web Spider", "Night Web Spider").
  const norm = (w) => w.replace(/s$/i, '');
  let best = null;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i].split(/\s+/); const b = names[j].split(/\s+/);
    let pre = 0; while (pre < a.length && pre < b.length && norm(a[pre]) === norm(b[pre])) pre++;
    let suf = 0; while (suf < a.length - pre && suf < b.length - pre && norm(a[a.length - 1 - suf]) === norm(b[b.length - 1 - suf])) suf++;
    const preWords = a.slice(0, pre).filter((w) => !ADJ_WORD.test(w));
    const cand = suf >= pre && suf ? { word: a.slice(a.length - suf).join(' '), at: 'end' } : preWords.length ? { word: preWords.join(' '), at: 'start' } : null;
    if (cand && (!best || cand.word.length > best.word.length)) best = cand;
  }
  if (best) {
    const has = (n) => (best.at === 'start' ? n.startsWith(best.word) : norm(n).endsWith(norm(best.word)));
    const members = names.filter(has);
    if (members.length >= 2) return { word: best.word, plural: pluralFoe(best.word), members, at: best.at };
  }
  const single = names.find((n) => !looksLikeName(n) || /s$/.test(n)) || null;
  if (!single) return null;
  return { word: single, plural: pluralFoe(single), members: [single], at: 'start' };
}
const ADJ_WORD = /^(Young|Elder|Giant|Dire|Rabid|Greater|Lesser|Large|Small|Old|Mad|Wild|Feral|Enraged|Elite|Veteran|Ancient)$/i;

// "Kobold" -> "kobolds", "Defias" -> "Defias", "Mottled Boar" -> "mottled boars".
function pluralFoe(name) {
  const words = name.split(/\s+/);
  const common = words.every((w) => CREATURE_WORDS.test(w) || ADJ_WORD.test(w) || !/^[A-Z]/.test(w));
  const s = common ? name.toLowerCase() : name;
  if (/(vermin|folk|deer|fish|sheep|moose|elk|kin|spawn|men|children|people|scum|brood|s)$/i.test(s)) return s;
  if (/[xz]$|[cs]h$/i.test(s)) return `${s}es`;
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  if (/f$/i.test(s)) return `${s.slice(0, -1)}ves`;
  return `${s}s`;
}

// The kind of kobold this one is: "Kobold Workers" in the kobold campaign are "the workers".
function subKind(name, family) {
  if (!family) return pluralFoe(name);
  const fam = family.word.split(/\s+/).map((w) => w.replace(/s$/i, '').toLowerCase());
  const rest = name.split(/\s+/).filter((w) => !fam.includes(w.replace(/s$/i, '').toLowerCase())).join(' ');
  if (!rest) return family.plural;
  if (ADJ_WORD.test(rest)) return `${rest.toLowerCase()} ones`;
  return pluralFoe(rest);
}

function themeOf(b, family) {
  if (b.kind === 'rolled') return 'rolled';
  if (b.kind === 'errand' || b.kind === 'other') return null;
  if (b.kind === 'named') return family && family.members.includes(b.named) ? `foe:${family.word}` : `named:${b.giver || b.named}`;
  if (b.kind === 'kill') return family && b.tasks.some((t) => t.kind === 'kill' && family.members.includes(t.name)) ? `foe:${family.word}` : `hunt:${b.giver || b.id}`;
  return `${b.kind}:${b.giver || b.id}`;
}

function planArc(beats, meta) {
  const family = foeFamily(beats);
  const groups = [];
  const byKey = new Map();
  const byGiver = new Map();
  const leads = []; // errands waiting for the next group
  const rolledPending = [];
  let lastGroup = null;
  const groupFor = (b) => {
    const key = themeOf(b, family);
    // A named enemy asked for by someone who already had a thread joins it as its climax.
    if (b.kind === 'named' && !key.startsWith('foe:') && b.giver && byGiver.has(b.giver)) return byGiver.get(b.giver);
    if (!byKey.has(key)) {
      const g = { key, kind: key.split(':')[0], beats: [], leads: [], events: [], coda: [], first: b.index };
      byKey.set(key, g);
      groups.push(g);
      if (b.giver && !byGiver.has(b.giver) && g.kind !== 'foe') byGiver.set(b.giver, g);
    }
    return byKey.get(key);
  };
  for (const b of beats) {
    if (b.kind === 'rolled') {
      // The letters go with the thread of whoever handed them out, else with what follows.
      if (lastGroup && lastGroup.beats.at(-1)?.giver === b.giver) lastGroup.events.push(b); else rolledPending.push(b);
      continue;
    }
    if (b.kind === 'errand' || b.kind === 'other') {
      // An errand introduces the next thread when it sends the adventurer to
      // whoever asks next; one from the current thread's own people to a
      // third party closes that thread instead. The chain's last errand
      // always ends the tale.
      const next = beats.slice(b.index + 1).find((x) => x.kind !== 'errand' && x.kind !== 'other' && x.kind !== 'rolled');
      const introduces = next && b.errand && (next.giver === b.errand || b.errand.includes(next.giver || '\0'));
      const own = lastGroup && b.index < beats.length - 1 && [lastGroup.beats.at(-1)?.giver, lastGroup.beats.at(-1)?.ender].includes(b.giver);
      if (own && !introduces) lastGroup.coda.push(b); else leads.push(b);
      continue;
    }
    const g = groupFor(b);
    g.beats.push(b);
    g.leads.push(...leads.splice(0));
    g.events.push(...rolledPending.splice(0));
    lastGroup = g;
  }
  if (!groups.length) groups.push({ key: 'errands', kind: 'errand', beats: [], leads: leads.splice(0), events: rolledPending.splice(0), coda: [], first: 0 });
  // The chain's own finale ends the tale. When it sits inside an earlier
  // thread it is split off (a campaign against one enemy stays whole); when
  // the spine of the story is the first thread, a named enemy is the climax.
  const finale = [...beats].reverse().find((b) => b.kind !== 'errand' && b.kind !== 'other' && b.kind !== 'rolled');
  const fg = finale ? groups.find((g) => g.beats.includes(finale)) : null;
  if (fg && groups.length > 1 && fg !== groups.at(-1) && fg.kind !== 'foe') {
    if (fg.beats.length > 1) {
      fg.beats.splice(fg.beats.indexOf(finale), 1);
      groups.push({ key: `${fg.key}:end`, kind: fg.kind, beats: [finale], leads: [], events: [], coda: [], first: finale.index });
    } else { groups.splice(groups.indexOf(fg), 1); groups.push(fg); }
  } else if (groups.length >= 3) {
    const climax = groups.slice(1).filter((g) => g.beats.some((b) => b.kind === 'named')).sort((a, b) => b.beats.length - a.beats.length)[0];
    if (climax && groups.at(-1) !== climax) { groups.splice(groups.indexOf(climax), 1); groups.push(climax); }
  }
  groups.at(-1).coda.push(...leads.splice(0));
  groups.at(-1).events.push(...rolledPending.splice(0));
  // Cast and setting.
  const people = new Set();
  for (const b of beats) for (const n of [b.giver, b.ender, b.errand]) if (n) people.add(n);
  const giverCount = new Map();
  for (const b of beats) if (b.giver) giverCount.set(b.giver, (giverCount.get(b.giver) || 0) + 1);
  const patron = [...giverCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const landmarkCount = new Map();
  for (const b of beats) for (const l of b.landmarks) if (!people.has(l) && ![...people].some((p) => p.includes(l))) landmarkCount.set(l, (landmarkCount.get(l) || 0) + 1);
  const zones = meta.zones.length ? meta.zones : [...new Set(beats.map((b) => b.zone).filter(Boolean))];
  const home = [...landmarkCount.entries()].filter(([l]) => !zones.includes(l)).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || null;
  const first = groups[0];
  const b0 = first.beats[0] || null;
  const drive = family && groups.some((g) => g.kind === 'foe') ? { kind: 'foe', plural: family.plural, word: family.word }
    : b0?.kind === 'named' ? { kind: 'named', name: b0.named }
      : first.kind === 'hunt' ? { kind: 'hunt', plural: pluralFoe(b0.tasks.find((t) => t.kind === 'kill').name) }
        : first.kind === 'explore' ? { kind: 'explore', place: b0.explore }
          : b0?.tasks[0] ? { kind: 'want', thing: b0.tasks[0] } : { kind: 'errand' };
  // Acts: the setup with the first thread, the middle, the finale with the last.
  const middle = groups.slice(1, -1);
  const maxActs = Math.max(2, Math.min(5, Math.ceil(beats.length / 2)));
  while (middle.length > 3 || middle.length + 2 > maxActs) {
    if (middle.length < 2) break;
    let at = 0;
    for (let i = 0; i + 1 < middle.length; i++) if (middle[i].beats.length + middle[i + 1].beats.length < middle[at].beats.length + middle[at + 1].beats.length) at = i;
    const unit = (g) => (g.merged ? g.merged : [g]);
    middle.splice(at, 2, { key: `${middle[at].key}+${middle[at + 1].key}`, kind: 'mixed', merged: [...unit(middle[at]), ...unit(middle[at + 1])], beats: [...middle[at].beats, ...middle[at + 1].beats] });
  }
  const unit = (g) => (g.merged ? g.merged : [g]);
  const lastGroups = groups.length > 1 ? unit(groups.at(-1)) : [];
  if (middle.length === 1 && middle.length + 2 > maxActs) lastGroups.unshift(...unit(middle.pop()));
  const acts = [{ heading: '', groups: unit(first), setup: true, finale: groups.length === 1 }];
  for (const g of middle) acts.push({ heading: '', groups: unit(g) });
  if (groups.length > 1) acts.push({ heading: '', groups: lastGroups, finale: true });
  const seed = beats[0]?.id || 1;
  PROPER_NOW = new Set();
  for (const b of beats) for (const n of [b.giver, b.ender, b.errand, b.named, ...b.landmarks]) if (n) for (const w of n.split(/\s+/)) PROPER_NOW.add(w);
  for (const z of zones) for (const w of String(z).split(/\s+/)) PROPER_NOW.add(w);
  const arc = { beats, groups, acts, family, patron, home, zones, drive, finished: meta.finished, lone: meta.lone, title: meta.title, level: meta.level, seed, used: new Set(), many: beats.length >= 3 };
  for (const act of acts) act.heading = headingFor(act, arc);
  return arc;
}

function headingFor(act, arc) {
  const name = (g) => {
    const b = g.beats[0];
    const named = g.beats.find((x) => x.kind === 'named');
    if (!b) return g.events[0] ? g.events[0].rolled.heading : g.leads[0]?.errand ? `The Road to ${g.leads[0].errand}` : 'The Beginning';
    if (g.kind === 'foe') return `The ${cap(arc.family.plural)}`;
    if (named) return named.named;
    if (g.kind === 'explore') return cap(placeRef(b.explore));
    if (g.kind === 'hunt') return `The ${cap(pluralFoe(b.tasks.find((t) => t.kind === 'kill').name))}`;
    const t = b.tasks[0];
    if (t) return (t.plural || t.name).replace(CONTAINER, '').replace(/^\w/, (c) => c.toUpperCase());
    return b.title;
  };
  if (act.setup && arc.acts.length > 1) return arc.home ? cap(placeRef(arc.home)) : arc.zones[0] || 'The Beginning';
  const names = act.groups.map(name);
  return names.length > 1 ? `${names[0]} and ${names[1]}` : names[0];
}

// ---------------------------------------------------------------------------
// The words

const FOOD = /\b(apple|apples|meat|egg|eggs|fruit|berry|berries|mushroom|wine|cheese|bread|pie|stew|ale|honey|fish|milk|grape|grapes|melon|cake|nut|nuts|spice|spices|kimchi|ribs|chops|beer|mead|brew)\b/i;
const CONTAINER = /^(?:pieces?|bags?|crates?|bundles?|vials?|jars?|samples?|sets?|handfuls?|stacks?|bottles?|flasks?|pinches|pinch|bunches|bunch|lumps?)\s+of\s+/i;
const PART = /^(.+?)\s+(Tails?|Meat|Hides?|Pelts?|Fangs?|Claws?|Tusks?|Eyes?|Hearts?|Blood|Feathers?|Wings?|Venom|Stingers?|Ears?|Teeth|Tooth|Scales?|Shells?|Legs?|Paws?|Skins?|Horns?|Antlers?|Beaks?|Talons?|Livers?|Brains?|Spines?|Mandibles?|Carapaces?|Ichor)$/i;
const ADJ = /^(Tough|Fresh|Raw|Crisp|Small|Large|Big|Ruined|Torn|Tender|Chunk of|Stringy|Lean|Fatty|Bloody|Intact|Perfect|Pristine|Clean|Whole|Cracked|Broken)\s+/i;

// Zones as a storyteller names them: a flourish for the places the stories
// most often begin, and the plain name everywhere else.
const ZONE_FLOURISH = {
  'Durotar': 'the red dust of Durotar', 'Elwynn Forest': 'the green woods of Elwynn', 'Dun Morogh': 'the snows of Dun Morogh', 'Teldrassil': 'the boughs of Teldrassil',
  'Mulgore': 'the wide grass of Mulgore', 'Tirisfal Glades': 'the grey glades of Tirisfal', 'Westfall': 'the golden fields of Westfall', 'The Barrens': 'the dry plains of the Barrens',
  'Loch Modan': 'the lake country of Loch Modan', 'Darkshore': 'the black sands of Darkshore', 'Silverpine Forest': 'the silver pines of Silverpine', 'Redridge Mountains': 'the red hills of Redridge',
  'Duskwood': 'the gloom of Duskwood', 'Stonetalon Mountains': 'the high stone of Stonetalon', 'Ashenvale': 'the old forest of Ashenvale', 'Stranglethorn Vale': 'the steaming jungle of Stranglethorn',
};

// The adventurer: pronouns from the account, an epithet from the chain (the
// craft only when the whole story is for one craft alone).
function voiceOf(defaultSex, chapters) {
  const female = defaultSex === 'female';
  const bits = chapters.map((ch) => ch.q.cl || 0);
  const locked = bits.length && bits.every((b) => b && b !== ANY_CLASS);
  const common = locked ? bits.reduce((a, b) => a & b, ANY_CLASS) : 0;
  const craft = common ? Object.entries(CLASS_BITS).find(([, bit]) => bit === common)?.[0].toLowerCase() || null : null;
  const young = chapters.every((ch) => !ch.q.l || ch.q.l <= 10);
  const seed = chapters[0]?.q.id || 1;
  const epithet = craft ? craft : young ? ['newcomer', 'stranger', 'newcomer'][seed % 3] : ['stranger', 'adventurer', 'traveller'][seed % 3];
  return {
    female, craft, young, epithet,
    he: female ? 'she' : 'he', him: female ? 'her' : 'him', his: female ? 'her' : 'his', hers: female ? 'hers' : 'his', self: female ? 'herself' : 'himself',
    He: female ? 'She' : 'He', His: female ? 'Her' : 'His',
  };
}

function heroRef(voice, first = false) {
  if (first) return `${article(voice.epithet)} ${voice.craft ? 'young ' : ''}${voice.epithet}`;
  return `the ${voice.epithet}`;
}

const vary = (seed) => (n) => Math.abs(seed) % n;

// A line of texture the tale has not used yet: interiority for the long
// middle, one per paragraph at most.
const TEXTURE = [
  (voice) => 'It was the kind of work nobody writes down, which is why it is written here.',
  (voice) => `${voice.He} was learning the place by its chores, which is the only way a place ever gets learned.`,
  (voice) => `Nobody thanked ${voice.him} for the walking, and the walking was most of it.`,
  (voice) => 'Small errands are how a stranger becomes someone a place can name.',
  (voice) => `${voice.He} did not ask why. Asking why is a habit for people who plan to stay.`,
  (voice) => 'There is a rhythm to that kind of work, and by the third day it had ' + voice.him + '.',
];
function texture(arc, voice, v) {
  for (let i = 0; i < TEXTURE.length; i++) {
    const k = (v(TEXTURE.length) + i) % TEXTURE.length;
    if (arc.used.has(k)) continue;
    arc.used.add(k);
    return TEXTURE[k](voice);
  }
  return '';
}

function writeAct(act, arc, voice) {
  const out = [];
  if (act.setup) out.push(setupParagraph(arc, voice));
  let prevGroup = null;
  for (const g of act.groups) {
    out.push(...tellGroup(g, arc, voice, { prevGroup, opening: act.setup && g === act.groups[0] }));
    prevGroup = g;
  }
  if (act.finale && arc.finished) out.push(resolutionParagraph(arc, voice));
  return out.map(smooth);
}

// "sent him on to Gornek. Gornek laid it out" -> "sent him on to Gornek, who laid it out".
function smooth(p) {
  return String(p).replace(/ to ([A-Z][\w'-]+(?: [A-Z][\w'-]+)?)\. \1 (?=(?:laid|did|wanted|needed|asked|had|was|kept|put|sent|took)\b)/g, ' to $1, who ');
}

// 1. The setup: the place, the people and the thing that drives the whole
// story. One paragraph before anything is asked.
function setupParagraph(arc, voice) {
  const v = vary(arc.seed);
  const zone = arc.zones[0] || null;
  const place = zone ? (ZONE_FLOURISH[zone] || zone) : null;
  const home = arc.home ? placeRef(arc.home) : null;
  const patron = arc.patron;
  const s = [];
  // Where.
  if (home && place) s.push([`${cap(home)} sat in ${place}, a place that did not expect much of anyone.`, `In ${place}, at ${home}, the days had a shape to them.`, `${cap(home)} lay in ${place}, small enough that news travelled faster than people.`][v(3)]);
  else if (place) s.push([`${cap(place)} did not look like a place with a story in it.`, `The story begins in ${place}.`, `In ${place}, trouble tended to arrive on foot.`][v(3)]);
  else s.push('It began in a small place with a long memory.');
  // What was wrong.
  const d = arc.drive;
  if (d.kind === 'foe') s.push([`Then the ${d.plural} came, and the shape broke.`, `The ${d.plural} had other plans.`, `That was before the ${d.plural}.`][(v(3) + 1) % 3]);
  else if (d.kind === 'named') s.push(`It also had ${d.name}, which was one thing too many.`);
  else if (d.kind === 'hunt') s.push([`What it had was ${d.plural}, more of them than anyone wanted, and a habit of testing newcomers on them.`, `It had ${d.plural} in numbers nobody liked, and it had a use for anyone willing to thin them.`][v(2)]);
  else if (d.kind === 'explore') s.push(`Nobody had been into ${placeRef(d.place)} in a while, and nobody was eager to be first.`);
  else if (d.kind === 'want' && d.thing.count == null) s.push(`What it wanted was ${thingName(d.thing, null)}, and somebody to go and get it.`);
  else if (d.kind === 'want') s.push(FOOD.test(d.thing.name) ? `What it had was appetite, and not enough ${thingName(d.thing, null, true)} to feed it.` : `What it lacked was ${thingName(d.thing, null, true)}, and hands to fetch them.`);
  else s.push('What it lacked was someone willing to walk.');
  // Who kept asking.
  if (patron && arc.many) {
    const ref = titleRef(patron);
    s.push(ref ? `${patron} kept ${['order', 'watch', 'the peace'][v(3)]} there, or tried to, and kept a list.` : `${patron} was the one who noticed, and the one who kept a list.`);
  } else if (patron) s.push(`${patron} was the one doing the wanting.`);
  // Enter the adventurer.
  const who = heroRef(voice, true);
  s.push([`Into this walked ${who}, with nothing to ${voice.his} name and a long road behind ${voice.him}.`, `${cap(who)} arrived with the dust still on ${voice.him}, looking for work and finding it.`, `${cap(who)} came up the road that week, which was either luck or the opposite.`][v(3)]);
  return s.join(' ');
}

// One themed thread of beats as one or two paragraphs.
function tellGroup(g, arc, voice, { prevGroup, opening }) {
  if (g.kind === 'errand') return [errandOnly(g, arc, voice)];
  const out = [];
  const b0 = g.beats[0];
  const v = vary(b0.id);
  const lead = leadClause(g, arc, voice);
  const plain = g.beats.filter((b) => b.kind !== 'named' || g.kind === 'foe');
  const named = g.kind === 'foe' ? [] : g.beats.filter((b) => b.kind === 'named');
  const sub = { ...g, beats: plain.length ? plain : g.beats };
  const main = g.kind === 'foe' || g.kind === 'hunt' ? foeParagraphs(sub, arc, voice, v)
    : g.kind === 'explore' ? [exploreParagraph(sub, arc, voice, v)]
      : plain.length ? gatherParagraphs(sub, arc, voice, v) : [];
  for (const b of named) main.push(namedParagraph(b, arc, voice, vary(b.id)));
  if (lead) main[0] = `${lead} ${main[0]}`;
  else if (!opening && prevGroup) main[0] = `${bridge(g, prevGroup, arc, voice, v)} ${main[0]}`;
  out.push(...main);
  for (const e of g.events) out.push(rolledParagraph(e, arc, voice));
  const coda = codaClause(g, arc, voice, g === arc.groups.at(-1));
  if (coda) out[out.length - 1] = `${out[out.length - 1]} ${coda}`;
  return out;
}

// "Deputy Willem sent him on to Milly Osworth." The errands that led here, in one clause.
function leadClause(g, arc, voice) {
  const leads = g.leads.filter((b) => b.errand || b.parcel);
  if (!leads.length) return '';
  const b = leads.at(-1);
  const to = b.errand;
  const from = b.giver;
  const parcel = b.parcel ? parcelRef(b.parcel, from) : null;
  if (parcel && to) return `${from ? `${from} had ${parcel} for ${to}` : `There was ${parcel} for ${to}`}, and ${voice.he} carried it.`;
  if (to && from && from !== to) return `${from} sent ${voice.him} on to ${to}.`;
  if (to) return `Word sent ${voice.him} to ${to}.`;
  return '';
}

// The last errand of the chain: where the road went afterwards.
function codaClause(g, arc, voice, final) {
  const b = g.coda.filter((x) => x.errand || x.parcel).at(-1);
  if (!b) return '';
  const to = b.errand;
  const parcel = b.parcel ? parcelRef(b.parcel, b.giver) : null;
  const place = b.landmarks.find((l) => !to || !to.includes(l)) || null;
  if (parcel && to) return `${final ? 'When it was over, ' : 'Then '}${b.giver ? `${b.giver} put ${parcel} in ${voice.his} hands` : `there was ${parcel} to carry`} and pointed ${voice.him} at ${to}${place ? `, in ${placeRef(place)}` : ''}. ${voice.He} went.`;
  if (to) return final ? `After that, the road led to ${to}${place ? ` in ${placeRef(place)}` : ''}, and ${voice.he} took it.` : `${b.giver || 'Word'} sent ${voice.him} on to ${to}${place ? ` in ${placeRef(place)}` : ''}.`;
  return '';
}

function errandOnly(g, arc, voice) {
  const b = g.leads.at(-1) || g.coda.at(-1);
  if (!b) return `${voice.He} did what was asked, and did it without fuss.`;
  const to = b.errand || 'the one who was waiting';
  const parcel = b.parcel ? parcelRef(b.parcel, b.giver) : null;
  return `${b.giver ? `${b.giver} had ${parcel || 'word'} for ${to}` : `There was ${parcel || 'word'} for ${to}`}, and ${voice.he} carried it there ${voice.self}. Small errands are how a stranger becomes someone a place can name.`;
}

// A sentence that turns from the last thread to this one.
function bridge(g, prev, arc, voice, v) {
  const same = g.beats[0].giver && prev.beats.at(-1)?.giver === g.beats[0].giver;
  if (same) return [`${g.beats[0].giver} was not finished with ${voice.him}.`, `${g.beats[0].giver} had more.`, `There was more, and ${g.beats[0].giver} did not pretend otherwise.`][v(3)];
  return ['It did not stop there.', 'Word gets around in a small place.', 'That was one worry. It was not the only one.'][v(3)];
}

// The campaign against the family of enemies: several chapters folded into
// an escalation, with the words of the people who asked where they were read.
function foeParagraphs(g, arc, voice, v) {
  const fam = g.kind === 'foe' ? arc.family : null;
  const beats = g.beats;
  const first = beats[0];
  const foes = fam ? fam.plural : pluralFoe(first.tasks.find((t) => t.kind === 'kill')?.name || 'enemies');
  const giver = first.giver;
  const ref = giver ? titleRef(giver) : null;
  const s1 = [];
  if (giver) s1.push([`It was ${giver} who put a name to the trouble: the ${foes}.`, `${giver} did not want the ${foes} watched. ${cap(ref || giver)} wanted them gone.`, `${giver} laid it out plainly. The ${foes} had to go.`][v(3)]);
  else s1.push(`The ${foes} were the trouble, and everyone knew it.`);
  if (first.said) s1.push(`"${first.said}."`);
  const stages = beats.flatMap((b) => {
    const kills = b.tasks.filter((t) => t.kind === 'kill');
    if (!kills.length && b.kind === 'named') return [{ kind: null, count: null, named: b.named }];
    return kills.map((t) => ({ kind: subKind(t.name, fam), count: t.count, named: b.kind === 'named' ? b.named : null }));
  });
  const label = (st) => (st.named ? st.named : `the ${st.kind}`);
  if (stages.length === 1) {
    const st = stages[0];
    s1.push(st.count != null ? [`${cap(words(st.count))} of them, to start with, and the rest could wait.`, `The count was ${words(st.count)}. ${voice.He} did not ask what came after.`, `${cap(words(st.count))}, ${ref || giver || 'the ask'} said, and no fewer.`][v(3)] : `${cap(label(st))} had to be found and finished.`);
    s1.push([`${voice.He} went out past the last fence and started.`, `${voice.He} found them where ${ref || giver || 'the word'} said ${voice.he} would.`, `It was not clever work. It did not need to be.`][v(3)]);
  } else {
    const list = stages.map(label);
    s1.push([`First ${list[0]}, then ${list.slice(1).join(', then ')}, each further in than the last.`, `The ${foes} came in kinds: ${list.slice(0, -1).join(', ')} and ${list.at(-1)}, and ${voice.he} went through them in that order.`, `It went by stages. ${cap(list[0])} at the edge of things, ${list.slice(1).join(', then ')}, deeper every time.`][v(3)]);
    const total = stages.reduce((s, st) => s + (st.count || 0), 0);
    if (total >= 20) s1.push([`Past ${words(total)} the counting stopped mattering.`, `${cap(words(total))} is a number that only sounds small from a distance.`][v(2)]);
    else s1.push(`Each trip out was longer than the last, and each one ${voice.he} came back from.`);
  }
  const asked = stages.reduce((s, st) => s + (st.count || 0), 0);
  const hunted = beats.reduce((s, b) => s + b.tasks.filter((t) => t.kind === 'kill').reduce((x, t) => x + (t.hunted || 0), 0), 0);
  if (hunted && asked && hunted > asked) s1.push(`By the end it was ${words(hunted)}, more than anyone had asked for.`);
  const para1 = s1.join(' ');
  const last = beats.at(-1);
  const to = last.ender || last.giver;
  const s2 = [];
  if (beats.length > 1 && last.said && last.said !== first.said) s2.push(`By the last of it ${last.giver || to} had stopped explaining. "${last.said}."`);
  if (last.thanks && to) s2.push(`"${last.thanks}," ${to} said when it was done.`);
  else if (to && beats.length > 1) s2.push([`${to} counted, and did not argue with the count.`, `${to} took the news the way people take good news in a hard year: carefully.`][v(2)]);
  if (s2.length && beats.length > 1) s2.push(texture(arc, voice, v));
  if (beats.length === 1) return [[para1, ...s2].join(' ')];
  return s2.length ? [para1, s2.join(' ')] : [para1];
}

// A named enemy: the turn of the story.
function namedParagraph(b, arc, voice, v) {
  const name = b.named;
  const giver = b.giver;
  const head = b.tasks.find((t) => t.kind === 'item' && /\bhead\b/i.test(t.name));
  const carried = !head && b.tasks.find((t) => t.kind === 'item');
  const proof = head ? `${b.foeSex || 'the'} head` : carried ? thingName(carried, b) : null;
  const who = b.epithet || name;
  const s = [];
  s.push([`Then there was ${name}${b.epithet ? `, ${b.epithet}` : ''}.`, `And there was ${name}${b.epithet ? `, ${b.epithet}` : ''}.`, `${name}${b.epithet ? `, ${b.epithet},` : ''} was another matter.`][v(3)]);
  if (b.said) s.push(`"${b.said}," ${giver || 'the word'} ${v(2) ? 'said' : 'put it'}.`);
  else if (giver) s.push(head ? [`${giver} wanted ${who} dead, and wanted ${proof} as proof.`, `${giver} had a price on ${who}, and ${proof} would settle it.`][v(2)]
    : carried ? `${giver} wanted ${who} dead, and wanted whatever ${who} was carrying.`
      : [`${giver} wanted ${who} dead, and wanted to hear it from someone who had seen it.`, `${giver} had a price on ${who}, and was not fussy about who collected.`][v(2)]);
  s.push([`${voice.He} found ${who} where such people are found, at the edge of everything.`, `${voice.He} went looking. It is a short story from there.`, `It ended the way those things end, without ceremony.`][v(3)]);
  if (proof && !b.said) s.push(`${cap(proof)} went back to ${b.ender || giver || 'the one who had asked'}.`);
  if (b.thanks) s.push(`"${b.thanks}," was all ${b.ender || giver || 'anyone'} said.`);
  return s.join(' ');
}

function exploreParagraph(g, arc, voice, v) {
  const b = g.beats[0];
  const places = g.beats.map((x) => placeRef(x.explore));
  const s = [];
  if (b.giver) s.push([`${b.giver} wanted eyes on ${places[0]}, and had none to spare.`, `${b.giver} needed to know what was inside ${places[0]}, and needed someone else to find out.`][v(2)]);
  else s.push(`Somebody had to go and see ${places[0]}.`);
  if (b.said) s.push(`"${b.said}."`);
  s.push(places.length > 1 ? `${voice.He} went into ${places[0]}, and after that ${places.slice(1).join(', then ')}, as far as each went.` : `${voice.He} went in, as far as it went, and came back with the shape of it in ${voice.his} head.`);
  s.push([`Dark places are mostly waiting. The rest is what the waiting is for.`, `What ${voice.he} saw in there ${voice.he} kept short in the telling, which told ${b.giver || 'them'} enough.`][v(2)]);
  const last = g.beats.at(-1);
  if (last.thanks) s.push(`"${last.thanks}," ${last.ender || last.giver || 'they'} said.`);
  return s.join(' ');
}

function gatherParagraphs(g, arc, voice, v) {
  const beats = g.beats;
  const first = beats[0];
  const giver = first.giver;
  const flat = beats.flatMap((b) => b.tasks.filter((t) => t.kind !== 'kill').map((t) => ({ t, b, phrase: t.count != null ? `${words(t.count)} ${thingName(t, b, true)}` : thingName(t, b), hint: b.hint, kind: t.kind })));
  const s = [];
  const x0 = flat[0];
  const food = FOOD.test(x0.t.name) && !CONTAINER.test(x0.t.plural || '');
  const obj = flat.every((x) => x.kind === 'object');
  const own = giver && ownName(x0.t.name, giver);
  const it = x0.t.count != null ? 'them' : 'it';
  if (giver) {
    if (obj && first.parcel) s.push(`${giver} needed ${parcelRef(first.parcel, giver)} brought to ${x0.phrase}, and could not carry it there in person.`);
    else if (obj && x0.t.count == null) s.push(`${giver} had business at ${x0.phrase}, and could not go in person.`);
    else if (obj) s.push(`${giver} wanted to know what ${flat.map((x) => x.phrase).join(' and ')} were hiding.`);
    else if (own) s.push(x0.t.count != null ? [`${giver}'s own ${own} was still out there, ${countOf(x0.t)} of it, and nobody to bring it in.`, `${giver} had ${x0.phrase} sitting where it should not be, and no one to carry it.`][v(2)] : `${giver}'s own ${own} was out there somewhere, and ${giver} wanted it back.`);
    else if (food) s.push([`${giver} wanted ${x0.phrase}, and would not stop talking about it.`, `${giver} had a craving, and its name was ${thingName(x0.t, x0.b, true)}.${x0.t.count != null ? ` ${cap(words(x0.t.count))}, to be exact.` : ''}`, `What ${giver} wanted was simple: ${x0.phrase}.`][v(3)]);
    else s.push([`${giver} needed ${x0.phrase}, and needed ${it} soon.`, x0.t.count != null ? `${giver} was short of ${thingName(x0.t, x0.b, true)}, and said so.` : `${giver} wanted ${x0.phrase}, and said so.`, `${giver} asked for ${x0.phrase}, the way people ask when everyone else has already said no.`][v(3)]);
  } else s.push(`Somebody needed ${x0.phrase}.`);
  if (first.said) s.push(`"${first.said}."`);
  const part = !obj && x0.t.name.match(PART);
  if (own) s.push(`${cap(own)} does not carry itself.`);
  else if (x0.hint) s.push(`${cap(x0.hint)}, ${giver || 'the word'} said, which was the only easy part.`);
  else if (part) {
    const beast = pluralFoe(part[1].replace(ADJ, '')).toLowerCase();
    const parts = pluralOf({ name: part[2] }).toLowerCase();
    s.push([`${cap(parts)} do not come off ${beast} politely. Every one had to be taken from something that objected.`, `That meant ${beast}, a great many of them, and none of them willing.`][v(2)]);
  } else if (!obj) s.push([`Nobody was going to hand ${it} over.`, `Nothing of the kind was lying about waiting to be picked up.`, `Where such a thing was to be found was left to ${voice.him}.`][v(3)]);
  if (flat.length > 1) s.push([`After that it was ${flat.slice(1).map((x) => x.phrase).join(', then ')}.`, `Then ${flat.slice(1).map((x) => x.phrase).join(', and ')}, because a list never has one line.`][v(2)]);
  const hunted = flat.reduce((n, x) => n + (x.t.hunted || 0), 0);
  const asked = flat.reduce((n, x) => n + (x.t.count || 0), 0);
  s.push(hunted && asked && hunted > asked ? `${voice.He} gathered ${words(hunted)} in all, more than the ask, because it is easier to keep going than to count.`
    : obj ? (x0.t.count != null ? `${voice.He} pried them open one by one.` : `${voice.He} went, and did what was needed there, and did not linger.`) : [`${voice.He} went and got ${it}.`, x0.t.count != null ? `${voice.He} went, and kept going until the number was met.` : `${voice.He} went and did not come back without it.`, `It took longer than it sounds.`][v(3)]);
  const last = beats.at(-1);
  const to = last.ender || last.giver;
  if (to && last.ender && last.ender !== last.giver) s.push(`${it === 'them' ? 'The lot' : 'It'} went to ${last.ender}.`);
  if (last.thanks && to) s.push(`"${last.thanks}," ${to} said.`);
  else if (arc.many) s.push(texture(arc, voice, v));
  return [s.join(' ')];
}

// The letters every newcomer was handed: one event, no craft named.
function rolledParagraph(e, arc, voice) {
  const thing = e.rolled.thing;
  const giver = e.giver || arc.patron || 'Someone';
  const v = vary(e.id);
  const teacher = voice.craft && e.errand ? e.errand : null;
  return [
    `${giver} kept a ${thing} for every newcomer who came through, each one sealed for a different teacher, each one saying much the same thing: come and be taught.`,
    `${giver} had one more thing, and it was not a task. Every newcomer got a sealed ${thing}, written for whichever teacher would take them.`,
  ][v(2)] + ` ${voice.He} took ${voice.hers} and went to find ${teacher || 'the one it named'}${e.said ? `, who ${['did not waste words', 'had been expecting someone', 'had plenty to say'][v(3)]}. "${e.said}."` : '.'}`;
}

// What changed for the place and its people.
function resolutionParagraph(arc, voice) {
  const v = vary(arc.seed + 7);
  const d = arc.drive;
  const zone = arc.zones.at(-1) || arc.zones[0] || null;
  const home = arc.home ? placeRef(arc.home) : zone || 'the place';
  const s = [];
  if (d.kind === 'hunt') s.push(`${cap(home)} would not run out of ${d.plural}. It had, for a while, run out of reasons to worry about them.`);
  else if (d.kind === 'foe') s.push([`The ${d.plural} did not vanish. Fewer of them came near ${home}, and the ones that did came carefully.`, `${cap(home)} was not rid of the ${d.plural}, but it was no longer theirs to walk into.`][v(2)]);
  else if (d.kind === 'named') s.push(`${cap(home)} slept easier with ${d.name} gone, or told itself it did.`);
  else if (d.kind === 'explore') s.push(`What ${placeRef(d.place)} had been hiding was hidden no longer.`);
  else if (d.kind === 'want') s.push(FOOD.test(d.thing.name) ? `${cap(home)} ate well that week, which counts as an ending.` : `${cap(home)} had what it needed for a while, and a name for who had brought it.`);
  else s.push(`${cap(home)} had its word delivered, and a face to remember.`);
  if (arc.patron && arc.many) s.push([`${arc.patron} crossed the last line off the list and started another.`, `${arc.patron} would find new things to want. That is what lists are for.`][(v(2) + 1) % 2]);
  s.push([`${cap(heroRef(voice))} did not stay to hear it.`, `By then ${voice.he} was already looking at the road out.`][v(2)]);
  return s.join(' ');
}

// The closing line under the last act.
function resolutionLine(arc, voice) {
  const v = vary(arc.seed + 3);
  const zone = arc.zones[0] || null;
  return [
    `Some stories end with a door closing. This one ended with a road, and ${voice.him} on it.`,
    `${zone ? `${zone} kept the story. ` : ''}${voice.He} kept the scars, and went on.`,
    'It was a small story, as such things go. The people in it did not think so.',
  ][v(3)];
}

function openLine(arc, voice) {
  const v = vary(arc.seed + 5);
  const next = arc.family ? `The ${arc.family.plural} were still out there.` : '';
  return [`${next} That is as far as the story goes, for now.`, `${next} The rest has not happened yet.`, `${next} What came next, ${voice.he} did not know either.`][v(3)].trim();
}

// "the marshal", "the deputy", for people whose names carry a title.
function titleRef(name) {
  const m = String(name || '').match(/^(Marshal|Deputy|Captain|Guard|Sentinel|Sergeant|Lieutenant|Commander|Watcher|Warden|Innkeeper|Magistrate|Foreman|Overseer|Apothecary|Priestess|Priest|Brother|Sister|Mother|Elder|Chief|Chieftain|Lord|Lady|Master)\b/);
  return m ? `the ${m[1].toLowerCase()}` : null;
}

// A place as prose names it: "Goldshire", "Northshire Abbey", but "the Den",
// "the Fargodeep Mine", "the Valley of Trials".
const THE_PLACE = /\b(Mine|Mines|Ridge|Den|Valley|Vale|Hills|Mountains|Forest|Woods|Barrens|Camp|Garrison|Keep|Farm|Farms|Fields|Ruins|Tower|Bridge|Crossroads|Coast|Shore|Lake|River|Falls|Cavern|Caverns|Cave|Caves|Hold|Grove|Glade|Glades|Thicket|Outpost|Docks|Harbor|Mill|Vineyard|Vineyards|Orchard|Cellar|Cliffs|Peak|Pass|Gate|Wall|Road|Path|Trail|Pit|Quarry|Deeps|Tomb|Crypt|Cemetery|Graveyard|Bay|Isle|Swamp|Marsh|Bog|Basin|Canyon|Gulch|Hollow|Stronghold|Fortress|Citadel|Lookout|Landing|Shrine|Temple|Well|Spring|Springs|Steppes|Wilds|Wetlands|Highlands|Lowlands|Flats|Plains|Steps|Circle|Post|Lumber|Logging|Pool|Pools|Hive|Nest|Lair|Warren|Burrow|Village)$/;
function placeRef(s) {
  s = String(s || '').trim();
  if (/^(the|a|an)\s/i.test(s)) return s;
  if (/\bof\b/.test(s) || THE_PLACE.test(s)) return `the ${s}`;
  return s;
}

// "Marshal McBride's Documents" from Marshal McBride: "the documents".
function parcelRef(parcel, from) {
  const m = String(parcel).match(/^(.+?)'s\s+(.+)$/);
  if (m && from && (from === m[1] || from.startsWith(m[1]))) return `the ${m[2].toLowerCase()}`;
  return withThe(lowerThing(parcel));
}

// "Milly's Harvest" for Milly Osworth: "harvest", her own.
function ownName(name, giver) {
  const m = String(name).match(/^(.+?)'s\s+(.+)$/);
  return m && (giver === m[1] || giver.split(' ')[0] === m[1]) ? m[2].toLowerCase() : null;
}

// "eight crates", "ten": the count with its container, for "eight crates of it".
function countOf(t) {
  const m = String(t.plural || '').match(CONTAINER);
  return m ? `${words(t.count)} ${m[0].replace(/\s+of\s+$/i, '')}` : words(t.count);
}

// An item as prose names it: "cactus apples", "eight pieces of tough wolf
// meat", "Milly's harvest", "the grape manifest".
function thingName(t, b, pl = false) {
  const raw = pl ? pluralOf(t) : t.name;
  const owner = b?.giver && ownName(t.name, b.giver);
  const text = owner ? raw.replace(/^((?:\w+\s+of\s+)?)(.+?)'s\s+/, (m, c, who) => `${c}${who}'s own `) : raw;
  const low = lowerThing(text);
  return pl ? low : withThe(low);
}

const TITLE_WORD = /^(Marshal|Deputy|Captain|Brother|Sister|Priestess|Priest|Lord|Lady|Master|Elder|Chief|King|Queen|Prince|Princess|Sir|Dame)$/;
// Names that stay capitalised inside an item's name: factions, peoples and
// places, plus whoever and wherever this tale already names.
const PROPER = /^(Scarlet|Crusade|Defias|Venture|Grimtotem|Bloodsail|Syndicate|Argent|Dawn|Cenarion|Twilight|Burning|Blade|Blackrock|Stormwind|Ironforge|Orgrimmar|Thunder|Bluff|Darnassus|Undercity|Horde|Alliance|Forsaken|Scourge|Shadow|Council|Searing|Razormane|Bristleback|Riverpaw|Gnomeregan|Dalaran|Lordaeron|Silvermoon|Kalimdor|Azeroth|Elwynn|Westfall|Duskwood|Redridge|Stonetalon|Ashenvale|Mulgore|Durotar|Barrens|Tirisfal|Silverpine|Loch|Modan|Teldrassil|Darkshore|Dun|Morogh|Stranglethorn|Deadmines|Kul|Tiras|Theramore|Gadgetzan|Ratchet|Booty|Bay|Brill|Goldshire|Northshire|Kharanos|Dolanaar|Coldridge|Deathknell|Shadowglen|Camp|Narache|Sen'jin|Razor|Hill|Crossroads|Astranaar|Auberdine|Lakeshire|Darkshire|Menethil|Southshore|Tarren|Mill|Hillsbrad|Arathi|Wetlands|Alterac|Stromgarde|Hammerfall|Kargath|Badlands|Uldaman|Feralas|Desolace|Tanaris|Thousand|Needles|Dustwallow|Hinterlands|Aerie|Peak|Winterspring|Felwood|Azshara|Silithus|Un'Goro|Plaguelands|Stratholme|Scholomance|Blackfathom|Wailing|Caverns|Shadowfang|Ragefire|Gnomer|Zul'Farrak|Maraudon|Molten|Core|Onyxia|Nefarian|Ragnaros|Hakkar|Naxxramas|Ahn'Qiraj|Emerald|Dream|Light|Earthmother|Elune|Cenarius|Malfurion|Tyrande|Thrall|Cairne|Sylvanas|Bolvar|Varian|Magni|Mekkatorque|Vol'jin|Hogger|Edwin|VanCleef|Timbermaw|Woodpaw|Bloodfen|Mosshide|Dragonmaw|Stonesplinter|Rockjaw|Frostmane|Bluegill|Murloc|Shadowforge|Dark|Iron|Kolkar|Galak|Magram|Gelkis|Fray|Ironband|Deeprun|Tram)$/;
function lowerThing(s) {
  const w = String(s).split(' ');
  return w.map((x, i) => (x.includes("'") || TITLE_WORD.test(x) || PROPER.test(x) || PROPER_NOW.has(x) || (w[i + 1] && /'s$/.test(w[i + 1])) ? x : x.toLowerCase())).join(' ');
}
let PROPER_NOW = new Set();

function article(s) {
  return /^[aeiou]/i.test(s) ? 'an' : 'a';
}

// ---------------------------------------------------------------------------
// Small words

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n >= 0 && n <= 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  return String(n);
}

// A thing in the plural, as the objective wrote it when it did.
function pluralOf(t) {
  if (t.plural) return t.plural;
  const s = t.name;
  if (/(vermin|folk|deer|fish|sheep|moose|elk|kin|spawn|men|children|people|scum|brood|meat|cloth|ore|dust|water)$/i.test(s)) return s;
  if (/[sxz]$|[cs]h$/i.test(s)) return `${s}es`;
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
}

function cap(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function withThe(s) {
  return /^(the|a|an)\s|'s\b/i.test(s) ? s : `the ${s}`;
}

function cleanTitle(n) {
  return String(n || '').replace(/\s+/g, ' ').trim();
}

// No shouting, no doubled spaces, a capital to start each sentence.
function tidy(s) {
  return String(s).replace(/!/g, '.').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').replace(/\.\./g, '.').replace(/,\s*,/g, ',').trim()
    .replace(/(^|[.?]\s+|[.?]"\s+)([a-z])/g, (m, before, c) => `${before}${c.toUpperCase()}`);
}
