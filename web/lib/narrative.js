// The Journal: one character's journey told as a story, chapter by chapter,
// from nothing but the events the addon logged. Third person, past tense,
// the character's name (never a guessed pronoun: "they" when one is needed).
// Chapters split when the character enters a new zone or comes back after a
// long break; paragraphs group a handful of events into prose.
//
// narrate({ character, sessions, world, codex, moment }) → { title, chapters }
// narrativeText(result) → Markdown for export.

import { charKey } from './journey.js';
import { money as moneyText, RANKS, SLOT_NAMES } from './describe.js';

const LONG_GAP = 6 * 3600; // a new session this long after the last one is a new day
const LOOT_WINDOW = 20; // loot this soon after a kill came from it
const SHOP_WINDOW = 60; // a purchase, lesson or flight this soon after the counter belongs to it
const FOLD_WINDOW = 15 * 60; // kills of the same creature this far apart are one hunt
const QUOTE_MAX = 120;
const PARAGRAPH_MAX = 5;
const PARAGRAPH_GAP = 10 * 60;

const KILL_VERBS = ['felled', 'cut down', 'dealt with', 'saw off', 'hunted down', 'put down', 'made short work of', 'got the better of'];
const LOOT_JOINS = [', coming away with', ' and picked up', ', which left them with', ' and pocketed'];
const QUALITY_ADJ = { 2: 'fine', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact' };
const SPEECH_VERBS = { say: ['called out', 'said'], yell: ['yelled', 'bellowed'], whisper: ['whispered', 'murmured'], emote: ['made a show of it', 'gestured'] };

// Openers for sentences built from clauses: how many clauses each takes and
// whether the character is named (paragraphs always open with the name).
const OPENERS = [
  { shape: 'name', n: 1, named: true, make: (N, [a]) => `${N} ${a}.` },
  { shape: 'then', n: 1, named: false, make: (N, [a]) => `Then they ${a}.` },
  { shape: 'pair', n: 2, named: true, make: (N, [a, b]) => `${N} ${a}, then ${b}.` },
  { shape: 'along', n: 1, named: false, make: (N, [a]) => `Along the way they ${a}.` },
  { shape: 'and', n: 2, named: true, make: (N, [a, b]) => `${N} ${a} and ${b}.` },
  { shape: 'before', n: 1, named: false, make: (N, [a]) => `Before long they ${a}.` },
  { shape: 'after', n: 1, named: true, make: (N, [a]) => `After that ${N} ${a}.` },
];

export function narrate({ character, sessions = [], world = null, codex = null, moment = (s, e) => ({ t: e.t, footage: null }) } = {}) {
  const name = character?.name ?? character?.info?.name ?? 'The hero';
  const mine = sessions.filter((s) => isTheirs(s, character)).sort((a, b) => (a.started || 0) - (b.started || 0));
  const ctx = {
    name, character, world, codex, moment,
    counters: {}, lastShape: null, openerIdx: 0,
    questNpc: new Map(), // qid or title -> { giver, turnIn, text }
  };
  if (codex?.quests) {
    for (const q of codex.quests) {
      const info = { giver: q.giver?.name ?? null, turnIn: q.turnInNpc?.name ?? null, text: q.reward ?? null };
      if (q.qid != null) ctx.questNpc.set(q.qid, info);
      if (q.title) ctx.questNpc.set(q.title, info);
    }
  }

  const timeline = [];
  for (const s of mine) for (const e of s.events || []) if (e && e.e && Number.isFinite(e.t)) timeline.push({ s, e });
  timeline.sort((a, b) => a.e.t - b.e.t);

  const chapters = splitChapters(timeline, ctx);
  for (const ch of chapters) {
    ch.beats = beatsFor(ch, ctx);
    ch.paragraphs = paragraphsFor(ch, ctx);
    ch.facts = factsFor(ch);
  }
  const out = chapters.filter((ch) => ch.paragraphs.length).map((ch) => ({
    id: ch.id, title: ch.title, zone: ch.zone, started: ch.started, ended: ch.ended, paragraphs: ch.paragraphs, facts: ch.facts,
  }));
  return { title: `The journal of ${name}`, character: name, chapters: out };
}

// The whole journal as Markdown: a heading, a heading per chapter, the prose.
export function narrativeText(result) {
  const lines = [`# ${result?.title ?? 'Journal'}`, ''];
  for (const ch of result?.chapters ?? []) {
    lines.push(`## ${ch.title}`, '');
    for (const p of ch.paragraphs) lines.push(p.text, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function isTheirs(s, character) {
  if (!character) return true;
  const key = charKey(s.char);
  if (character.key) return key === character.key;
  const realm = character.realm ?? character.info?.realm ?? null;
  return s.char?.name === character.name && (realm == null || (s.char?.realm ?? null) === realm);
}

// --- chapters ---------------------------------------------------------------

function splitChapters(timeline, ctx) {
  const chapters = [];
  let cur = null;
  let lastT = null;
  for (const item of timeline) {
    const { e } = item;
    const gap = lastT != null && e.t - lastT > LONG_GAP;
    const moved = (e.e === 'zone' || e.e === 'session_start') && e.z && cur && cur.zone && e.z !== cur.zone;
    if (!cur || gap || moved) {
      cur = { id: null, zone: e.z ?? null, reason: !cur ? 'start' : gap ? 'gap' : 'zone', items: [], started: e.t, ended: e.t };
      chapters.push(cur);
    }
    if (!cur.zone && e.z) cur.zone = e.z;
    cur.items.push(item);
    cur.ended = e.t;
    lastT = e.t;
  }
  const seen = new Set();
  chapters.forEach((ch, i) => {
    const zone = ch.zone ?? 'Somewhere';
    const prev = chapters[i - 1];
    if (i === 0) ch.title = `${zone}, the first day`;
    else if (ch.reason === 'gap' && prev?.zone === ch.zone) ch.title = `Another day in ${zone}`;
    else if (seen.has(zone)) ch.title = `Back to ${zone}`;
    else ch.title = `On to ${zone}`;
    seen.add(zone);
    ch.id = `ch${i + 1}-${slug(zone)}`;
    ch.index = i;
  });
  return chapters;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

// --- beats: one narratable thing each, folded and attached -------------------

function beatsFor(ch, ctx) {
  const items = ch.items;
  const beats = [];
  const consumed = new Set();
  const once = new Set(); // "vendor:Brother Danil" and the like, mentioned once per chapter
  const lootTimes = new Map(); // item id -> [t] of `loot` events, so loot windows do not repeat them
  for (const { e } of items) if (e.e === 'loot' && e.id != null) lootTimes.set(e.id, [...(lootTimes.get(e.id) || []), e.t]);
  const detail = new Map(); // qid/title -> latest quest_detail seen in this chapter

  const last = () => beats[beats.length - 1] ?? null;
  const push = (b) => { beats.push(b); return b; };
  const ahead = (i, seconds, pred) => {
    for (let j = i + 1; j < items.length; j++) {
      const { e } = items[j];
      if (e.t - items[i].e.t > seconds) break;
      if (!consumed.has(j) && pred(e)) return j;
    }
    return -1;
  };
  const isFirstChapterEvent = (i) => i === 0;
  // The kill this loot came from: the latest hunt of that creature (any creature when
  // unnamed) within the window, looking past a close-call fight beat in between.
  const killBefore = (t, name) => {
    for (let k = beats.length - 1; k >= 0 && k >= beats.length - 3; k--) {
      const b = beats[k];
      if (b.kind === 'kill' && (!name || b.name === name) && t - b.lastT <= LOOT_WINDOW) return b;
      if (b.kind !== 'fight' && b.kind !== 'kill') return null;
    }
    return null;
  };

  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue;
    const { s, e } = items[i];
    const base = { t: e.t, e, s, kind: e.e };
    switch (e.e) {
      case 'session_start': {
        const first = ch.index === 0 && isFirstChapterEvent(i);
        if (first) push({ ...base, sentence: `${ctx.name}'s story begins in ${placeOf(e)}.`, shape: 'begin' });
        else if (isFirstChapterEvent(i)) push({ ...base, sentence: `${ctx.name} was back, starting out in ${placeOf(e)}.`, shape: 'back' });
        else push({ ...base, clause: `picked things up again in ${placeOf(e)}` });
        break;
      }
      case 'zone': {
        if (isFirstChapterEvent(i) && e.z) { push({ ...base, clause: `${pick(ctx, 'cross', ['crossed into', 'arrived in', 'made their way into'])} ${e.z}` }); break; }
        if (!e.sz) break;
        if (ahead(i, LOOT_WINDOW, (x) => x.e === 'explore' && x.area === e.sz) >= 0) break; // the discovery says it better
        push({ ...base, clause: `${pick(ctx, 'move', ['headed over to', 'made for', 'wandered into'])} ${e.sz}` });
        break;
      }
      case 'explore':
        if (!e.area) break;
        push({ ...base, clause: pick(ctx, 'explore', [`discovered ${e.area}`, `found their way to ${e.area}`, `set foot in ${e.area} for the first time`]) });
        break;
      case 'quest_detail': {
        if (e.qid != null) detail.set(e.qid, e);
        if (e.title) detail.set(e.title, e);
        const qid = e.qid ?? e.title;
        if (qid == null) break;
        if (ahead(i, 120, (x) => x.e === 'quest_accept' && (x.qid ?? x.title) === qid) >= 0) break;
        if (ahead(i, 120, (x) => x.e === 'quest_turnin' && (x.qid ?? x.title) === qid) >= 0) break;
        if (!e.title) break;
        push({ ...base, clause: e.npc ? `heard ${e.npc} out about ${e.title} and left it for another day` : `heard about ${e.title} and left it for another day` });
        break;
      }
      case 'quest_accept': {
        const title = e.title ?? questTitle(ctx, e.qid) ?? (e.qid != null ? `quest ${e.qid}` : null);
        if (!title) break;
        const giver = detail.get(e.qid ?? e.title)?.npc ?? ctx.questNpc.get(e.qid ?? e.title)?.giver ?? null;
        const clause = giver
          ? pick(ctx, 'accept', [`took ${poss(giver)} word for it and signed on for ${title}`, `agreed to help ${giver} with ${title}`, `took on ${title} for ${giver}`, `picked up ${title} from ${giver}`])
          : pick(ctx, 'accept0', [`took on ${title}`, `signed up for ${title}`]);
        push({ ...base, clause });
        break;
      }
      case 'quest_progress': {
        const qid = e.qid ?? e.title;
        if (!e.title || ahead(i, 30, (x) => x.e === 'quest_turnin' && (x.qid ?? x.title) === qid) >= 0) break;
        push({ ...base, clause: e.npc ? `checked in with ${e.npc} about ${e.title}, but the job was not done yet` : `checked on ${e.title}, but the job was not done yet` });
        break;
      }
      case 'quest_complete':
        break; // the turn-in tells it, with this event's words
      case 'quest_turnin': {
        const title = e.title ?? questTitle(ctx, e.qid) ?? (e.qid != null ? `quest ${e.qid}` : null);
        if (!title) break;
        const qid = e.qid ?? e.title;
        // The completion dialog just before carries who took it and what they said.
        let complete = null;
        for (let j = i - 1; j >= 0 && e.t - items[j].e.t <= 120; j--) {
          const x = items[j].e;
          if (x.e === 'quest_complete' && (x.qid ?? x.title) === qid) { complete = x; break; }
        }
        const npc = complete?.npc ?? ctx.questNpc.get(qid)?.turnIn ?? null;
        const text = complete?.text ?? ctx.questNpc.get(qid)?.text ?? null;
        const b = push({ ...base, kind: 'quest_turnin', title, npc, xp: e.xp ?? null, money: e.money ?? null, items: [], quote: null });
        if (text) b.quote = { text: cleanQuote(text, ctx), npc };
        break;
      }
      case 'quest_abandon':
        if (e.title) push({ ...base, clause: pick(ctx, 'abandon', [`gave up on ${e.title}`, `dropped ${e.title}`, `let ${e.title} go`]) });
        break;
      case 'kill': {
        if (!e.name) break;
        const b = last();
        if (b && b.kind === 'kill' && b.name === e.name && e.t - b.lastT <= FOLD_WINDOW) { b.count++; b.lastT = e.t; break; }
        push({ ...base, name: e.name, npcId: e.npcId ?? null, count: 1, lastT: e.t, items: [], rare: isRare(e, ctx), rank: e.rank ?? null });
        break;
      }
      case 'loot': {
        if (!e.name && e.id == null) break;
        const item = itemPhrase(e, ctx);
        const b = last();
        const src = e.src || 'loot';
        const k = src === 'loot' ? killBefore(e.t, null) : null;
        if (k) { k.items.push(item); break; }
        if (b && b.kind === 'quest_turnin' && src !== 'bought' && e.t - b.t <= LOOT_WINDOW) { b.items.push(item); break; }
        if (b && b.kind === 'vendor' && src === 'bought' && e.t - b.t <= SHOP_WINDOW) { b.items.push(item); break; }
        if (b && b.kind === 'loot' && b.src === src && e.t - b.lastT <= LOOT_WINDOW) { b.items.push(item); b.lastT = e.t; break; }
        push({ ...base, src, items: [item], lastT: e.t });
        break;
      }
      case 'loot_window': {
        // Only what no `loot` event already told: mostly chests, herbs and ore.
        const fresh = (e.items || []).filter((it) => !(lootTimes.get(it.id) || []).some((t) => Math.abs(t - e.t) <= LOOT_WINDOW));
        if (!fresh.length) break;
        const phrases = fresh.map((it) => itemPhrase({ id: it.id, name: it.name, n: it.n }, ctx));
        const src = (e.sources || [])[0] || {};
        const k = src.kind === 'Creature' ? killBefore(e.t, src.name ?? null) : null;
        if (k) { k.items.push(...phrases); break; }
        if (src.kind === 'GameObject' && src.name && fresh.length === 1 && fresh[0].name === src.name) push({ ...base, clause: `${pick(ctx, 'gather', ['gathered', 'picked'])} ${phrases[0]}` });
        else if (src.kind === 'GameObject' && src.name) push({ ...base, clause: `opened ${article(src.name)} ${src.name} and found ${list(phrases)}` });
        else push({ ...base, clause: `found ${list(phrases)} lying about` });
        break;
      }
      case 'money':
        break; // summed per chapter at the end
      case 'vendor': {
        if (!e.npc || once.has(`vendor:${e.npc}`)) break;
        once.add(`vendor:${e.npc}`);
        push({ ...base, npc: e.npc, items: [] });
        break;
      }
      case 'trainer': {
        if (!e.npc || once.has(`trainer:${e.npc}`)) break;
        once.add(`trainer:${e.npc}`);
        const learned = [];
        for (let j = ahead(i, SHOP_WINDOW, (x) => x.e === 'learn' && x.what); j >= 0; j = ahead(j, SHOP_WINDOW, (x) => x.e === 'learn' && x.what)) { learned.push(items[j].e.what); consumed.add(j); }
        push({ ...base, clause: learned.length ? `learned ${list(learned)} from ${e.npc}` : `dropped in on ${e.npc} for a lesson` });
        break;
      }
      case 'learn': {
        if (!e.what) break;
        const b = last();
        if (b && b.kind === 'learn' && e.t - b.t <= SHOP_WINDOW) { b.what.push(e.what); break; }
        push({ ...base, what: [e.what] });
        break;
      }
      case 'taxi':
      case 'taxi_map': {
        if (!e.npc || once.has(`taxi:${e.npc}`)) break;
        once.add(`taxi:${e.npc}`);
        const j = ahead(i, SHOP_WINDOW, (x) => x.e === 'flight' && x.to);
        if (j >= 0) {
          consumed.add(j);
          const f = items[j].e;
          push({ ...base, clause: f.cost ? `paid ${e.npc} ${moneyText(f.cost)} for a flight to ${f.to}` : `took a flight from ${e.npc} to ${f.to}` });
        } else push({ ...base, clause: `checked the flight paths with ${e.npc}` });
        break;
      }
      case 'flight':
        if (e.to) push({ ...base, clause: `took a flight to ${e.to}` });
        break;
      case 'bind':
        if (e.where) push({ ...base, clause: pick(ctx, 'bind', [`set their hearthstone at ${e.where}`, `made ${e.where} home for now`]) });
        break;
      case 'equip': {
        if (!e.id || !e.name) break;
        const slot = SLOT_NAMES[e.slot] ? SLOT_NAMES[e.slot].toLowerCase() : null;
        const clause = e.was
          ? `swapped ${article(e.was)} ${e.was} for ${article(e.name)} ${e.name}`
          : pick(ctx, 'equip', [`put on ${article(e.name)} ${e.name}${slot ? ` (${slot})` : ''}`, `strapped on ${article(e.name)} ${e.name}`]);
        push({ ...base, clause });
        break;
      }
      case 'skill': {
        const m = /skill in (.+?) has increased to (\d+)/i.exec(e.text || '');
        if (!m) break;
        const b = last();
        if (b && b.kind === 'skill' && b.skill === m[1]) { b.rank = Number(m[2]); break; }
        push({ ...base, skill: m[1], rank: Number(m[2]) });
        break;
      }
      case 'level':
        if (e.level != null) push({ ...base, level: e.level });
        break;
      case 'death':
        push({ ...base, killer: e.killer ?? null, by: e.by && e.by !== 'Melee' ? e.by : null });
        break;
      case 'npc': {
        if (!e.name || !isRare(e, ctx) || once.has(`rare:${e.name}`)) break;
        once.add(`rare:${e.name}`);
        push({ ...base, kind: 'rare', name: e.name, desc: rareDesc(e, ctx) });
        break;
      }
      case 'fight': {
        if (!e.close) break;
        const who = [...new Set((e.enemies || []).map((x) => x.name).filter(Boolean))];
        if (!who.length) break;
        push({ ...base, enemies: who, minHp: e.minHp ?? null });
        break;
      }
      case 'gossip': {
        if (!e.npc || !e.text) break;
        push({ ...base, kind: 'quote', speaker: e.npc, text: cleanQuote(e.text, ctx), verb: pick(ctx, 'gossip', ['greeted them with', 'had a word for them:', 'offered']) , style: 'gossip' });
        break;
      }
      case 'speech': {
        if (!e.speaker || !e.text) break;
        push({ ...base, kind: 'quote', speaker: e.speaker, text: cleanQuote(e.text, ctx), verb: pick(ctx, `speech:${e.kind}`, SPEECH_VERBS[e.kind] || ['said', 'remarked']), style: 'speech' });
        break;
      }
      case 'book':
        push({ ...base, clause: pick(ctx, 'book', [`stopped to read ${e.title ?? 'a plaque'}`, `paused over ${e.title ?? 'some writing'}`, `took a moment with ${e.title ?? 'a text'}`]) });
        break;
      case 'mark':
        if (e.note) push({ ...base, note: cleanQuote(e.note, ctx), markKind: e.kind });
        break;
      case 'duel':
        if (e.with) push({ ...base, clause: `crossed swords with ${e.with} in a duel` });
        break;
      default:
        break; // stats, bags, talents, chat, screenshots, xp and the rest are not story
    }
  }
  const net = items.reduce((n, { e }) => n + (e.e === 'money' && Number.isFinite(e.delta) ? e.delta : 0), 0);
  const anyMoney = items.some(({ e }) => e.e === 'money' && Number.isFinite(e.delta));
  if (anyMoney && beats.length) ch.money = net;
  return beats;
}

// --- rendering beats as sentences or clauses --------------------------------

function render(b, ctx) {
  const N = ctx.name;
  switch (b.kind) {
    case 'kill': {
      const verb = pick(ctx, 'kill', KILL_VERBS);
      const who = b.rare ? `${b.name}, the ${RANKS[b.rank] ?? 'rare'} one` : b.count > 1 ? `${b.count} ${b.name}` : `${article(b.name)} ${b.name}`;
      const loot = b.items.length ? `${pick(ctx, 'lootjoin', LOOT_JOINS)} ${list(b.items)}` : '';
      return { clause: `${verb} ${who}${loot}` };
    }
    case 'loot': {
      const what = list(b.items);
      if (b.src === 'bought') return { clause: `bought ${what}` };
      if (b.src === 'received') return { clause: `was handed ${what}` };
      if (b.src === 'created') return { clause: `made ${what}` };
      return { clause: pick(ctx, 'loot', [`picked up ${what}`, `came across ${what}`, `pocketed ${what}`]) };
    }
    case 'quest_turnin': {
      const reward = [];
      if (b.xp) reward.push(`${b.xp} experience`);
      if (b.money) reward.push(moneyText(b.money));
      if (b.items.length) reward.push(...b.items);
      const forWhat = reward.length ? ` for ${list(reward)}` : '';
      const clause = b.npc
        ? pick(ctx, 'turnin', [`handed ${b.title} back to ${b.npc}${forWhat}`, `reported back to ${b.npc} with ${b.title} done${forWhat}`, `turned ${b.title} in to ${b.npc}${forWhat}`])
        : pick(ctx, 'turnin0', [`turned in ${b.title}${forWhat}`, `finished ${b.title}${forWhat}`]);
      let tail = null;
      if (b.quote?.text) {
        const q = b.quote.text;
        const said = b.quote.npc ? `said ${b.quote.npc}` : 'came the reply';
        tail = /[!?…]$/.test(q) ? `"${q}" ${said}.` : `"${q.replace(/\.$/, '')}," ${said}.`;
      }
      return { clause, tail, quote: Boolean(tail) };
    }
    case 'vendor': {
      const verb = b.items.length ? pick(ctx, 'shop', ['stocked up at', 'did some shopping at']) : pick(ctx, 'browse', ['stopped by', 'looked over the wares at']);
      return { clause: `${verb} ${poss(b.npc)}${b.items.length ? `, coming away with ${list(b.items)}` : ''}` };
    }
    case 'learn': return { clause: `learned ${list(b.what)}` };
    case 'skill': return { clause: pick(ctx, 'skill', [`pushed their ${b.skill} up to ${b.rank}`, `got a little better at ${b.skill} (${b.rank} now)`]) };
    case 'level': return { sentence: pick(ctx, 'level', [`${N} hit level ${b.level}.`, `That was enough for level ${b.level}.`, `Level ${b.level} came somewhere in there.`]), shape: 'level' };
    case 'death': {
      if (!b.killer) return { sentence: pick(ctx, 'death0', [`${N} died.`, `Then ${N} died, and that was that.`]), shape: 'death' };
      const by = b.by ? ` with ${b.by}` : '';
      return { sentence: pick(ctx, 'death', [`${b.killer} killed ${N}${by}, and that was that.`, `${b.killer} got the better of ${N}${by}.`, `${N} fell to ${b.killer}${by}.`]), shape: 'death' };
    }
    case 'rare': return { sentence: pick(ctx, 'rare', [`${b.name}, ${b.desc}, was lurking nearby.`, `${N} caught sight of ${b.name}, ${b.desc}.`]), shape: 'rare' };
    case 'fight': {
      const who = list(b.enemies);
      const hp = b.minHp != null ? `${b.minHp}%` : 'very little';
      return { sentence: pick(ctx, 'close', [`It was a close thing with ${who}: down to ${hp} health before it was over.`, `${who} nearly had them, with only ${hp} health to spare.`]), shape: 'close' };
    }
    case 'quote': {
      if (b.style === 'gossip') return { sentence: `${b.speaker} ${b.verb} "${b.text}"`, shape: 'quote', quote: true };
      return { sentence: pick(ctx, 'quoteshape', [`${b.speaker} ${b.verb}, "${b.text}"`, `From ${b.speaker}: "${b.text}"`]), shape: 'quote', quote: true };
    }
    case 'mark': {
      const lead = { shot: 'Somewhere here was a shot worth keeping', funny: 'Something funny happened here', lore: 'A lore beat here', redo: 'A moment to redo' }[b.markKind] ?? 'A note from the road';
      return { sentence: `${lead}: "${b.note}".`, shape: 'mark' };
    }
    default:
      if (b.sentence) return { sentence: b.sentence, shape: b.shape ?? b.kind };
      return { clause: b.clause };
  }
}

// --- paragraphs: 2–6 beats each, prose not a log ----------------------------

function paragraphsFor(ch, ctx) {
  ctx.lastShape = null; // a chapter opens plainly, with the name
  ctx.openerIdx = 0;
  const groups = [];
  let cur = [];
  let lastT = null;
  for (const b of ch.beats) {
    const breaker = cur.length >= PARAGRAPH_MAX
      || (cur.length >= 2 && lastT != null && b.t - lastT > PARAGRAPH_GAP)
      || (cur.length >= 2 && (b.kind === 'death' || b.kind === 'explore' || b.kind === 'session_start'));
    if (breaker) { groups.push(cur); cur = []; }
    cur.push(b);
    lastT = b.t;
  }
  if (cur.length) groups.push(cur);
  // A lone trailing beat reads better tacked onto the paragraph before it.
  if (groups.length > 1 && groups.at(-1).length === 1) groups[groups.length - 2].push(...groups.pop());

  const out = [];
  for (const group of groups) {
    const rendered = [];
    let quoted = false;
    for (const b of group) {
      const r = render(b, ctx);
      if (r.quote) { if (quoted) continue; quoted = true; } // one quote per paragraph
      rendered.push({ b, ...r });
    }
    if (!rendered.length) continue;
    const sentences = compose(rendered, ctx);
    const first = group[0];
    const m = ctx.moment(first.s, first.e) || {};
    out.push({
      text: sentences.join(' '),
      t: first.t,
      session: first.s?.id ?? null,
      footage: m.footage ?? null,
      kinds: group.map((b) => b.e.e),
    });
  }
  if (out.length && ch.money != null) {
    const d = ch.money;
    const line = d === 0
      ? 'The purse ended up exactly where it started.'
      : pick(ctx, 'money', [`All told, the purse came out ${moneyText(d)} ${d > 0 ? 'heavier' : 'lighter'}.`, `By the end of it ${ctx.name} was ${moneyText(d)} ${d > 0 ? 'richer' : 'poorer'}.`]);
    out[out.length - 1].text += ` ${line}`;
  }
  return out;
}

// Turns rendered beats into sentences, never repeating the previous shape.
function compose(rendered, ctx) {
  const out = [];
  let i = 0;
  let first = true;
  while (i < rendered.length) {
    const r = rendered[i];
    if (r.sentence) { out.push(r.sentence); ctx.lastShape = r.shape; i++; first = false; continue; }
    const clauses = [r.clause];
    if (rendered[i + 1]?.clause && !r.tail && !rendered[i + 1].tail) clauses.push(rendered[i + 1].clause);
    const opener = chooseOpener(ctx, clauses.length, first);
    const used = clauses.slice(0, opener.n);
    out.push(opener.make(ctx.name, used));
    if (r.tail && opener.n === 1) out.push(r.tail);
    ctx.lastShape = opener.shape;
    i += opener.n;
    first = false;
  }
  return out;
}

function chooseOpener(ctx, available, named) {
  for (let k = 0; k < OPENERS.length; k++) {
    const idx = (ctx.openerIdx + k) % OPENERS.length;
    const o = OPENERS[idx];
    if (o.shape === ctx.lastShape || o.n > available || (named && !o.named)) continue;
    ctx.openerIdx = idx + 1;
    return o;
  }
  return OPENERS[0];
}

// --- facts ------------------------------------------------------------------

function factsFor(ch) {
  const f = { kills: 0, quests: 0, drops: 0, deaths: 0, levels: [] };
  for (const { e } of ch.items) {
    if (e.e === 'kill') f.kills++;
    else if (e.e === 'quest_turnin') f.quests++;
    else if (e.e === 'loot' && (e.src || 'loot') === 'loot') f.drops += e.n || 1;
    else if (e.e === 'death') f.deaths++;
    else if (e.e === 'level' && e.level != null) f.levels.push(e.level);
  }
  return f;
}

// --- words ------------------------------------------------------------------

// Rotates through a pool so neighbouring sentences never share a verb.
function pick(ctx, key, pool) {
  const n = ctx.counters[key] = (ctx.counters[key] ?? -1) + 1;
  return pool[n % pool.length];
}

function itemPhrase(e, ctx) {
  const name = e.name ?? `item ${e.id}`;
  const q = e.q ?? ctx.world?.byItem?.get(e.id)?.quality ?? null;
  const adj = QUALITY_ADJ[q] ?? null;
  const n = e.n || 1;
  const noun = adj ? `${adj} ${name}` : name;
  return n > 1 ? `${n} ${noun}` : `${article(noun)} ${noun}`;
}

function article(word) {
  return /^[aeiou]/i.test(String(word)) ? 'an' : 'a';
}

function poss(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function list(parts) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function placeOf(e) {
  return e.sz && e.sz !== e.z ? `${e.sz}, ${e.z}` : (e.z || e.sz || 'the world');
}

function questTitle(ctx, qid) {
  if (qid == null) return null;
  return ctx.codex?.quests?.find((q) => q.qid === qid)?.title ?? null;
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
  const level = e.level ?? n?.maxLevel ?? null;
  return `${article(rank)} ${rank}${what ? ` ${what}` : ''}${level != null && level !== -1 ? ` of level ${level}` : ''}`;
}

// NPC text with the game's tokens filled in, whitespace collapsed, trimmed.
function cleanQuote(text, ctx) {
  const info = ctx.character?.info ?? ctx.character ?? {};
  const sex = info.sex;
  let t = String(text)
    .replace(/\$[Bb]/g, ' ')
    .replace(/\$[Nn]/g, ctx.name)
    .replace(/\$[Cc]/g, String(info.class ?? 'friend').toLowerCase())
    .replace(/\$[Rr]/g, String(info.race ?? 'traveller').toLowerCase())
    .replace(/\$[Gg]([^:;]*):([^;]*);/g, (_, m, f) => (sex === 3 ? f : m))
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > QUOTE_MAX) t = `${t.slice(0, QUOTE_MAX - 1).replace(/\s+\S*$/, '')}…`;
  return t;
}
