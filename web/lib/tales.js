// Tales: a finished storyline told as a story for the Lore page. Third
// person, past tense, the voice of a storyteller for teens: direct, a little
// dry, stakes stated plainly, no "once upon a time". Every fact comes from
// the database and what was logged: the place, who asked, what they said,
// what had to be done, who did it and what they were given for it. Nothing
// about the game leaks in: no quests, levels or logs, only people, places
// and errands. The Journal on a character's page is the first-person side.
//
// Chapters that only differ by class (the letters and tablets a village
// sends its newcomers to five different teachers) are rolled into one event:
// nobody lives all five, and the story is the same one.

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

// Character key -> { name, race, class, sex, level } from the journey (which
// knows sex) or the codex (which does not).
function heroLookup(codex, characters) {
  const m = new Map();
  for (const c of codex?.characters || []) if (c.key) m.set(c.key, { name: c.name, race: c.race ?? null, class: c.class ?? null, sex: null, level: c.level || null });
  for (const c of characters || []) if (c.key) m.set(c.key, { name: c.name, race: c.info?.race ?? null, class: c.info?.class ?? null, sex: c.info?.sex ?? null, level: c.level || null });
  const cq = codexQuests(codex);
  return { get: (k) => m.get(k) ?? null, cq };
}

// ---------------------------------------------------------------------------
// Telling one

// tale: from tales(). hero: { name, race, class, sex }. pretend: tell every
// chapter as if it were done, from the database alone where nothing was
// logged. defaultSex: the pronouns when the hero's sex is not known (the
// account's own, male unless set otherwise); the tale never says "they".
export function tellTale(tale, { db, codex, world = null, hero = tale.heroes?.[0] || null, pretend = false, defaultSex = 'male' } = {}) {
  const cq = codexQuests(codex);
  const who = person(hero, defaultSex);
  const chapters = tale.chapters.some((ch) => ch.variants) ? tale.chapters : rollUp(tale.chapters);
  const told = pretend ? chapters : chapters.filter((ch) => ch.state === 'done');
  const parts = [];
  let prev = null;
  told.forEach((ch, i) => {
    const q = ch.variants ? variantFor(ch, who) : ch.q;
    const facts = chapterFacts(db, q, cq.get(`q${q.id}`), world, who);
    if (ch.variants) facts.rolled = rolledFacts(ch);
    const paragraphs = tellChapter(facts, who, { first: i === 0, prev, index: i, count: told.length });
    parts.push({ heading: ch.variants ? facts.rolled.heading : cleanTitle(q.n), paragraphs });
    prev = facts;
  });
  const finished = pretend || (told.length === chapters.length);
  const ending = finished ? closingLine(prev, who) : `${closingLine(prev, who)} That is as far as it goes, for now.`;
  const dedication = hero?.name ? `As lived by ${hero.name}` : pretend ? 'As it might be lived' : 'As lived by a traveler';
  return { title: tale.title, dedication, parts, ending };
}

// The variant of a rolled-up chapter that stands for it: the one that was
// done, else the hero's own class, else the first.
function variantFor(ch, who) {
  const done = ch.variants.find((v) => v.state === 'done');
  if (done) return done.q;
  const bit = CLASS_BITS[String(who.class || '').toUpperCase()] || 0;
  return ch.variants.find((v) => bit && v.q.cl & bit)?.q ?? ch.q;
}

// What the rolled-up variants have in common: the thing handed over (the
// last word of every title, "Letter" or "Tablet") and how many roads it led to.
function rolledFacts(ch) {
  const lastWords = ch.variants.map((v) => cleanTitle(v.q.n).split(' ').at(-1).toLowerCase());
  const same = lastWords.every((w) => w === lastWords[0]) ? lastWords[0] : null;
  const thing = same && /^(letter|tablet|parchment|note|scroll|rune|sigil|summons|message|missive)$/.test(same) ? same : 'message';
  return { thing, count: ch.variants.length, heading: `The ${thing.charAt(0).toUpperCase()}${thing.slice(1)}` };
}

export function taleText(story) {
  const lines = [`# ${story.title}`, '', `*${story.dedication}*`, ''];
  for (const p of story.parts) {
    lines.push(`## ${p.heading}`, '');
    for (const para of p.paragraphs) lines.push(para, '');
  }
  lines.push(story.ending, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The facts of one chapter, gathered before any words are chosen

function chapterFacts(db, q, c, world, who) {
  const giver = c?.giver?.name || givers(db, q).find((g) => g.kind === 'npc')?.name || givers(db, q)[0]?.name || null;
  const giverKind = c?.giver?.name ? (c.giver.kind === 'GameObject' ? 'object' : 'npc') : givers(db, q)[0]?.kind ?? null;
  const ender = c?.turnInNpc?.name || enders(db, q).find((g) => g.kind === 'npc')?.name || enders(db, q)[0]?.name || null;
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
  const explore = !tasks.length ? matchPlace(objective, /^(?:Explore|Scout|Investigate|Find)\s+(?:the\s+)?([^,.]+?)(?:,|\.|\s+then\b|\s+and\b|$)/i) : null;
  const carry = !tasks.length && !explore ? String(objective).match(/^(?:Bring|Take|Deliver|Carry|Return)\s+(.+?)\s+to\s+([^,.]+?)(?:,|\.|\s+in\b|\s+at\b|\s+outside\b|\s+inside\b|$)/) : null;
  const errand = !tasks.length && !explore ? (carry && short(carry[2]) ? carry[2].trim() : matchPlace(objective, /(?:[Ss]peak|[Tt]alk)\s+(?:with|to)\s+([^,.]+?)(?:,|\.|\s+in\b|\s+at\b|\s+outside\b|\s+inside\b|\s+next\b|$)/)) : null;
  const parcel = carry && short(carry[1]) ? carry[1].trim() : null;
  const hint = matchPlace(objective, /(?:could|can|may) be found ([^.]+)/i);
  const money = (c?.turnedIn || []).map((m) => m.money).find((m) => m > 0) ?? null;
  return {
    id: q.id, title: cleanTitle(q.n), giver, giverKind, ender, zone, tasks, explore, errand, parcel, hint, money,
    said: quoteFrom(c?.text, who), thanks: quoteFrom(c?.reward, who), spoke: Boolean(c?.text),
  };
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

// "10 Cactus Apples" in the objective text: the count and the plural as written.
function countIn(text, name) {
  if (!text || !name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`(\\d+)\\s+((?:pieces?|bags?|crates?|bundles?|vials?|jars?|samples?|sets?|handfuls?|stacks?|bottles?|flasks?|pinches|pinch|bunches|bunch|lumps?) of\\s+)?(${esc}(?:e?s)?)\\b`, 'i'));
  if (!m) return null;
  return { n: Number(m[1]), plural: `${m[2] || ''}${m[3]}` };
}

// A short thing they said, as read: the first sentence when it is short,
// else the first clause. Never over 90 characters.
function quoteFrom(text, who) {
  if (!text) return null;
  let t = String(text).replace(/\$[Bb]/g, ' ').replace(/\s+/g, ' ').trim();
  t = fillNames(t, who);
  const first = t.split(/(?<=[.!?])\s+/)[0] || '';
  let pick = first;
  if (pick.length > 90) {
    const clause = first.split(/[,;:]/)[0].trim();
    pick = clause.length >= 12 && clause.length <= 88 ? `${clause}.` : '';
  }
  if (!pick) return null;
  pick = pick.replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/[.?]$/, '');
  return pick.length > 90 || pick.length < 3 ? null : pick;
}

// $N is the name, $C the class, $R the race, $G male;female; picks by sex.
function fillNames(t, who) {
  const name = who?.name || 'friend';
  return t
    .replace(/\$[Nn]/g, name)
    .replace(/\$[Cc]/g, who?.class ? lower(who.class) : 'friend')
    .replace(/\$[Rr]/g, who?.race ? lower(who.race) : 'traveler')
    .replace(/\$[Gg]\s*([^;]*);([^;]*);?/g, (_, m, f) => (who?.sex === 'female' ? f : m).trim())
    .replace(/<([^/<>]+)\/([^<>]+)>/g, (_, m, f) => (who?.sex === 'female' ? f : m).trim());
}

// ---------------------------------------------------------------------------
// The words

const FOOD = /\b(apple|apples|meat|egg|eggs|fruit|berry|berries|mushroom|wine|cheese|bread|pie|stew|ale|honey|fish|milk|grape|grapes|melon|cake|nut|nuts|spice|spices|herb|herbs|harvest|kimchi|ribs|chops|beer|mead|brew)\b/i;

// Zones as a storyteller names them: a flourish for the places the stories
// most often begin, and the plain name everywhere else.
const ZONE_FLOURISH = {
  'Durotar': 'the red dust of Durotar', 'Elwynn Forest': 'the green woods of Elwynn', 'Dun Morogh': 'the snows of Dun Morogh', 'Teldrassil': 'the great tree Teldrassil',
  'Mulgore': 'the wide grass of Mulgore', 'Tirisfal Glades': 'the grey glades of Tirisfal', 'Westfall': 'the golden fields of Westfall', 'The Barrens': 'the dry plains of the Barrens',
  'Loch Modan': 'the lake country of Loch Modan', 'Darkshore': 'the dark shore of Darkshore', 'Silverpine Forest': 'the silver pines of Silverpine', 'Redridge Mountains': 'the red hills of Redridge',
  'Duskwood': 'the gloom of Duskwood', 'Stonetalon Mountains': 'the high stone of Stonetalon', 'Ashenvale': 'the old forest of Ashenvale', 'Stranglethorn Vale': 'the steaming jungle of Stranglethorn',
};

// Who the hero is, with pronouns: the hero's own sex, else the account's.
function person(hero, defaultSex = 'male') {
  const name = hero?.name || null;
  const sex = hero?.sex === 'female' || hero?.sex === 'male' ? hero.sex : defaultSex === 'female' ? 'female' : 'male';
  const f = sex === 'female';
  return { name, race: hero?.race || null, class: hero?.class || null, sex, level: hero?.level || null, they: f ? 'she' : 'he', them: f ? 'her' : 'him', their: f ? 'her' : 'his', cap: (s) => s.charAt(0).toUpperCase() + s.slice(1) };
}

function heroRef(who) {
  return who.name || 'the adventurer';
}

function tellChapter(f, who, { first, prev, index }) {
  const v = (n) => (f.id + index) % n; // deterministic variety per chapter
  const place = f.zone ? (ZONE_FLOURISH[f.zone] || f.zone) : null;
  if (f.rolled) return rolledChapter(f, who, { first, prev, v, place }).filter(Boolean).map(tidy);
  const paras = [];
  const asker = f.giver || 'the one who asked';

  // 1. The place, the one with the problem, and what the problem was.
  let opening;
  if (first) {
    const where = place ? `${['It started in ', 'This one begins in ', 'The trouble began in '][v(3)]}${place}` : ['It started small', 'This one begins with a favour', 'The trouble began quietly'][v(3)];
    if (f.giver) opening = `${where}, with ${describeGiver(f)} named ${f.giver}. ${f.giver} ${wantLine(f)}.`;
    else opening = `${where}. Someone ${wantLine(f)}.`;
  } else {
    const sameGiver = prev?.giver && prev.giver === f.giver;
    const link = ['That should have been the end of it. It was not.', 'It did not stop there.', 'One thing led to another.', 'There was a catch.', 'The next job came quickly.', 'Word gets around in a small place.'][v(6)];
    const moved = Boolean(f.zone && prev?.zone && prev.zone !== f.zone);
    if (sameGiver) opening = `${link} ${f.giver} ${['was not done with', 'had another problem for', 'had more to ask of'][v(3)]} ${who.them}: now ${f.giver} ${wantLine(f)}.`;
    else if (f.giver) opening = `${link} ${moved ? `Over in ${place}, ` : ''}${moved ? describeGiver(f) : who.cap(describeGiver(f))} named ${f.giver} ${wantLine(f)}.`;
    else opening = `${link} Someone ${wantLine(f)}.`;
  }
  if (f.said) opening += ` "${f.said}," ${[`${asker} said`, `${asker} put it`, `${asker} told ${who.them}`][v(3)]}.`;
  paras.push(opening);

  // 2. Enter the hero.
  if (first) {
    const came = ['was passing through and heard about it', 'happened to be in the area', 'turned up at the right moment', 'was new to the place and looking for work'][v(4)];
    paras.push(who.name ? `${describeHero(who)} named ${who.name} ${came}.` : `${describeHero(who)} ${came}.`);
  }

  // 3. What it took, and 4. the return.
  paras.push(taskLine(f, who, v));
  paras.push(returnLine(f, who, v));
  return paras.filter(Boolean).map(tidy);
}

// A rolled-up chapter: the message every newcomer is handed, whoever
// their teacher turns out to be. Told once, not once per class.
function rolledChapter(f, who, { first, prev, v, place }) {
  const thing = f.rolled.thing;
  const teacher = f.errand || 'the one who taught newcomers';
  const giver = f.giver || 'someone';
  const out = [];
  if (first) {
    out.push(`${place ? `In ${place}, ` : ''}${describeGiver(f)} named ${giver} kept a ${thing} for every newcomer who came through. Each was sealed for a different teacher, and each said much the same thing: come and be taught.`);
    out.push(`${describeHero(who)}${who.name ? ` named ${who.name}` : ''} got ${who.their}s.`);
  } else {
    const sameGiver = prev?.giver && prev.giver === f.giver;
    out.push(`${sameGiver ? `${giver} also had a ${thing} for ${who.them}` : `${who.cap(describeGiver(f))} named ${giver} handed ${who.them} a ${thing}`}, the kind every newcomer got, ${['sealed for whichever teacher would take them', 'each one meant for a different teacher', 'one for each path a newcomer might walk'][v(3)]}. It said to go and be taught.`);
  }
  out.push(`${who.cap(who.they)} ${['went and found', 'tracked down', 'sought out'][v(3)]} ${teacher}${f.said ? `, who ${['had plenty to say', `was expecting ${who.them}`, 'did not waste words'][v(3)]}. "${f.said}."` : `, and ${['listened', 'learned what there was to learn', 'came away knowing more than before'][v(3)]}.`}`);
  return out;
}

function describeGiver(f) {
  if (f.giverKind === 'object') return 'a curious thing';
  const t = f.giver || '';
  if (/^(Marshal|Deputy|Captain|Guard|Sentinel|Sergeant|Lieutenant|Commander|Watcher|Grunt|Warden)\b/.test(t)) return 'a soldier';
  if (/^(Brother|Sister|Priestess|Priest|Father|Apothecary|Magistrate|Elder|Innkeeper|Chief|Lady|Lord|Chieftain|Foreman|Overseer|Master|Mother)\b/.test(t)) return 'someone with a title and a problem';
  return 'someone';
}

// "a young troll hunter".
function describeHero(who) {
  const age = !who.level || who.level <= 20 ? 'young' : who.level >= 50 ? 'seasoned' : '';
  const what = [who.race ? lower(who.race) : '', who.class ? lower(who.class) : ''].filter(Boolean).join(' ') || 'adventurer';
  const bits = [age, what].filter(Boolean).join(' ');
  return `${who.cap(article(bits))} ${bits}`;
}

// What the one who asked wanted, from the first thing to do.
function wantLine(f) {
  const t = f.tasks[0];
  if (t?.kind === 'item') {
    if (t.count == null) return `needed ${bare(t.name)}, and was not picky about how`;
    const thing = plural(t, t.count);
    return FOOD.test(t.name) ? `wanted ${thing}, and would not stop talking about it` : `needed ${thing}, and needed them soon`;
  }
  if (t?.kind === 'kill') return t.count == null && f.tasks.length === 1 ? `wanted ${t.name} dead, and had good reason` : `had had enough of the ${plural(t, t.count ?? 2)}`;
  if (t?.kind === 'object') return `wanted to know what the ${plural(t, t.count ?? 2)} were hiding`;
  if (f.explore) return `wanted eyes on ${withThe(f.explore)}, and had none to spare`;
  if (f.parcel) return `needed ${withThe(f.parcel)} carried to ${f.errand}`;
  if (f.errand) return `needed word carried to ${f.errand}`;
  return 'needed a hand, and nobody else was offering';
}

function taskLine(f, who, v) {
  const cap = who.cap;
  if (f.tasks.length) {
    const named = (t) => (t.count != null ? `${words(t.count)} ${plural(t, t.count)}` : t.kind === 'kill' ? t.name : withThe(t.name));
    const bit = (t) => {
      if (t.kind === 'kill') return t.count != null ? `${named(t)} had to go` : `${t.name} had to be found and finished`;
      if (t.kind === 'item') return t.count == null ? `${named(t)} had to be brought back` : `${named(t)} had to be gathered${t === f.tasks[0] && f.hint ? `, found ${f.hint}` : ''}`;
      return `${named(t)} had to be cracked open`;
    };
    let s;
    if (f.tasks.length <= 2) s = `${['The job: ', 'Simple enough on paper. ', 'The deal was this: '][v(3)]}${f.tasks.map(bit).join(', and ')}.`;
    else {
      const list = f.tasks.slice(0, 4).map(named);
      const more = f.tasks.length > 4 ? ', and more besides' : '';
      s = `${['It was a list', 'The list was not short', 'There was a list, and it was long'][v(3)]}: ${list.slice(0, -1).join(', ')} and ${list.at(-1)}${more}.`;
    }
    const t = f.tasks[0];
    if (t.hunted) s += ` ${cap(who.they)} ${t.kind === 'kill' ? `hunted ${words(t.hunted)} of them in all` : `found ${words(t.hunted)} in all`}, ${['more than was asked', 'which took longer than it sounds', 'one at a time'][v(3)]}.`;
    else s += ` ${cap(who.they)} ${['got on with it', 'went to see about it', 'did not argue'][v(3)]}.`;
    return s;
  }
  if (f.explore) return `So ${who.they} went into ${withThe(f.explore)} to see for ${who.them}self, ${['every dark corner of it', 'all the way to the back', 'as far as it went'][v(3)]}.`;
  if (f.errand) return `So ${who.they} carried ${f.parcel ? withThe(f.parcel) : 'the word'} to ${f.errand}, ${['without stopping', 'and did not read it on the way', 'over hill and road'][v(3)]}.`;
  return `So ${who.they} did what was asked, ${['and did it properly', 'and did not drag it out', `as well as ${who.they} could`][v(3)]}.`;
}

function returnLine(f, who, v) {
  const cap = who.cap;
  const t = f.tasks[0];
  const to = f.ender || f.giver || 'the one who had asked';
  let back;
  if (f.errand && !f.tasks.length) back = ''; // the errand already brought them there
  else if (f.ender && f.ender !== f.giver) back = `${cap(who.they)} ${t?.kind === 'item' ? ['carried them to', 'brought them to', 'took the lot to'][v(3)] : ['brought the news to', 'went on to', `made ${who.their} way to`][v(3)]} ${f.ender}.`;
  else back = `${['When it was done', 'Afterwards', 'Then'][v(3)]} ${who.they} went back to ${to}.`;
  const thanks = f.thanks ? `"${f.thanks}," ${['said', 'was all'][v(2)]} ${to}${v(2) ? ' had to say' : ''}.` : `${cap(to)} ${['was satisfied', 'did not complain', 'called it a job well done'][v(3)]}.`;
  const coin = f.money ? ` ${cap(who.they)} ${[`got ${coins(f.money)} for ${who.their} trouble`, `walked away with ${coins(f.money)} in ${who.their} pocket`][v(2)]}.` : '';
  return `${back} ${thanks}${coin}`;
}

function closingLine(f, who) {
  if (!f) return 'And that was that.';
  const t = f.tasks[0];
  if (f.rolled) return `${who.cap(who.they)} had a teacher now, and a long way still to go.`;
  if (t?.kind === 'kill') return f.zone ? `${f.zone} was a little safer for it. Not much, but a little.` : 'The roads were a little safer for it.';
  if (t?.kind === 'item') return f.giver && t.count != null ? `${f.giver} had all the ${plural(t, 2)} anyone could want, and ${heroRef(who)} had somewhere else to be.` : 'Nothing was wanting after that.';
  if (t?.kind === 'object') return 'What was hidden was hidden no longer.';
  if (f.explore) return `${who.cap(withThe(f.explore))} kept no more secrets from ${who.them}.`;
  if (f.errand) return 'The word got where it needed to go.';
  return `${who.cap(heroRef(who))} moved on, a little more sure of ${who.them}self.`;
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

function plural(t, n) {
  if (n === 1) return t.name;
  if (t.plural) return t.plural;
  const s = t.name;
  if (/(vermin|folk|deer|fish|sheep|moose|elk|kin|spawn|men|children|people|scum|brood)$/i.test(s)) return s;
  if (/[sxz]$|[cs]h$/i.test(s)) return `${s}es`;
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
}

// "Night Elf" -> "night elf": for races and classes only, never for names.
function lower(s) {
  return String(s || '').toLowerCase();
}

function article(s) {
  return /^[aeiou]/i.test(s) ? 'an' : 'a';
}

function withThe(s) {
  return /^(the|a|an)\s|'s\b/i.test(s) ? s : `the ${s}`;
}

// A thing named as a storybook would: with "the" unless it is someone's.
function bare(s) {
  return withThe(s);
}

function coins(copper) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  const bits = [];
  if (g) bits.push(`${words(g)} gold`);
  if (s) bits.push(`${words(s)} silver`);
  if (c || !bits.length) bits.push(`${words(c)} copper`);
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}` : bits[0];
}

// "a, and b." when that stays short; "a. And b." when it would run long.
function joinShort(a, b) {
  const one = `${a}, and ${b}.`;
  return one.split(/\s+/).length < 24 ? one : `${a}. And ${b}.`;
}

function cleanTitle(n) {
  return String(n || '').replace(/\s+/g, ' ').trim();
}

// No shouting, no doubled spaces, a capital to start.
function tidy(s) {
  return String(s).replace(/!/g, '.').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').replace(/\.\./g, '.').trim()
    .replace(/(^|[.?]\s+|[.?]"\s+)([a-z])/g, (m, before, c) => `${before}${c.toUpperCase()}`);
}
