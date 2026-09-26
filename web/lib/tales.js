// Tales: a finished storyline told as a storybook story for the Lore page,
// the way a story is read to a child. Warm, simple sentences, a little
// wonder. Every fact comes from the database and what was logged: the place,
// who asked, what they said, what had to be done, who did it and what they
// were given for it. Nothing about the game leaks in: no quests, levels or
// logs, only people, places and errands.

import { givers, enders, objectives } from './questdb.js';
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
    const chapters = s.quests.map((r) => chapterOf(r.q, r.state, cq));
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
  for (const ch of chapters) {
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
// chapter as if it were done, from the database alone where nothing was logged.
export function tellTale(tale, { db, codex, world = null, hero = tale.heroes?.[0] || null, pretend = false } = {}) {
  const cq = codexQuests(codex);
  const who = person(hero);
  const told = pretend ? tale.chapters : tale.chapters.filter((ch) => ch.state === 'done');
  const parts = [];
  let prev = null;
  told.forEach((ch, i) => {
    const facts = chapterFacts(db, ch.q, cq.get(`q${ch.q.id}`), world, who);
    const paragraphs = tellChapter(facts, who, { first: i === 0, prev, index: i, count: told.length });
    parts.push({ heading: cleanTitle(ch.q.n), paragraphs });
    prev = facts;
  });
  const finished = pretend || (told.length === tale.chapters.length);
  const ending = finished ? `${closingLine(prev, who)} The end.` : `${closingLine(prev, who)} That is as far as the tale goes, for now.`;
  const dedication = hero?.name ? `As lived by ${hero.name}` : pretend ? 'As it might be lived' : 'As lived by a traveler';
  return { title: tale.title, dedication, parts, ending };
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
const FOE = /\b(kill|slay|hunt|destroy|defeat|rid|cull|thin|kobold|gnoll|wolf|wolves|defias|murloc|bandit|raider|scout|troll|spider|boar|thief|thieves)\b/i;

// Zones as a storybook would name them: a small flourish for the places
// the stories most often begin, and the plain name everywhere else.
const ZONE_FLOURISH = {
  'Durotar': 'the red dust of Durotar', 'Elwynn Forest': 'the green woods of Elwynn', 'Dun Morogh': 'the snows of Dun Morogh', 'Teldrassil': 'the great tree Teldrassil',
  'Mulgore': 'the wide grass of Mulgore', 'Tirisfal Glades': 'the grey glades of Tirisfal', 'Westfall': 'the golden fields of Westfall', 'The Barrens': 'the dry plains of the Barrens',
  'Loch Modan': 'the lake country of Loch Modan', 'Darkshore': 'the dark shore of Darkshore', 'Silverpine Forest': 'the silver pines of Silverpine', 'Redridge Mountains': 'the red hills of Redridge',
  'Duskwood': 'the gloom of Duskwood', 'Stonetalon Mountains': 'the high stone of Stonetalon', 'Ashenvale': 'the old forest of Ashenvale', 'Stranglethorn Vale': 'the steaming jungle of Stranglethorn',
};

// Who the hero is, with pronouns. No sex: the name stands in for every pronoun.
function person(hero) {
  const name = hero?.name || null;
  const sex = hero?.sex || null;
  const they = sex === 'male' ? 'he' : sex === 'female' ? 'she' : name || 'the traveler';
  const them = sex === 'male' ? 'him' : sex === 'female' ? 'her' : name || 'the traveler';
  const their = sex === 'male' ? 'his' : sex === 'female' ? 'her' : name ? `${name}'s` : "the traveler's";
  return { name, race: hero?.race || null, class: hero?.class || null, sex, level: hero?.level || null, they, them, their, cap: (s) => s.charAt(0).toUpperCase() + s.slice(1) };
}

function tellChapter(f, who, { first, prev, index }) {
  const v = (n) => (f.id + index) % n; // deterministic variety per chapter
  const paras = [];
  const place = f.zone ? (ZONE_FLOURISH[f.zone] || f.zone) : null;
  const asker = f.giver || 'the one who asked';

  // 1. The place and the one who needed help.
  let opening;
  if (first) {
    const lived = f.giverKind === 'object' ? 'stood' : 'lived';
    const start = place ? `${['Once, in ', 'Once upon a time, in ', 'Once, long ago, in '][v(3)]}${place}` : ['Once', 'Once upon a time', 'Once, long ago'][v(3)];
    opening = f.giver ? joinShort(`${start}, there ${lived} ${describeGiver(f)} named ${f.giver}`, `${f.giver} ${wantLine(f)}`) : `${start}, someone ${wantLine(f)}.`;
  } else {
    const sameGiver = prev?.giver && prev.giver === f.giver;
    const link = ['But that was not the end of it.', 'And that was not all.', 'There was more to do.', 'But the story goes on.'][v(4)];
    const moved = Boolean(f.zone && prev?.zone && prev.zone !== f.zone);
    if (sameGiver) opening = `${link} ${f.giver} ${['was not done with', 'had another worry for', 'soon had more to ask of'][v(3)]} ${who.them}. Now ${f.giver} ${wantLine(f)}.`;
    else if (f.giver) opening = `${link} ${moved ? `Over in ${place}, ` : ''}${moved ? describeGiver(f) : who.cap(describeGiver(f))} named ${f.giver} ${wantLine(f)}.`;
    else opening = `${link} Someone ${wantLine(f)}.`;
  }
  if (f.said) opening += ` "${f.said}," ${[`said ${asker}`, `sighed ${asker}`, `${asker} told ${who.them}`][v(3)]}.`;
  paras.push(opening);

  // 2. The hero comes by.
  if (first) {
    const heard = ['heard about it', 'came by that way', 'was passing through', 'happened to be near'][v(4)];
    paras.push(who.name ? `${describeHero(who)} called ${who.name} ${heard}.` : `A traveler ${heard}.`);
  }

  // 3. What had to be done, and 4. the return.
  paras.push(taskLine(f, who, v));
  paras.push(returnLine(f, who, v));
  return paras.filter(Boolean).map(tidy);
}

function describeGiver(f) {
  if (f.giverKind === 'object') return 'a curious thing';
  const t = f.giver || '';
  if (/^(Marshal|Deputy|Captain|Guard|Sentinel|Sergeant|Lieutenant|Commander|Watcher|Grunt|Warden)\b/.test(t)) return 'a watchful soldier';
  if (/^(Brother|Sister|Priestess|Priest|Father|Apothecary|Magistrate|Elder|Innkeeper|Chief|Lady|Lord|Chieftain|Foreman|Overseer|Master|Mother)\b/.test(t)) return 'a busy someone';
  return 'someone';
}

// "a young troll hunter".
function describeHero(who) {
  const age = !who.level || who.level <= 20 ? 'young' : who.level >= 50 ? 'seasoned' : '';
  const bits = [age, who.race ? lower(who.race) : '', who.class ? lower(who.class) : ''].filter(Boolean).join(' ');
  return bits ? `${who.cap(article(bits))} ${bits}` : 'A traveler';
}

// What the one who asked wanted, from the first thing to do.
function wantLine(f) {
  const t = f.tasks[0];
  if (t?.kind === 'item') {
    if (t.count == null) return `needed ${bare(t.name)}, and needed it badly`;
    const thing = plural(t, t.count);
    return FOOD.test(t.name) ? `loved ${thing} more than anything` : `needed ${thing}, and needed them badly`;
  }
  if (t?.kind === 'kill') return t.count == null && f.tasks.length === 1 ? `feared ${t.name}, who was out there somewhere` : `feared the ${plural(t, t.count ?? 2)} more than anything`;
  if (t?.kind === 'object') return `wondered what the ${plural(t, t.count ?? 2)} held`;
  if (f.explore) return `wondered what lay inside ${withThe(f.explore)}`;
  if (f.parcel) return `had ${withThe(f.parcel)} to send to ${f.errand}`;
  if (f.errand) return `had word to send to ${f.errand}`;
  return 'needed a hand with something';
}

function taskLine(f, who, v) {
  const cap = who.cap;
  if (f.tasks.length) {
    const named = (t) => (t.count != null ? `${words(t.count)} ${plural(t, t.count)}` : t.kind === 'kill' ? t.name : withThe(t.name));
    const bit = (t) => {
      if (t.kind === 'kill') return t.count != null ? `${named(t)} had to be dealt with` : `${t.name} had to be found and dealt with`;
      if (t.kind === 'item') return `${named(t)} had to be gathered${t === f.tasks[0] && f.hint ? `, found ${f.hint}` : ''}`;
      return `${named(t)} had to be opened and looked into`;
    };
    let s;
    if (f.tasks.length <= 2) s = `${['So ', 'Well then. ', 'That was that. '][v(3)]}${f.tasks.map(bit).join(', and ')}.`;
    else {
      const list = f.tasks.slice(0, 4).map(named);
      const more = f.tasks.length > 4 ? ', and more besides' : '';
      s = `${['It was quite a list', 'There was a list', 'The list was long'][v(3)]}: ${list.slice(0, -1).join(', ')} and ${list.at(-1)}${more}.`;
    }
    const t = f.tasks[0];
    if (t.hunted) s += ` ${cap(who.they)} ${t.kind === 'kill' ? `hunted ${words(t.hunted)} of them in all` : `found ${words(t.hunted)} in all`}, ${['and that was plenty', 'which took a while', 'one after another'][v(3)]}.`;
    else s += ` ${cap(who.they)} ${['set off at once', 'went to see about it', `rolled up ${who.their} sleeves`][v(3)]}.`;
    return s;
  }
  if (f.explore) return `So ${who.they} went to see ${withThe(f.explore)} with ${who.their} own eyes, ${['every dark corner of it', 'all the way to the back', 'as far as it went'][v(3)]}.`;
  if (f.errand) return `So ${who.they} carried ${f.parcel ? withThe(f.parcel) : 'the word'} to ${f.errand}, ${[`as fast as ${who.their} feet would go`, 'without stopping to rest', 'over hill and path'][v(3)]}.`;
  return `So ${who.they} did what was asked, ${['and did it well', 'and did not dawdle', `the best ${who.they} could`][v(3)]}.`;
}

function returnLine(f, who, v) {
  const cap = who.cap;
  const t = f.tasks[0];
  const to = f.ender || f.giver || 'the one who had asked';
  let back;
  if (f.errand && !f.tasks.length) back = ''; // the errand already brought them there
  else if (f.ender && f.ender !== f.giver) back = `${cap(who.they)} ${t?.kind === 'item' ? ['carried them to', 'brought them to', 'took them along to'][v(3)] : ['brought the news to', 'went on to', 'made ' + who.their + ' way to'][v(3)]} ${f.ender}.`;
  else back = `${['When it was done', 'At last', 'Then'][v(3)]} ${who.they} went back to ${to}.`;
  const thanks = f.thanks ? `"${f.thanks}," ${['said', 'smiled'][v(2)]} ${to}.` : `${cap(to)} was ${['glad of it', 'very glad', 'pleased indeed'][v(3)]}.`;
  const coin = f.money ? ` ${cap(who.they)} ${[`was given ${coins(f.money)} for ${who.their} trouble`, `went away with ${coins(f.money)} in ${who.their} pocket`][v(2)]}.` : '';
  return `${back} ${thanks}${coin}`;
}

function closingLine(f, who) {
  if (!f) return 'And so it was.';
  const t = f.tasks[0];
  if (t?.kind === 'kill') return f.zone ? `And ${f.zone} was a little safer after that.` : 'And the roads were a little safer after that.';
  if (t?.kind === 'item') return f.giver && t.count != null ? `And ${f.giver} had all the ${plural(t, 2)} anyone could want.` : 'And nothing was wanting after that.';
  if (t?.kind === 'object') return 'And what was hidden was hidden no longer.';
  if (f.explore) return `And ${withThe(f.explore)} kept no more secrets from ${who.them}.`;
  if (f.errand) return 'And the news reached where it needed to go.';
  return `And ${who.name || 'the traveler'} walked on, a little taller than before.`;
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
