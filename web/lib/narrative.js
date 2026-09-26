// The Journal: short entries in the character's own world, built from nothing
// but the events the addon logged. One entry per play session (2–5 sentences),
// one when a storyline's last chapter is turned in, one when a zone's quests
// are all done. Third person, past tense, the character's name and pronouns
// (from character.info.sex); never anything from outside the world.
//
// journalEntries({ character, sessions, world, codex, storylines, moment })
//   → { entries: [{ id, kind, t, title, text, footage, session }] }, oldest first
// narrativeText(result) → Markdown for export.

import { charKey } from './journey.js';
import { RANKS } from './describe.js';

const LOOT_WINDOW = 20; // loot this soon after a kill came from it
const QUOTE_MAX = 90;
const MAX_WORDS = 28;
const MAX_HIGHLIGHTS = 3;
const ZONE_MIN_QUESTS = 5;
const QUALITY_ADJ = { 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact' };
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export function journalEntries({ character, sessions = [], world = null, codex = null, storylines = [], moment = (s, e) => ({ t: e.t, footage: null }) } = {}) {
  const name = character?.name ?? character?.info?.name ?? 'The hero';
  const mine = sessions.filter((s) => isTheirs(s, character)).sort((a, b) => (a.started || 0) - (b.started || 0));
  const ctx = {
    name, character, world, codex, moment,
    who: pronouns(name, character?.info?.sex ?? character?.sex),
    counters: {}, lastFirst: null, // rotation state and the previous sentence's first word
    questInfo: questInfoFrom(codex),
    firstDay: mine[0]?.started ?? mine[0]?.events?.[0]?.t ?? null,
  };
  const entries = [];
  const open = new Map(); // quests still in the log, carried from one session to the next

  for (const s of mine) {
    const entry = sessionEntry(s, ctx, open);
    if (entry) entries.push(entry);
  }
  for (const line of storylines || []) {
    const entry = storylineEntry(line, mine, ctx);
    if (entry) entries.push(entry);
  }
  for (const entry of zoneEntries(mine, ctx)) entries.push(entry);

  entries.sort((a, b) => a.t - b.t);
  return { title: `The journal of ${name}`, character: name, entries };
}

// The whole journal as Markdown: a heading, then a heading and text per entry.
export function narrativeText(result) {
  const lines = [`# ${result?.title ?? 'Journal'}`, ''];
  for (const en of result?.entries ?? []) lines.push(`## ${en.title}`, '', en.text, '');
  return lines.join('\n').trimEnd() + '\n';
}

function isTheirs(s, character) {
  if (!character) return true;
  const key = charKey(s.char);
  if (character.key) return key === character.key;
  const realm = character.realm ?? character.info?.realm ?? null;
  return s.char?.name === character.name && (realm == null || (s.char?.realm ?? null) === realm);
}

// he/him/his, she/her/her, or the name every time (never "they").
function pronouns(name, sex) {
  const s = sex === 2 ? 'male' : sex === 3 ? 'female' : sex;
  if (s === 'male') return { subj: 'he', obj: 'him', poss: 'his', named: false };
  if (s === 'female') return { subj: 'she', obj: 'her', poss: 'her', named: false };
  return { subj: name, obj: name, poss: possessive(name), named: true };
}

function questInfoFrom(codex) {
  const info = new Map(); // qid or title -> { giver, turnIn, text, title, zone }
  for (const q of codex?.quests ?? []) {
    const v = { giver: q.giver?.name ?? null, turnIn: q.turnInNpc?.name ?? null, text: q.reward ?? null, title: q.title ?? null, zone: q.zone ?? null };
    if (q.qid != null) info.set(q.qid, v);
    if (q.title) info.set(q.title, v);
  }
  return info;
}

// --- one entry per session ---------------------------------------------------

function sessionEntry(s, ctx, open) {
  const events = (s.events || []).filter((e) => e && e.e && Number.isFinite(e.t));
  if (!events.length) return null;
  const first = events.find((e) => e.z) ?? events[0];
  if (!first.z && !first.sz) return null;
  const facts = gather(events, ctx);
  const N = ctx.name;
  const { who } = ctx;

  const opened = new Map(); // quests taken this session (title by qid/title)
  for (const e of events) {
    const key = e.qid ?? e.title;
    if (key == null) continue;
    if (e.e === 'quest_accept') { const title = e.title ?? ctx.questInfo.get(e.qid)?.title ?? null; if (title) { open.set(key, title); opened.set(key, title); } }
    if (e.e === 'quest_turnin' || e.e === 'quest_abandon') { open.delete(key); opened.delete(key); }
  }

  const sentences = [];
  const tod = timeOfDay(s.started || first.t);
  const place = placeOf(first);
  sentences.push(say(ctx, 'open', [
    `${N} began the ${tod} in ${place}.`,
    `${cap(placeIn(first))} was where the ${tod} found ${N}.`,
    `The ${tod} started for ${N} in ${place}.`,
    `${N} was in ${place} when the ${tod} began.`,
  ]));

  const picked = facts.highlights.sort((a, b) => b.score - a.score || a.t - b.t).slice(0, MAX_HIGHLIGHTS).sort((a, b) => a.t - b.t);
  const small = picked.length ? null : facts.minor[0] ?? null;
  for (const h of picked) sentences.push(h.say(ctx));
  if (small) sentences.push(small.say(ctx));

  const left = [...open.values()];
  sentences.push(closing(left, facts, s, ctx));

  const m = ctx.moment(s, first) || {};
  return {
    id: `s-${s.id}`, kind: 'session', t: first.t, session: s.id, footage: m.footage ?? null,
    title: `Day ${dayNumber(s.started || first.t, ctx.firstDay)}, ${first.z || first.sz}`,
    text: sentences.join(' '),
  };
}

// What happened in one session, each thing scored by how much it mattered.
function gather(events, ctx) {
  const N = ctx.name;
  const { who } = ctx;
  const highlights = [];
  const minor = [];
  const kills = new Map(); // name -> { name, n, t, rare, rank }
  const turnins = []; // { t, title, npc }
  let lastKill = null;

  const complete = new Map(); // qid/title -> quest_complete event
  const detail = new Map();
  for (const e of events) {
    const key = e.qid ?? e.title;
    if (e.e === 'quest_complete' && key != null) complete.set(key, e);
    if (e.e === 'quest_detail' && key != null) detail.set(key, e);
  }

  for (const e of events) {
    switch (e.e) {
      case 'kill': {
        if (!e.name) break;
        const k = kills.get(e.name) || { name: e.name, n: 0, t: e.t, rare: isRare(e, ctx), rank: e.rank ?? null };
        k.n++;
        kills.set(e.name, k);
        lastKill = { name: e.name, t: e.t };
        break;
      }
      case 'quest_turnin': {
        const key = e.qid ?? e.title;
        const title = e.title ?? ctx.questInfo.get(e.qid)?.title ?? null;
        if (!title) break;
        turnins.push({ t: e.t, title, npc: complete.get(key)?.npc ?? ctx.questInfo.get(key)?.turnIn ?? null });
        break;
      }
      case 'death': {
        const killer = e.killer ?? null;
        const near = e.sz ? ` at ${e.sz}` : '';
        highlights.push({ t: e.t, score: 100, say: (c) => say(c, 'death', killer ? [
          `${killer} killed ${who.obj}${near}, a hard lesson.`,
          `Then ${killer} got the better of ${who.obj}${near}.`,
          `${cap(who.subj)} fell to ${killer}${near}.`,
          `${cap(near ? e.sz : 'The road')} was where ${killer} killed ${who.obj}.`,
        ] : [
          `${cap(who.subj)} died${near}, a hard lesson.`,
          `Death found ${who.obj}${near}.`,
        ]) });
        break;
      }
      case 'level':
        if (e.level == null) break;
        highlights.push({ t: e.t, score: 70, say: (c) => say(c, 'level', [
          `${cap(who.subj)} reached level ${e.level} along the way.`,
          `That was enough for level ${e.level}.`,
          `By the time ${who.subj} was done, ${who.subj} had reached level ${e.level}.`,
          `Level ${e.level} came somewhere in there.`,
        ]) });
        break;
      case 'loot': {
        const q = e.q ?? ctx.world?.byItem?.get(e.id)?.quality ?? null;
        if (!e.name || !QUALITY_ADJ[q] || (e.src && e.src !== 'loot')) break;
        const item = `${article(QUALITY_ADJ[q])} ${QUALITY_ADJ[q]} ${e.name}`;
        const from = lastKill && e.t - lastKill.t <= LOOT_WINDOW ? lastKill.name : null;
        highlights.push({ t: e.t, score: 60 + q * 2, say: (c) => say(c, 'find', from ? [
          `${article(from, true)} ${from} left ${item} behind.`,
          `${cap(who.subj)} came away from ${article(from)} ${from} with ${item}.`,
          `Out of ${article(from)} ${from} came ${item}.`,
        ] : [
          `${cap(who.subj)} came away with ${item}.`,
          `${cap(item)} turned up along the way.`,
        ]) });
        break;
      }
      case 'equip':
        if (!e.id || !e.name) break;
        highlights.push({ t: e.t, score: 50, say: (c) => say(c, 'equip', e.was ? [
          `${cap(who.poss)} ${e.was} gave way to ${article(e.name)} ${e.name}.`,
          `${cap(who.subj)} swapped the ${e.was} for ${article(e.name)} ${e.name}.`,
        ] : [
          `${cap(who.subj)} strapped on ${article(e.name)} ${e.name}.`,
          `${article(e.name, true)} ${e.name} went into ${who.poss} kit.`,
          `Later ${who.subj} put on ${article(e.name)} ${e.name}.`,
        ]) });
        break;
      case 'explore':
        if (!e.area) break;
        highlights.push({ t: e.t, score: 45, say: (c) => say(c, 'explore', [
          `${e.area} was new ground.`,
          `${cap(who.subj)} set foot in ${e.area} for the first time.`,
          `By the time ${who.subj} reached ${e.area}, it was somewhere ${who.subj} had never been.`,
          `Later the road brought ${who.obj} to ${e.area}.`,
        ]) });
        break;
      case 'npc': {
        if (!e.name || !isRare(e, ctx) || highlights.some((h) => h.rare === e.name)) break;
        const desc = rareDesc(e, ctx);
        highlights.push({ t: e.t, score: 40, rare: e.name, say: (c) => say(c, 'rare', [
          `${e.name}, ${desc}, was lurking${e.sz ? ` in ${e.sz}` : ' nearby'}.`,
          `${cap(who.subj)} caught sight of ${e.name}, ${desc}.`,
          `Somewhere${e.sz ? ` in ${e.sz}` : ' close by'} ${e.name} was about, ${desc}.`,
        ]) });
        break;
      }
      case 'fight': {
        if (!e.close || e.kills) break; // a close call that ended in a kill is told by the kills
        const enemy = (e.enemies || []).map((x) => x.name).find(Boolean);
        if (!enemy) break;
        highlights.push({ t: e.t, score: 35, say: (c) => say(c, 'close', [
          `${article(enemy, true)} ${enemy} came close to finishing ${who.obj}.`,
          `It was a near thing with ${article(enemy)} ${enemy}.`,
        ]) });
        break;
      }
      case 'mark':
        if (!e.note) break;
        highlights.push({ t: e.t, score: 20, say: (c) => say(c, 'mark', [
          `${cap(who.subj)} noticed ${lower(cleanQuote(e.note, c))}.`,
          `One thing stayed with ${who.obj}: ${lower(cleanQuote(e.note, c))}.`,
        ]) });
        break;
      case 'vendor':
        if (!e.npc) break;
        minor.push({ t: e.t, say: (c) => say(c, 'vendor', [`${cap(who.subj)} stopped by ${possessive(e.npc)} wares.`, `${e.npc} had ${who.obj} as a customer.`]) });
        break;
      case 'trainer':
        if (!e.npc) break;
        minor.push({ t: e.t, say: (c) => say(c, 'trainer', [`${cap(who.subj)} dropped in on ${e.npc} for a lesson.`, `${e.npc} had a lesson for ${who.obj}.`]) });
        break;
      case 'flight':
        if (!e.to) break;
        minor.push({ t: e.t, say: (c) => say(c, 'flight', [`${cap(who.subj)} took a flight to ${e.to}.`, `A gryphon carried ${who.obj} to ${e.to}.`]) });
        break;
      case 'money':
        if (!Number.isFinite(e.delta) || e.delta <= 0) break;
        minor.push({ t: e.t, say: (c) => say(c, 'money', [`${cap(who.subj)} came away with ${coin(e.delta)}.`, `${cap(coin(e.delta))} found its way into ${who.poss} purse.`]) });
        break;
      default:
        break; // stats, bags, talents, chat, screenshots, xp and the rest are not for the journal
    }
  }

  if (turnins.length === 1) {
    const [{ t, title, npc }] = turnins;
    highlights.push({ t, score: 80, say: (c) => say(c, 'turnin', npc ? [
      `${cap(who.subj)} handed ${title} in to ${npc}.`,
      `${npc} took ${title} off ${who.poss} hands.`,
      `${title} was done, and ${npc} said as much.`,
      `Later ${who.subj} brought ${title} back to ${npc}.`,
    ] : [
      `${cap(who.subj)} saw ${title} through.`,
      `${title} was done by the end of it.`,
    ]) });
  } else if (turnins.length > 1) {
    const t = turnins.at(-1).t;
    const n = SMALL[turnins.length] ?? String(turnins.length);
    const names = listOf(turnins.map((q) => q.title), 3);
    const npcs = [...new Set(turnins.map((q) => q.npc).filter(Boolean))];
    const to = npcs.length === 1 ? ` to ${npcs[0]}` : '';
    highlights.push({ t, score: 85, say: (c) => say(c, 'turnins', [
      `${cap(n)} quests came off ${who.poss} hands${to}: ${names}.`,
      `${cap(who.subj)} handed in ${n} quests${to}, ${names} among them.`,
      `By the end ${names} were done${to ? `, all${to}` : ''}.`,
    ]) });
  }
  const hunted = [...kills.values()].sort((a, b) => b.n - a.n);
  if (hunted.length) {
    const t = hunted[0].t;
    const total = hunted.reduce((n, k) => n + k.n, 0);
    highlights.push({ t, score: 30 + Math.min(total, 20), say: (c) => say(c, 'kills', [
      `${cap(who.subj)} felled ${killList(hunted)}.`,
      `${cap(killList(hunted))} fell to ${who.obj}.`,
      `Along the way ${who.subj} put down ${killList(hunted)}.`,
    ]) });
  }
  const rares = highlights.filter((h) => h.rare).map((h) => h.rare);
  return { highlights, minor, hunted, rares, bind: events.findLast?.((e) => e.e === 'bind' && e.where)?.where ?? null, died: events.some((e) => e.e === 'death') };
}

// The last line looks ahead from the quests still in the log.
function closing(left, facts, s, ctx) {
  const { who } = ctx;
  if (left.length) {
    const what = left.length === 1 ? left[0] : left.length === 2 ? `${left[0]} and ${left[1]}` : `${left[0]}, ${left[1]} and ${SMALL[left.length - 2] ?? left.length - 2} more`;
    const many = left.length > 1;
    return say(ctx, 'close', [
      `${what} could wait for morning.`,
      `That left ${what} still to see to.`,
      `${cap(who.subj)} still had ${what} ahead of ${who.obj}.`,
      `${what} ${many ? 'were' : 'was'} still waiting.`,
    ]);
  }
  const rare = facts.rares.find((r) => !facts.hunted.some((k) => k.name === r));
  if (rare) return say(ctx, 'close', [`${rare} was still out there somewhere.`, `Somewhere out there, ${rare} was still waiting.`]);
  if (facts.bind) return say(ctx, 'close', [`${facts.bind} was home for now.`, `For now, home was ${facts.bind}.`]);
  const last = [...(s.events || [])].reverse().find((e) => e.z || e.sz);
  const place = last ? placeOf(last) : null;
  if (place) return say(ctx, 'close', [`The road went on from ${place}.`, `${cap(place)} was where the ${timeOfDay(last.t)} ended.`]);
  return say(ctx, 'close', [`Nothing was pressing.`, `There was nothing that could not wait.`]);
}

// --- one entry per finished storyline ------------------------------------------

function storylineEntry(line, sessions, ctx) {
  if (!line || !(line.total > 0) || line.done !== line.total) return null;
  const quests = (line.quests || []).map((x) => x.q).filter(Boolean);
  if (!quests.length) return null;
  const ids = new Set(quests.map((q) => q.id));
  const titles = new Set(quests.map((q) => q.n).filter(Boolean));
  const mine = (e) => (e.qid != null && ids.has(e.qid)) || (e.qid == null && e.title && titles.has(e.title));
  const all = [];
  for (const s of sessions) for (const e of s.events || []) if (e && e.e && Number.isFinite(e.t)) all.push({ s, e });
  all.sort((a, b) => a.e.t - b.e.t);
  const accepts = all.filter(({ e }) => e.e === 'quest_accept' && mine(e));
  const turnins = all.filter(({ e }) => e.e === 'quest_turnin' && mine(e));
  const finale = quests[quests.length - 1];
  const last = turnins.findLast?.(({ e }) => e.qid === finale.id || (e.qid == null && e.title === finale.n)) ?? turnins.at(-1);
  if (!last) return null;
  const first = accepts[0] ?? turnins[0];
  const from = first.e.t;
  const until = last.e.t;
  const N = ctx.name;
  const { who } = ctx;
  const q0 = quests[0];
  const giver = ctx.questInfo.get(q0.id)?.giver ?? ctx.questInfo.get(q0.n)?.giver ?? all.find(({ e }) => e.e === 'quest_detail' && (e.qid === q0.id || e.title === q0.n) && e.npc)?.e.npc ?? null;
  const start = placeOf(first.e);
  const zones = [];
  for (const z of [first.e.z, ...turnins.map(({ e }) => e.z), ...(line.zones || [])]) if (z && !zones.includes(z)) zones.push(z);
  const deaths = all.filter(({ e }) => e.e === 'death' && e.t >= from && e.t <= until).map(({ e }) => e.killer).filter(Boolean);
  const nDeaths = all.filter(({ e }) => e.e === 'death' && e.t >= from && e.t <= until).length;
  const taker = all.find(({ e }) => e.e === 'quest_complete' && (e.qid === finale.id || e.title === finale.n) && e.t <= until && until - e.t <= 600)?.e
    ?? null;
  const npc = taker?.npc ?? ctx.questInfo.get(finale.id)?.turnIn ?? ctx.questInfo.get(finale.n)?.turnIn ?? null;
  const reward = taker?.text ?? ctx.questInfo.get(finale.id)?.text ?? ctx.questInfo.get(finale.n)?.text ?? null;

  const sentences = [];
  sentences.push(say(ctx, 'sbegin', giver ? [
    `${line.name} began for ${N} in ${start}, with ${giver}.`,
    `${giver}, in ${start}, was where ${line.name} started for ${N}.`,
    `${N} first took up ${line.name} from ${giver} in ${start}.`,
  ] : [
    `${line.name} began for ${N} in ${start}.`,
    `${N} first took up ${line.name} in ${start}.`,
  ]));
  if (zones.length > 1) sentences.push(say(ctx, 'sled', [`From there it led through ${listOf(zones.slice(1))}.`, `The trail ran on to ${listOf(zones.slice(1))}.`]));
  else if (quests.length > 1) sentences.push(say(ctx, 'sled', [`${cap(SMALL[quests.length] ?? String(quests.length))} chapters kept ${who.obj} in ${zones[0] ?? start}.`, `All ${quests.length} chapters stayed within ${zones[0] ?? start}.`]));
  if (nDeaths) {
    const by = deaths.length ? `, to ${listOf([...new Set(deaths)])}` : '';
    sentences.push(say(ctx, 'scost', [
      `It cost ${who.obj} ${nDeaths === 1 ? 'one death' : `${SMALL[nDeaths] ?? nDeaths} deaths`}${by}.`,
      `${cap(who.subj)} died ${nDeaths === 1 ? 'once' : `${SMALL[nDeaths] ?? nDeaths} times`} along the way${by}.`,
    ]));
  }
  sentences.push(say(ctx, 'send', npc ? [
    `It ended with ${finale.n}, handed in to ${npc}.`,
    `${npc} took the last chapter, ${finale.n}, off ${who.poss} hands.`,
    `The last of it was ${finale.n}, and ${npc} closed the matter.`,
  ] : [
    `It ended with ${finale.n}.`,
    `${finale.n} was the last of it.`,
  ]));
  if (reward) {
    const quote = cleanQuote(reward, ctx);
    if (quote && words(quote) <= MAX_WORDS - 4) sentences.push(say(ctx, 'squote', [`"${trimDot(quote)}," ${npc ? `said ${npc}` : 'came the word'}.`, `${npc ? `${npc}'s` : 'The'} parting words: "${quote}"`]));
  }
  const m = ctx.moment(last.s, last.e) || {};
  return { id: `story-${line.id ?? slug(line.name)}`, kind: 'storyline', t: until, session: last.s.id, footage: m.footage ?? null, title: `The end of ${line.name}`, text: sentences.join(' ') };
}

// --- one entry per zone with nothing left in it --------------------------------

function zoneEntries(sessions, ctx) {
  const zones = new Map(); // zone -> { found: Map, done: Map, areas: Set, deaths: [], kills: Map, rares: Set, last }
  for (const s of sessions) {
    for (const e of s.events || []) {
      if (!e || !e.z || !Number.isFinite(e.t)) continue;
      const z = zones.get(e.z) || { name: e.z, found: new Map(), done: new Map(), areas: new Set(), deaths: [], kills: new Map(), rares: new Set(), last: null };
      zones.set(e.z, z);
      const key = e.qid ?? e.title;
      if (['quest_detail', 'quest_accept', 'quest_turnin'].includes(e.e) && key != null) z.found.set(key, e.title ?? key);
      if (e.e === 'quest_turnin' && key != null) { z.done.set(key, e.title ?? key); z.last = { s, e }; }
      if (e.e === 'explore' && e.area) z.areas.add(e.area);
      if (e.e === 'death') z.deaths.push(e.killer ?? null);
      if (e.e === 'kill' && e.name) z.kills.set(e.name, (z.kills.get(e.name) || 0) + 1);
      if (e.e === 'npc' && e.name && isRare(e, ctx)) z.rares.add(e.name);
    }
  }
  const out = [];
  for (const z of zones.values()) {
    if (z.done.size < ZONE_MIN_QUESTS || !z.last) continue;
    if ([...z.found.keys()].some((k) => !z.done.has(k))) continue;
    const { who } = ctx;
    const n = SMALL[z.done.size] ?? String(z.done.size);
    const sentences = [say(ctx, 'zdone', [
      `${z.name} had nothing left to ask of ${who.obj}: ${n} quests, all seen through.`,
      `By the time ${who.subj} was done with ${z.name}, ${n} quests stood finished.`,
      `${cap(n)} quests, and ${z.name} was done with.`,
    ])];
    if (z.areas.size) sentences.push(say(ctx, 'zareas', [`${cap(who.subj)} had walked ${listOf([...z.areas], 3)}.`, `${cap(listOf([...z.areas], 3))} were ground ${who.subj} had covered.`]));
    const top = [...z.kills.entries()].sort((a, b) => b[1] - a[1])[0];
    if (z.deaths.length) {
      const killers = [...new Set(z.deaths.filter(Boolean))];
      sentences.push(say(ctx, 'zcost', [`The place cost ${who.obj} ${z.deaths.length === 1 ? 'one death' : `${SMALL[z.deaths.length] ?? z.deaths.length} deaths`}${killers.length ? `, to ${listOf(killers, 2)}` : ''}.`, `${killers.length ? listOf(killers, 2) : 'Something there'} had killed ${who.obj} ${z.deaths.length === 1 ? 'once' : `${SMALL[z.deaths.length] ?? z.deaths.length} times`}.`]));
    } else if (top) {
      sentences.push(say(ctx, 'zkills', [`${cap(countOf(top[1], top[0]))} had fallen to ${who.obj} there, more than anything else.`, `Mostly it had been ${countOf(top[1], top[0])}.`]));
    } else if (z.rares.size) {
      sentences.push(say(ctx, 'zrare', [`${listOf([...z.rares], 2)} had crossed ${who.poss} path there.`]));
    }
    const m = ctx.moment(z.last.s, z.last.e) || {};
    out.push({ id: `zone-${slug(z.name)}`, kind: 'zone', t: z.last.e.t, session: z.last.s.id, footage: m.footage ?? null, title: `${z.name}, finished`, text: sentences.join(' ') });
  }
  return out;
}

// --- sentences ------------------------------------------------------------------

// Picks the next shape from the pool, never opening the way the previous
// sentence did (across entries too), and never longer than MAX_WORDS.
function say(ctx, key, pool) {
  const n = ctx.counters[key] = (ctx.counters[key] ?? -1) + 1;
  const fits = (s) => words(s) <= MAX_WORDS;
  let choice = null;
  for (let k = 0; k < pool.length; k++) {
    const s = pool[(n + k) % pool.length];
    if (firstWord(s) !== ctx.lastFirst && fits(s)) { choice = s; break; }
  }
  if (!choice) choice = pool.find((s) => fits(s)) ?? pool.slice().sort((a, b) => words(a) - words(b))[0];
  ctx.lastFirst = firstWord(choice);
  return choice;
}

function words(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

function firstWord(s) {
  return String(s).trim().split(/\s+/)[0]?.replace(/[^\w']/g, '').toLowerCase() ?? '';
}

function killList(hunted) {
  const parts = hunted.slice(0, 2).map((k) => (k.rare ? `${k.name}, the ${RANKS[k.rank] ?? 'rare'} one` : countOf(k.n, k.name)));
  if (hunted.length > 2) parts.push(`${SMALL[hunted.length - 2] ?? hunted.length - 2} more kinds of creature`);
  return listOf(parts);
}

function countOf(n, name) {
  return n > 1 ? `${SMALL[n] ?? n} ${name}` : `${article(name)} ${name}`;
}

function listOf(parts, max = Infinity) {
  const p = parts.length > max ? [...parts.slice(0, max - 1), `${SMALL[parts.length - max + 1] ?? parts.length - max + 1} more`] : parts;
  if (p.length <= 1) return p[0] ?? '';
  return `${p.slice(0, -1).join(', ')} and ${p.at(-1)}`;
}

function article(word, capital = false) {
  const a = /^[aeiou]/i.test(String(word)) ? 'an' : 'a';
  return capital ? cap(a) : a;
}

function possessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function cap(s) {
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lower(s) {
  s = String(s);
  return /^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function trimDot(s) {
  return String(s).replace(/\.$/, '');
}

function placeOf(e) {
  return e.sz && e.sz !== e.z ? `${e.sz}, ${e.z}` : (e.z || e.sz || 'the world');
}

function placeIn(e) {
  return e.sz && e.sz !== e.z ? `${e.sz} in ${e.z}` : (e.z || e.sz || 'the world');
}

// Money as coin, never as a number of copper.
function coin(copper) {
  const c = Math.round(Math.abs(copper ?? 0));
  if (c >= 10000) return `${SMALL[Math.floor(c / 10000)] ?? Math.floor(c / 10000)} gold`;
  if (c >= 1000) return 'a good handful of silver';
  if (c >= 100) return 'a few silver';
  return 'a little copper';
}

function timeOfDay(t) {
  const h = new Date(t * 1000).getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function dayNumber(t, firstDay) {
  if (!Number.isFinite(firstDay)) return 1;
  const day = (x) => Math.floor(new Date(x * 1000).getTime() / 86400000);
  return day(t) - day(firstDay) + 1;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function isRare(e, ctx) {
  if (e.rare || e.rank === 'rare' || e.rank === 'rareelite') return true;
  const key = e.npcId ? `n${e.npcId}` : `s${e.name}`;
  return Boolean(ctx.world?.byNpc?.get(key)?.rare);
}

function rareDesc(e, ctx) {
  const n = ctx.world?.byNpc?.get(e.npcId ? `n${e.npcId}` : `s${e.name}`);
  const rank = RANKS[e.rank] ?? (n?.ranks?.map((r) => RANKS[r]).find((r) => r && /rare/.test(r))) ?? 'rare';
  const what = (e.family ?? n?.family ?? e.ctype ?? n?.ctype ?? '').toLowerCase();
  return `${article(rank)} ${rank}${what ? ` ${what}` : ''}`;
}

// NPC text with the game's tokens filled in, whitespace collapsed, trimmed.
function cleanQuote(text, ctx) {
  const info = ctx.character?.info ?? ctx.character ?? {};
  const female = (info.sex ?? ctx.character?.sex) === 'female' || info.sex === 3;
  let t = String(text)
    .replace(/\$[Bb]/g, ' ')
    .replace(/\$[Nn]/g, ctx.name)
    .replace(/\$[Cc]/g, String(info.class ?? 'friend').toLowerCase())
    .replace(/\$[Rr]/g, String(info.race ?? 'traveller').toLowerCase())
    .replace(/\$[Gg]([^:;]*):([^;]*);/g, (_, m, f) => (female ? f : m))
    .replace(/!/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > QUOTE_MAX) t = `${t.slice(0, QUOTE_MAX - 1).replace(/\s+\S*$/, '')}…`;
  return t;
}
