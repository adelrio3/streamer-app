// The Journal: one entry per outing, in the character's own words, built
// from nothing but the events the addon logged. First person, past tense,
// never a title from a list: what was done is retold from the errand
// itself ("For Gornek I thinned the boars"), never as "I completed X".
// The length follows the outing: a quiet one gets a paragraph, an eventful
// one up to three. The tales on the Lore page are the third-person side.
//
// journalEntries({ character, sessions, world, codex, db, moment })
//   → { title, character, entries: [{ id, kind: 'session', t, title, text, paragraphs, footage, session }] }, oldest first
// narrativeText(result) → Markdown for export.

import { charKey } from './journey.js';
import { RANKS } from './describe.js';
import { objectives as dbObjectives } from './questdb.js';

const LOOT_WINDOW = 20; // loot this soon after a kill came from it
const QUOTE_MAX = 90;
const MAX_WORDS = 28;
const QUALITY_ADJ = { 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact' };
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export function journalEntries({ character, sessions = [], world = null, codex = null, db = null, moment = (s, e) => ({ t: e.t, footage: null }) } = {}) {
  const name = character?.name ?? character?.info?.name ?? 'The hero';
  const mine = sessions.filter((s) => isTheirs(s, character)).sort((a, b) => (a.started || 0) - (b.started || 0));
  const ctx = {
    name, character, world, codex, db, moment,
    counters: {}, lastFirst: null, // rotation state and the previous sentence's first word
    questInfo: questInfoFrom(codex),
    firstDay: mine[0]?.started ?? mine[0]?.events?.[0]?.t ?? null,
  };
  const entries = [];
  const open = new Map(); // quests still in the log, carried from one outing to the next
  for (const s of mine) {
    const entry = sessionEntry(s, ctx, open);
    if (entry) entries.push(entry);
  }
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

// What the Codex knows about each quest: who gave it, who took it back,
// the errand as read and what they said at the end.
function questInfoFrom(codex) {
  const info = new Map(); // qid or title -> { giver, turnIn, text, reward, objectives, title, zone }
  for (const q of codex?.quests ?? []) {
    const v = { giver: q.giver?.name ?? null, turnIn: q.turnInNpc?.name ?? null, text: q.text ?? null, reward: q.reward ?? null, objectives: q.objectives ?? null, title: q.title ?? null, zone: q.zone ?? null };
    if (q.qid != null) info.set(q.qid, v);
    if (q.title) info.set(q.title, v);
  }
  return info;
}

// --- one entry per outing -------------------------------------------------------

function sessionEntry(s, ctx, open) {
  const events = (s.events || []).filter((e) => e && e.e && Number.isFinite(e.t));
  if (!events.length) return null;
  const first = events.find((e) => e.z) ?? events[0];
  if (!first.z && !first.sz) return null;
  const facts = gather(events, ctx);

  // Quests carried over: what was taken and not yet handed in, by who gave it.
  for (const e of events) {
    const key = e.qid ?? e.title;
    if (key == null) continue;
    if (e.e === 'quest_accept') open.set(key, { title: e.title ?? null, giver: facts.givers.get(key) ?? ctx.questInfo.get(key)?.giver ?? null });
    if (e.e === 'quest_turnin' || e.e === 'quest_abandon') open.delete(key);
  }

  const n = facts.deeds.length;
  const eventful = facts.highlights.length;
  const tod = timeOfDay(s.started || first.t);
  const place = placeOf(first);
  const paragraphs = [];

  // 1. Where it began, and what got done.
  const opening = n || eventful ? say(ctx, 'open', [
    `I began the ${tod} in ${place}.`,
    `${cap(placeIn(first))} was where the ${tod} found me.`,
    `The ${tod} started in ${place}.`,
    `I was in ${place} when the ${tod} began.`,
  ]) : say(ctx, 'quiet', [
    `Not much came of the ${tod} in ${place}.`,
    `A quiet ${tod} in ${place}.`,
    `I spent the ${tod} around ${place} and little came of it.`,
  ]);
  const deedLines = deedSentences(facts, ctx, n >= 6 ? 5 : n >= 3 ? 4 : 2);
  paragraphs.push([opening, ...deedLines]);

  // 2. What else happened, when there was enough to say.
  const picked = facts.highlights.sort((a, b) => b.score - a.score || a.t - b.t).slice(0, n >= 6 ? 4 : n >= 3 ? 3 : n ? 1 : 2).sort((a, b) => a.t - b.t);
  const rest = picked.map((h) => h.say(ctx));
  if (!n && !rest.length && facts.minor[0]) rest.push(facts.minor[0].say(ctx));
  if (n >= 3 && rest.length) paragraphs.push(rest);
  else paragraphs[0].push(...rest);

  // 3. Where it left off: an eventful outing closes on its own.
  const close = closing([...open.values()], facts, s, ctx);
  if (n >= 6) paragraphs.push([close]);
  else paragraphs[0].push(close);

  const m = ctx.moment(s, first) || {};
  const paras = paragraphs.map((p) => p.filter(Boolean).join(' ')).filter(Boolean);
  return {
    id: `s-${s.id}`, kind: 'session', t: first.t, session: s.id, footage: m.footage ?? null,
    title: `Day ${dayNumber(s.started || first.t, ctx.firstDay)}, ${first.z || first.sz}`,
    paragraphs: paras,
    text: paras.join('\n\n'),
  };
}

// What was done, grouped by who it was done for: "For Gornek I thinned the
// boars and brought back ten scorpid tails."
function deedSentences(facts, ctx, max) {
  const groups = new Map(); // giver -> deeds
  for (const d of facts.deeds) {
    const k = d.for || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].t - b[1][0].t);
  const out = [];
  let shown = 0;
  for (const [giver, deeds] of ordered) {
    if (out.length >= max) break;
    const past = listOf(deeds.map((d) => d.past), 3);
    const base = listOf(deeds.map((d) => d.base), 3);
    shown += deeds.length;
    out.push(giver ? say(ctx, 'deed', [
      `For ${giver} I ${past}.`,
      `${giver} sent me to ${base}.`,
      `I ${past} for ${giver}.`,
      `${giver} had work for me: I ${past}.`,
    ]) : say(ctx, 'deed0', [`I ${past}.`, `Along the way I ${past}.`]));
  }
  const left = facts.deeds.length - shown;
  if (left > 0) out.push(say(ctx, 'more', [`There were ${SMALL[left] ?? left} smaller errands besides.`, `${cap(SMALL[left] ?? String(left))} lesser errands filled the gaps.`]));
  return out;
}

// One quest handed in, as a deed: from the errand text as read (the Codex),
// else from the database, else from who took it back.
function deedOf(key, e, facts, ctx) {
  const info = ctx.questInfo.get(key) ?? null;
  const giver = facts.givers.get(key) ?? info?.giver ?? null;
  const turnIn = facts.enders.get(key) ?? info?.turnIn ?? null;
  const q = ctx.db && e.qid != null ? ctx.db.quests?.get?.(e.qid) ?? null : null;
  const text = info?.objectives || q?.o || '';
  let d = parseObjective(text, giver, turnIn);
  if (!d && q && ctx.db) {
    const obs = dbObjectives(ctx.db, q).filter((o) => o.kind !== 'reputation');
    const kills = obs.filter((o) => o.kind === 'kill');
    const items = obs.filter((o) => o.kind === 'item');
    if (kills.length) d = { past: `hunted ${plural(kills[0].name)}`, base: `hunt ${plural(kills[0].name)}` };
    else if (items.length) d = { past: `gathered ${plural(items[0].name)}`, base: `gather ${plural(items[0].name)}` };
    else if (obs.length) d = { past: `looked into ${withThe(obs[0].name)}`, base: `look into ${withThe(obs[0].name)}` };
  }
  if (!d) d = turnIn && turnIn !== giver ? { past: `carried word to ${turnIn}`, base: `carry word to ${turnIn}` } : { past: 'saw to a small matter', base: 'see to a small matter' };
  return { ...d, for: giver ?? turnIn ?? null, t: e.t };
}

// The errand as read, turned into what I did. Returns { past, base } or null.
function parseObjective(text, giver, turnIn) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.split(/(?<=[.!?])\s+/)[0] || t; // the first sentence is the errand
  t = t.replace(/,?\s*(?:and\s+)?(?:then\s+)?(?:return|report|bring (?:them|it) back|go back)\s+(?:to|with)\s+.*$/i, '').replace(/[.!]$/, '').trim();
  const cut = (s) => String(s).replace(/\s+(?:in|at|outside|inside|near|from|of the|located|found|who|which|that|so|and then|then)\b.*$/i, '').replace(/[.,;:]$/, '').trim();
  let m;
  if ((m = t.match(/^(?:Kill|Slay|Destroy|Defeat|Hunt|Cull|Thin|Put down)\s+(?:(\d+)\s+)?(.+)$/i))) {
    const n = m[1] ? Number(m[1]) : null;
    const what = cut(m[2]);
    if (!what || what.split(/\s+/).length > 6) return null;
    const verb = n && n >= 8 ? ['thinned', 'thin'] : n ? ['hunted', 'hunt'] : ['hunted down', 'hunt down'];
    const obj = n ? `${SMALL[n] ?? n} ${what}` : what;
    return { past: `${verb[0]} ${obj}`, base: `${verb[1]} ${obj}` };
  }
  if ((m = t.match(/^(?:Bring|Collect|Gather|Obtain|Retrieve|Recover|Find|Get)\s+(?:([A-Z][\w']*(?:\s+[A-Z][\w']*)?)\s+)?(\d+)\s+(.+)$/))) {
    const to = m[1] && !/^(?:the|some|a|an)$/i.test(m[1]) ? m[1] : null;
    const what = cut(m[3]).replace(/\s+for\s+.*$/i, '');
    const obj = `${SMALL[Number(m[2])] ?? m[2]} ${what}`;
    const who = to ?? giver;
    if (who && sameOne(who, giver)) return { past: `brought back ${obj}`, base: `bring back ${obj}` };
    return who ? { past: `brought ${who} ${obj}`, base: `bring ${who} ${obj}` } : { past: `gathered ${obj}`, base: `gather ${obj}` };
  }
  if ((m = t.match(/^(?:Bring|Collect|Gather|Obtain|Retrieve|Recover)\s+(.+?)(?:\s+(?:for|to)\s+([A-Z][^,.]*))?$/))) {
    const what = cut(m[1]);
    if (what && what.split(/\s+/).length <= 5) {
      const who = m[2] ? cut(m[2]) : giver;
      if (who && sameOne(who, giver)) return { past: `brought back ${withThe(what)}`, base: `bring back ${withThe(what)}` };
      return who ? { past: `brought ${withThe(what)} to ${who}`, base: `bring ${withThe(what)} to ${who}` } : { past: `recovered ${withThe(what)}`, base: `recover ${withThe(what)}` };
    }
  }
  if ((m = t.match(/^(?:Read .+? and\s+)?(?:Speak|Talk)\s+(?:to|with)\s+(.+)$/i)) || (m = t.match(/^(?:Report|Return|Go)\s+to\s+(.+)$/i))) {
    const who = cut(m[1]);
    if (who && who.split(/\s+/).length <= 4) return { past: `carried word to ${who}`, base: `carry word to ${who}` };
  }
  if ((m = t.match(/^(?:Take|Deliver|Carry)\s+(.+?)\s+to\s+(.+)$/i))) {
    const what = cut(m[1]);
    const who = cut(m[2]);
    if (what.split(/\s+/).length <= 5 && who.split(/\s+/).length <= 4) return sameOne(who, giver) ? { past: `brought back ${withThe(what)}`, base: `bring back ${withThe(what)}` } : { past: `took ${withThe(what)} to ${who}`, base: `take ${withThe(what)} to ${who}` };
  }
  if ((m = t.match(/^(?:Explore|Scout|Investigate|Search|Locate|Look for|Find)\s+(.+)$/i))) {
    const where = cut(m[1]);
    if (where && where.split(/\s+/).length <= 5) return { past: `scouted ${withThe(where)}`, base: `scout ${withThe(where)}` };
  }
  return null;
}

// "Thazz'ril" and "Foreman Thazz'ril" are the same person.
function sameOne(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLowerCase(); const y = String(b).toLowerCase();
  return x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`);
}

// What happened in one outing: the deeds, and everything else scored by
// how much it mattered.
function gather(events, ctx) {
  const highlights = [];
  const minor = [];
  const kills = new Map(); // name -> { name, n, t, rare, rank }
  const givers = new Map(); // quest key -> who gave it (as met)
  const enders = new Map(); // quest key -> who took it back
  let lastKill = null;
  for (const e of events) {
    const key = e.qid ?? e.title;
    if (key == null) continue;
    if (e.e === 'quest_detail' && e.npc) givers.set(key, e.npc);
    if (e.e === 'quest_complete' && e.npc) enders.set(key, e.npc);
  }
  const facts = { highlights, minor, deeds: [], givers, enders, rares: [], bind: null, died: false, hunted: [] };

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
        if (key == null) break;
        facts.deeds.push(deedOf(key, e, facts, ctx));
        break;
      }
      case 'death': {
        const killer = e.killer ?? null;
        const near = e.sz ? ` at ${e.sz}` : '';
        highlights.push({ t: e.t, score: 100, say: (c) => say(c, 'death', killer ? [
          `${killer} killed me${near}, a hard lesson.`,
          `Then ${killer} got the better of me${near}.`,
          `I fell to ${killer}${near}.`,
          `${cap(near ? e.sz : 'The road')} was where ${killer} killed me.`,
        ] : [
          `I died${near}, a hard lesson.`,
          `Death found me${near}.`,
        ]) });
        break;
      }
      case 'level':
        if (e.level == null) break;
        highlights.push({ t: e.t, score: 70, say: (c) => say(c, 'level', [
          `I reached level ${e.level} along the way.`,
          `That was enough for level ${e.level}.`,
          `By the time I was done I had reached level ${e.level}.`,
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
          `I came away from ${article(from)} ${from} with ${item}.`,
          `Out of ${article(from)} ${from} came ${item}.`,
        ] : [
          `I came away with ${item}.`,
          `${cap(item)} turned up along the way.`,
        ]) });
        break;
      }
      case 'equip':
        if (!e.id || !e.name) break;
        highlights.push({ t: e.t, score: 40, say: (c) => say(c, 'equip', e.was ? [
          `My ${e.was} gave way to ${article(e.name)} ${e.name}.`,
          `I swapped the ${e.was} for ${article(e.name)} ${e.name}.`,
        ] : [
          `I strapped on ${article(e.name)} ${e.name}.`,
          `${article(e.name, true)} ${e.name} went into my kit.`,
        ]) });
        break;
      case 'explore':
        if (!e.area) break;
        highlights.push({ t: e.t, score: 45, say: (c) => say(c, 'explore', [
          `${e.area} was new ground.`,
          `I set foot in ${e.area} for the first time.`,
          `The road brought me to ${e.area}, somewhere I had never been.`,
        ]) });
        break;
      case 'npc': {
        if (!e.name || !isRare(e, ctx) || highlights.some((h) => h.rare === e.name)) break;
        const desc = rareDesc(e, ctx);
        facts.rares.push(e.name);
        highlights.push({ t: e.t, score: 50, rare: e.name, say: (c) => say(c, 'rare', [
          `${e.name}, ${desc}, was lurking${e.sz ? ` in ${e.sz}` : ' nearby'}.`,
          `I caught sight of ${e.name}, ${desc}.`,
          `Somewhere${e.sz ? ` in ${e.sz}` : ' close by'} ${e.name} was about, ${desc}.`,
        ]) });
        break;
      }
      case 'fight': {
        if (!e.close || e.kills) break;
        const enemy = (e.enemies || []).map((x) => x.name).find(Boolean);
        if (!enemy) break;
        highlights.push({ t: e.t, score: 35, say: (c) => say(c, 'close', [
          `${article(enemy, true)} ${enemy} came close to finishing me.`,
          `It was a near thing with ${article(enemy)} ${enemy}.`,
        ]) });
        break;
      }
      case 'mark':
        if (!e.note) break;
        highlights.push({ t: e.t, score: 20, say: (c) => say(c, 'mark', [
          `I noticed ${lower(cleanQuote(e.note, c))}.`,
          `One thing stayed with me: ${lower(cleanQuote(e.note, c))}.`,
        ]) });
        break;
      case 'vendor':
        if (!e.npc) break;
        minor.push({ t: e.t, say: (c) => say(c, 'vendor', [`I stopped by ${possessive(e.npc)} wares.`, `${e.npc} had me as a customer.`]) });
        break;
      case 'trainer':
        if (!e.npc) break;
        minor.push({ t: e.t, say: (c) => say(c, 'trainer', [`I dropped in on ${e.npc} for a lesson.`, `${e.npc} had a lesson for me.`]) });
        break;
      case 'flight':
        if (!e.to) break;
        minor.push({ t: e.t, say: (c) => say(c, 'flight', [`I took a flight to ${e.to}.`, `A flight carried me to ${e.to}.`]) });
        break;
      case 'money':
        if (!Number.isFinite(e.delta) || e.delta <= 0) break;
        minor.push({ t: e.t, say: (c) => say(c, 'money', [`I came away with ${coin(e.delta)}.`, `${cap(coin(e.delta))} found its way into my purse.`]) });
        break;
      case 'bind':
        if (e.where) facts.bind = e.where;
        break;
      default:
        break; // stats, bags, talents, chat, screenshots, xp and the rest are not for the journal
    }
  }

  // The hunting, when no errand already tells it.
  const hunted = [...kills.values()].sort((a, b) => b.n - a.n);
  facts.hunted = hunted;
  const told = new Set(facts.deeds.filter((d) => /^(hunted|thinned)/.test(d.past)).map((d) => d.past));
  if (hunted.length && !told.size) {
    const total = hunted.reduce((n, k) => n + k.n, 0);
    highlights.push({ t: hunted[0].t, score: 30 + Math.min(total, 20), say: (c) => say(c, 'kills', [
      `I felled ${killList(hunted)}.`,
      `${cap(killList(hunted))} fell to me.`,
      `Along the way I put down ${killList(hunted)}.`,
    ]) });
  } else if (hunted.some((k) => k.rare)) {
    const r = hunted.find((k) => k.rare);
    highlights.push({ t: r.t, score: 65, say: (c) => say(c, 'kills', [`${r.name}, the ${RANKS[r.rank] ?? 'rare'} one, fell to me.`, `I brought down ${r.name}, the ${RANKS[r.rank] ?? 'rare'} one.`]) });
  }
  facts.died = events.some((e) => e.e === 'death');
  return facts;
}

// The last line looks ahead: who still has work for me, or where I stopped.
function closing(left, facts, s, ctx) {
  if (left.length) {
    const givers = [...new Set(left.map((q) => q.giver).filter(Boolean))];
    if (givers.length) {
      const who = listOf(givers, 2);
      const many = left.length > 1;
      return say(ctx, 'close', [
        `${who} still ${givers.length > 1 ? 'have' : 'has'} work for me.`,
        `${many ? 'The rest of what' : 'What'} ${who} asked could wait for morning.`,
        `I still owe ${who} ${many ? 'a few things' : 'one thing'}.`,
      ]);
    }
    return say(ctx, 'close', [`There was work still waiting.`, `${cap(SMALL[left.length] ?? String(left.length))} things were still waiting on me.`]);
  }
  const rare = facts.rares.find((r) => !facts.hunted.some((k) => k.name === r));
  if (rare) return say(ctx, 'close', [`${rare} was still out there somewhere.`, `Somewhere out there, ${rare} was still waiting.`]);
  if (facts.bind) return say(ctx, 'close', [`${facts.bind} was home for now.`, `For now, home was ${facts.bind}.`]);
  const last = [...(s.events || [])].reverse().find((e) => e.z || e.sz);
  const place = last ? placeOf(last) : null;
  if (place) return say(ctx, 'close', [`The road went on from ${place}.`, `${cap(place)} was where the ${timeOfDay(last.t)} ended.`]);
  return say(ctx, 'close', [`Nothing was pressing.`, `There was nothing that could not wait.`]);
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

function plural(s) {
  if (/(vermin|folk|deer|fish|sheep|moose|elk|kin|spawn|men|children|people|scum|brood|s)$/i.test(s)) return s;
  if (/[xz]$|[cs]h$/i.test(s)) return `${s}es`;
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
}

function withThe(s) {
  return /^(the|a|an|some|his|her|my)\s|'s\b/i.test(s) ? s : `the ${s}`;
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
