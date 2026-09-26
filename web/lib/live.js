// The live link: the addon whispers compact lines to the character itself,
// the game writes them to Logs\WoWChatLog.txt as it goes, and the app on the
// gaming PC reads that file and turns the lines into events for the stream
// overlay. This file is the reading side, and the running totals. A whisper
// to yourself lands in the log twice ("To Aldric: ..." then "Aldric
// whispers: ..."), so the second copy of a message is dropped.

export const PREFIX = 'CHRON1';
const SEP = '~';
const EVSEP = '~~';
export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80'];
export const STREAK_WINDOW = 12000; // ms between kills that keep a streak alive

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v) => (v == null || v === '-' ? null : String(v));

// "9/25 21:14:03.771  text" -> { at (epoch ms, local time of the PC), text }.
// The year is not in the file; a date later than "now" means last year.
export function parseChatLine(line, now = Date.now()) {
  const m = /^(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})\.(\d{3})\s+(.*)$/.exec(line);
  if (!m) return null;
  const d = new Date(now);
  let at = new Date(d.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  if (at > now + 36 * 3600 * 1000) at = new Date(d.getFullYear() - 1, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  return { at, text: m[7] };
}

// Item links as chat shows them: |cff0070dd|Hitem:2589:...|h[Linen Cloth]|h|r
const QUALITY_BY_COLOR = { '9d9d9d': 0, ffffff: 1, '1eff00': 2, '0070dd': 3, a335ee: 4, ff8000: 5, e6cc80: 6 };
export function parseItemLink(text) {
  const m = /\|cff([0-9a-f]{6})\|Hitem:(\d+)[^|]*\|h\[([^\]]*)\]\|h\|r/i.exec(text);
  if (!m) return null;
  return { id: Number(m[2]), name: m[3], q: QUALITY_BY_COLOR[m[1].toLowerCase()] ?? null };
}

// The game's own loot line, used when the addon's line is missing.
export function parseNativeLoot(text) {
  const m = /^You receive (?:loot|item): (.*?)(?:x(\d+))?\.?$/.exec(text);
  if (!m) return null;
  const item = parseItemLink(m[1]);
  if (!item) return null;
  return { kind: 'loot', ...item, n: m[2] ? Number(m[2]) : 1, source: null, sourceId: null };
}

// Kobold Vermin slain: 3/10  ->  { label, n, m }
export function parseProgress(text) {
  const m = /^(.*?):?\s*(\d+)\s*\/\s*(\d+)\s*(?:\(.*\))?$/.exec(String(text || '').trim());
  if (!m) return null;
  return { label: m[1].trim(), n: Number(m[2]), m: Number(m[3]) };
}

// One addon line ("L~2589~Linen Cloth~1~2~Kobold Vermin~6") -> an event.
export function decodeLine(line) {
  const f = line.split(SEP);
  const kind = f[0];
  switch (kind) {
    case 'L': return { kind: 'loot', id: num(f[1]), name: str(f[2]), q: num(f[3]), n: num(f[4]) ?? 1, source: str(f[5]), sourceId: num(f[6]) };
    case 'Q': return { kind: 'quest', action: str(f[1]), qid: num(f[2]), title: f[1] === 'progress' ? null : str(f[3]), text: f[1] === 'progress' ? str(f[3]) : null, xp: num(f[4]), money: num(f[5]) };
    case 'K': return { kind: 'kill', npcId: num(f[1]), name: str(f[2]) };
    case 'D': return { kind: 'death', killer: str(f[1]), killerId: num(f[2]) };
    case 'V': return { kind: 'level', level: num(f[1]) };
    case 'Z': return { kind: 'zone', zone: str(f[1]), sub: str(f[2]) };
    case 'R': return { kind: 'rare', npcId: num(f[1]), name: str(f[2]), level: num(f[3]), rank: str(f[4]) };
    case 'M': return { kind: 'money', delta: num(f[1]), total: num(f[2]) };
    case 'X': return { kind: 'xp', amount: num(f[1]) };
    case 'S': return { kind: 'skill', text: str(f[1]) };
    case 'E': return { kind: 'explore', area: str(f[1]) };
    case 'A': return { kind: 'mark', markKind: str(f[1]), note: str(f[2]) };
    case 'P': return { kind: 'screenshot', reason: str(f[1]) };
    case 'H': return { kind: 'heartbeat', level: num(f[1]), xp: num(f[2]), xpMax: num(f[3]), zone: str(f[4]), sub: str(f[5]), x: num(f[6]), y: num(f[7]), money: num(f[8]) };
    case 'B': return { kind: 'begin', version: str(f[1]), name: str(f[2]), realm: str(f[3]), level: num(f[4]) };
    case 'T': return { kind: 'test', sentAt: num(f[1]) };
    default: return null;
  }
}

// The addon's part of a chat log line, or null.
export function livePayload(text) {
  const i = text.indexOf(PREFIX + SEP);
  if (i < 0) return null;
  return text.slice(i + PREFIX.length + 1).replace(/\|r\s*$/, '');
}

// Every event in one chat log line (the addon packs several per message).
export function decodeEvents(text) {
  const payload = livePayload(text);
  if (payload == null) return [];
  return payload.split(EVSEP).map(decodeLine).filter(Boolean);
}

export const ECHO_WINDOW = 5000; // ms within which the same message is the whisper's echo

// A chunk of the chat log -> events with times. Addon lines win; the game's
// own loot lines only count when the addon's link is off (no addon line in
// the last while).
export function eventsFromChatLog(chunk, { now = Date.now(), linkSeenAt = 0, lastPayload = null } = {}) {
  const out = [];
  let lastLink = linkSeenAt;
  let last = lastPayload; // { text, at, echoed } of the previous addon line
  for (const raw of chunk.split(/\r?\n/)) {
    const line = parseChatLine(raw, now);
    if (!line) continue;
    const payload = livePayload(line.text);
    if (payload != null) {
      lastLink = line.at;
      // Each message has exactly one echo; the same text again after that is
      // a new message (the same mob killed twice, say).
      if (last && !last.echoed && last.text === payload && Math.abs(line.at - last.at) < ECHO_WINDOW) { last.echoed = true; continue; }
      last = { text: payload, at: line.at, echoed: false };
      for (const e of payload.split(EVSEP).map(decodeLine).filter(Boolean)) out.push({ at: line.at, ...e });
      continue;
    }
    const loot = parseNativeLoot(line.text);
    if (loot && line.at - lastLink > 120000) out.push({ at: line.at, ...loot, fromGame: true });
  }
  return { events: out, linkSeenAt: lastLink, lastPayload: last };
}

// Running totals for the overlay since `since`. apply() takes events in
// order; snapshot() is what goes to the cloud.
export class LiveState {
  constructor(since = Date.now()) {
    this.reset(since);
  }

  reset(since) {
    this.since = since;
    this.uploadedUntil = 0;
    this.seq = 0;
    this.events = []; // the last ones, for toasts
    this.loot = []; // every drop since `since`
    this.drops = new Map(); // item id -> { id, name, q, n, times }
    this.kills = 0;
    this.killsByName = new Map();
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.lastKillAt = 0;
    this.quests = new Map(); // key -> { qid, title, objectives: { label -> { n, m } }, state, at }
    this.questsDone = 0;
    this.rares = [];
    this.xp = 0;
    this.money = 0;
    this.character = { level: null, xp: null, xpMax: null, zone: null, sub: null, name: null, realm: null, x: null, y: null, gold: null };
    this.lastEventAt = 0;
    this.begunAt = 0;
    this.lastTestAt = 0;
  }

  apply(e) {
    if (!e || !e.at) return false;
    if (e.at < this.since && e.kind !== 'begin' && e.kind !== 'heartbeat') return false;
    this.lastEventAt = Math.max(this.lastEventAt, e.at);
    const c = this.character;
    switch (e.kind) {
      case 'begin': c.name = e.name; c.realm = e.realm; c.level = e.level; this.begunAt = e.at; break;
      case 'test': this.lastTestAt = e.at; break;
      case 'heartbeat': Object.assign(c, { level: e.level, xp: e.xp, xpMax: e.xpMax, zone: e.zone, sub: e.sub, x: e.x, y: e.y, gold: e.money }); return true;
      case 'loot': {
        if (!e.id) return false;
        const d = this.drops.get(e.id) || { id: e.id, name: e.name, q: e.q, n: 0, times: 0, sources: {} };
        d.n += e.n || 1;
        d.times++;
        if (e.source) d.sources[e.source] = (d.sources[e.source] || 0) + (e.n || 1);
        if (e.q != null) d.q = e.q;
        this.drops.set(e.id, d);
        this.loot.push({ at: e.at, id: e.id, name: e.name, q: e.q, n: e.n || 1, source: e.source, sourceId: e.sourceId });
        if (this.loot.length > 4000) this.loot.shift();
        break;
      }
      case 'kill': {
        this.kills++;
        if (e.name) this.killsByName.set(e.name, (this.killsByName.get(e.name) || 0) + 1);
        this.streak = e.at - this.lastKillAt <= STREAK_WINDOW ? this.streak + 1 : 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.lastKillAt = e.at;
        break;
      }
      case 'death': this.deaths++; this.streak = 0; break;
      case 'level': c.level = e.level; break;
      case 'zone': c.zone = e.zone; c.sub = e.sub; break;
      case 'rare': this.rares.push({ at: e.at, npcId: e.npcId, name: e.name, level: e.level, rank: e.rank }); break;
      case 'money': this.money += e.delta || 0; if (e.total != null) c.gold = e.total; break;
      case 'xp': this.xp += e.amount || 0; break;
      case 'quest': {
        const key = e.qid ? `q${e.qid}` : e.title ? `t${e.title}` : null;
        if (e.action === 'progress') {
          const p = parseProgress(e.text);
          // Progress lines do not say which quest; match by an objective seen before, else the newest active quest.
          let q = [...this.quests.values()].find((x) => x.state === 'active' && p && x.objectives[p.label]);
          if (!q) q = [...this.quests.values()].filter((x) => x.state === 'active').sort((a, b) => b.at - a.at)[0];
          if (!q) { q = { key: `t?${this.quests.size}`, qid: null, title: null, objectives: {}, state: 'active', at: e.at }; this.quests.set(q.key, q); }
          if (p) q.objectives[p.label] = { n: p.n, m: p.m, at: e.at };
          else q.objectives[e.text] = { n: 1, m: 1, at: e.at };
          q.at = e.at;
          q.lastText = e.text;
          break;
        }
        if (!key) return false;
        // Abandons carry no quest id: find the quest by its title.
        const byTitle = !e.qid && e.title ? [...this.quests.values()].find((x) => x.title === e.title) : null;
        const q = this.quests.get(key) || byTitle || { key, qid: e.qid, title: e.title, objectives: {}, state: 'active', at: e.at };
        q.title = e.title ?? q.title;
        if (e.action === 'accept') q.state = 'active';
        else if (e.action === 'turnin') { q.state = 'done'; q.xp = e.xp; q.money = e.money; this.questsDone++; }
        else if (e.action === 'abandon') { if (q.state === 'done') return false; q.state = 'abandoned'; }
        else if (e.action === 'complete') q.state = q.state === 'done' ? 'done' : 'complete';
        q.at = e.at;
        this.quests.set(q.key, q);
        if (this.quests.size > 40) this.quests.delete(this.quests.keys().next().value);
        break;
      }
      default: break;
    }
    if (['loot', 'kill', 'death', 'level', 'zone', 'rare', 'quest', 'explore', 'mark', 'screenshot', 'skill', 'money', 'xp', 'test'].includes(e.kind)) {
      this.seq++;
      this.events.push({ seq: this.seq, ...e });
      if (this.events.length > 80) this.events.shift();
    }
    return true;
  }

  // Kills within the last `ms` milliseconds are not tracked per time, so the
  // rate is over the whole session.
  snapshot(now = Date.now()) {
    const minutes = Math.max(1, (now - this.since) / 60000);
    return {
      since: this.since, uploadedUntil: this.uploadedUntil, at: now, seq: this.seq, lastEventAt: this.lastEventAt, lastTestAt: this.lastTestAt,
      character: this.character,
      kills: this.kills, killsPerMinute: Math.round((this.kills / minutes) * 10) / 10, deaths: this.deaths,
      streak: now - this.lastKillAt <= STREAK_WINDOW ? this.streak : 0, bestStreak: this.bestStreak, lastKillAt: this.lastKillAt,
      questsDone: this.questsDone, xp: this.xp, money: this.money,
      topKills: [...this.killsByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n })),
      drops: [...this.drops.values()].sort((a, b) => b.n - a.n).slice(0, 60),
      loot: this.loot.slice(-400),
      quests: [...this.quests.values()].sort((a, b) => b.at - a.at).slice(0, 12).map((q) => ({ ...q, objectives: Object.entries(q.objectives).map(([label, o]) => ({ label, ...o })) })),
      rares: this.rares.slice(-10),
      events: this.events.slice(-40),
    };
  }
}

// Item counters for the overlay. counters: [{ id, name, mode: 'session'|'ongoing', add }].
// past: [{ at, id, n }] loot from uploaded sessions (server ms); live: the LiveState.
export function counterValues(counters, past, live) {
  const out = [];
  for (const c of counters || []) {
    const id = Number(c.id);
    let n = Number(c.add) || 0;
    for (const l of past) {
      if (l.id !== id) continue;
      if (c.mode === 'session' && l.at < live.since) continue;
      n += l.n || 1;
    }
    for (const l of live.loot) if (l.id === id && l.at > live.uploadedUntil) n += l.n || 1;
    out.push({ id, name: c.name, q: c.q ?? null, mode: c.mode || 'session', n });
  }
  return out;
}

// Loot from uploaded sessions as [{ at, id, name, q, n, source, session }], with `at` in server ms.
export function pastLoot(sessions, eventMs) {
  const out = [];
  for (const s of sessions) {
    let lastSources = null;
    for (const e of s.events) {
      if (e.e === 'loot_window') lastSources = e.sources || null;
      if (e.e !== 'loot' || !e.id || e.src === 'created') continue;
      const at = eventMs(s, e);
      if (at == null) continue;
      out.push({ at, id: e.id, name: e.name ?? null, q: e.q ?? null, n: e.n || 1, source: lastSources?.[0]?.name ?? null, session: s.id });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Drops between two times, grouped by item.
export function dropsBetween(loot, from, to) {
  const byItem = new Map();
  let items = 0;
  for (const l of loot) {
    if (l.at < from || l.at > to) continue;
    const d = byItem.get(l.id) || { id: l.id, name: l.name, q: l.q, n: 0, times: 0, sources: new Map(), first: l.at, last: l.at };
    d.n += l.n || 1;
    d.times++;
    items += l.n || 1;
    if (l.source) d.sources.set(l.source, (d.sources.get(l.source) || 0) + (l.n || 1));
    if (l.q != null) d.q = l.q;
    if (l.name) d.name = l.name;
    d.first = Math.min(d.first, l.at);
    d.last = Math.max(d.last, l.at);
    byItem.set(l.id, d);
  }
  const rows = [...byItem.values()].map((d) => ({ ...d, sources: [...d.sources.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })) }));
  return { rows: rows.sort((a, b) => (b.q ?? 0) - (a.q ?? 0) || b.n - a.n), items, kinds: rows.length };
}

export function randomToken() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); } }).getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
