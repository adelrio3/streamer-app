// The session overlay, re-created after the fact. During a stream the
// overlay (overlay.html) is driven live by the gaming PC; recording it in
// OBS next to a 4K60 capture costs too much. The same events, once the play
// session is uploaded, sit on the recording's timeline with exact offsets,
// so the overlay can be drawn again frame by frame on a canvas over a
// chroma-key colour and encoded to an .mp4 (WebCodecs + mp4.js) that goes
// on its own track in the Premiere sequence. The look follows overlay.css
// in its keyed mode (solid panels, no glow, motion only), the running
// totals are the live link's own LiveState, and the callouts (drops, new
// items, hunts, levels, deaths, quests, zones, streaks, session start and
// end) fire at the same moments they did on stream.

import { LiveState, STREAK_WINDOW, QUALITY_COLORS as GAME_QUALITY } from './live.js';
const QUALITY_COLORS = GAME_QUALITY.map((c, i) => (i === 2 ? '#b5f542' : c)); // uncommon green would key out

export const DESIGN_H = 1080; // everything is designed at 1080p and scaled to the frame
export const RANK_WORD = { elite: 'elite', rare: 'rare', rareelite: 'rare elite', worldboss: 'world boss' };
const QUALITY = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'];
const STREAKS = [[30, 'LEGENDARY', 'thirty kills without a pause'], [20, 'UNSTOPPABLE', 'twenty in a row'], [10, 'RAMPAGE', 'ten in a row'], [5, 'KILLING SPREE', 'five in a row']];
const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = 'Inter, system-ui, sans-serif';
const INK = '#ffffff';
const INK2 = 'rgba(255, 255, 255, .78)';
const BAR_BG = '#2a2418';
const GREEN = '#b5f542'; // a lime: the game's green sits too close to the chroma key

// Race themes as overlay.css sets them (accent, its light, the panel's near-black).
export const THEMES = {
  default: { gold: '#4f93ff', gold2: '#d6e6ff', rgb: [79, 147, 255], panel: '#0c0905', line: 'rgba(79, 147, 255, .35)' },
  Human: { gold: '#e9c467', gold2: '#fff2c4', rgb: [233, 196, 103], panel: '#0a1026', line: 'rgba(110, 150, 240, .45)' },
  Dwarf: { gold: '#e69a4c', gold2: '#ffdcae', rgb: [230, 154, 76], panel: '#1e130c', line: 'rgba(230, 154, 76, .45)' },
  NightElf: { gold: '#b8a7ff', gold2: '#ece7ff', rgb: [184, 167, 255], panel: '#0c091e', line: 'rgba(160, 140, 255, .45)' },
  Gnome: { gold: '#ff86c6', gold2: '#ffd6ea', rgb: [255, 134, 198], panel: '#160a1a', line: 'rgba(255, 134, 198, .45)' },
  Orc: { gold: '#ff6f4d', gold2: '#ffcdbb', rgb: [255, 111, 77], panel: '#1c0806', line: 'rgba(255, 111, 77, .45)' },
  Scourge: { gold: '#8dff7b', gold2: '#ddffd6', rgb: [141, 255, 123], panel: '#060e08', line: 'rgba(141, 255, 123, .4)' },
  Tauren: { gold: '#e3a457', gold2: '#ffe5bd', rgb: [227, 164, 87], panel: '#1a0e06', line: 'rgba(227, 164, 87, .45)' },
  Troll: { gold: '#52d9c8', gold2: '#cffff8', rgb: [82, 217, 200], panel: '#061214', line: 'rgba(82, 217, 200, .45)' },
};
const RACE_FX = {
  Human: { shape: 'mote', colors: ['#e9c467', '#fff7dc', '#8fb0ff'], gravity: -0.012, speed: 2.2, life: 1800, sizeMin: 1.2, sizeMax: 3, sway: 0.6 },
  Dwarf: { shape: 'ember', colors: ['#ff9a3c', '#ffd27a', '#ff5a2a'], gravity: -0.07, speed: 3.5, life: 1500, sizeMin: 1.5, sizeMax: 3.5, spread: Math.PI * 0.9 },
  NightElf: { shape: 'wisp', colors: ['#b8a7ff', '#e8dfff', '#7fe0ff'], gravity: -0.02, speed: 1.6, life: 2400, sizeMin: 5, sizeMax: 11, sway: 1.2 },
  Gnome: { shape: 'spark', colors: ['#ff86c6', '#5ff5e0', '#ffffff'], gravity: 0.03, speed: 7, life: 700, sizeMin: 2, sizeMax: 5 },
  Orc: { shape: 'ember', colors: ['#ff6f4d', '#ffb347', '#8a8a8a'], gravity: -0.05, speed: 3, life: 1600, sizeMin: 1.5, sizeMax: 4, spread: Math.PI * 1.1 },
  Scourge: { shape: 'wisp', colors: ['#8dff7b', '#3d9f35', '#c9ffc0'], gravity: -0.012, speed: 1.2, life: 2600, sizeMin: 6, sizeMax: 14, sway: 0.8 },
  Tauren: { shape: 'mote', colors: ['#e3a457', '#fff0c8', '#c9773a'], gravity: -0.006, speed: 1.6, life: 2200, sizeMin: 1.5, sizeMax: 3.5, sway: 0.4 },
  Troll: { shape: 'fly', colors: ['#52d9c8', '#e9fffb', '#b9ff6a'], gravity: -0.004, speed: 1.4, life: 2600, sizeMin: 1.5, sizeMax: 3, sway: 1.6 },
};
export const RACES = Object.keys(RACE_FX);
export function themeFor(race) {
  const r = RACES.find((x) => x.toLowerCase() === String(race || '').toLowerCase());
  return r ? { name: r, ...THEMES[r] } : { name: null, ...THEMES.default };
}

// The first time the account ever had each item or felled each creature
// (session time, seconds): an event at that very time is new to the
// compendium, which the overlay called out as NEW ITEM / FIRST HUNT.
export function firstTimes(sessions = []) {
  const items = new Map();
  const creatures = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.e === 'loot' && e.id && e.src !== 'created') { if (!items.has(e.id) || e.t < items.get(e.id)) items.set(e.id, e.t); }
      else if (e.e === 'kill' && e.name) { if (!creatures.has(e.name) || e.t < creatures.get(e.name)) creatures.set(e.name, e.t); }
    }
  }
  return { items, creatures };
}

const BIG_RANKS = new Set(['rare', 'rareelite', 'worldboss']);

// The recording's timeline (events with `offset` seconds) as the live
// link's events, `at` in ms from the recording's first frame.
export function overlayEvents(recording, timeline = [], { firsts = null, character = {}, rankOf = () => null } = {}) {
  const out = [];
  const push = (at, e) => out.push({ at: Math.max(0, Math.round(at)), ...e });
  const first = timeline[0];
  push(0, { kind: 'begin', name: character.name ?? null, realm: character.realm ?? null, level: character.level ?? first?.lvl ?? null, race: character.race ?? null, cls: character.cls ?? null });
  push(0, { kind: 'heartbeat', level: first?.lvl ?? character.level ?? null, xp: null, xpMax: null, zone: first?.z ?? character.zone ?? null, sub: first?.sz ?? null, x: null, y: null, money: first?.m ?? null, race: character.race ?? null, cls: character.cls ?? null });
  push(0, { kind: 'session', action: 'start', name: recording.name });
  let source = null;
  const raresSeen = new Set();
  for (const e of timeline) {
    const at = (e.offset || 0) * 1000;
    switch (e.e) {
      case 'loot_window': source = e.sources?.[0]?.name ?? null; break;
      case 'loot': {
        if (!e.id || ['bought', 'created', 'mail'].includes(e.src)) break;
        const novel = Boolean(firsts) && firsts.items.get(e.id) === e.t;
        push(at, { kind: 'loot', id: e.id, name: e.name ?? null, q: e.q ?? null, n: e.n || 1, source: e.src === 'received' ? null : source, novel });
        break;
      }
      case 'kill': {
        const novel = Boolean(firsts) && Boolean(e.name) && firsts.creatures.get(e.name) === e.t;
        push(at, { kind: 'kill', npcId: e.npcId ?? null, name: e.name ?? null, rank: e.rank ?? rankOf(e.name, e.npcId) ?? null, novel });
        break;
      }
      case 'quest_accept': push(at, { kind: 'quest', action: 'accept', qid: e.qid ?? null, title: e.title ?? null }); break;
      case 'quest_complete': push(at, { kind: 'quest', action: 'complete', qid: e.qid ?? null, title: e.title ?? null }); break;
      case 'quest_turnin': push(at, { kind: 'quest', action: 'turnin', qid: e.qid ?? null, title: e.title ?? null, xp: e.xp ?? null, money: e.money ?? null }); break;
      case 'quest_abandon': push(at, { kind: 'quest', action: 'abandon', qid: e.qid ?? null, title: e.title ?? null }); break;
      case 'objective': if (e.text) push(at, { kind: 'quest', action: 'progress', qid: e.qid ?? null, text: e.text }); break;
      case 'level': push(at, { kind: 'level', level: e.level }); break;
      case 'death': push(at, { kind: 'death', killer: e.killer ?? null, killerId: e.killerId ?? null }); break;
      case 'zone': push(at, { kind: 'zone', zone: e.z ?? null, sub: e.sz ?? null }); break;
      case 'explore': if (e.area) push(at, { kind: 'explore', area: e.area }); break;
      case 'money': push(at, { kind: 'money', delta: e.delta ?? 0, total: e.total ?? null }); break;
      case 'xp': push(at, { kind: 'xp', amount: e.amount ?? 0 }); break;
      case 'npc': {
        const rank = e.rank && BIG_RANKS.has(e.rank) ? e.rank : null;
        if (!rank || !e.name || raresSeen.has(e.name) || (e.react != null && e.react > 4)) break;
        raresSeen.add(e.name);
        push(at, { kind: 'rare', npcId: e.npcId ?? null, name: e.name, level: e.level ?? null, rank });
        break;
      }
      default: break;
    }
  }
  push((recording.duration || 0) * 1000, { kind: 'session', action: 'stop', name: recording.name, seconds: recording.duration || 0 });
  return out.sort((a, b) => a.at - b.at);
}

// Easing like the overlay's springs: an ease-out with a little overshoot.
function spring(p) { const q = Math.max(0, Math.min(1, p)); const c = 1.4; return 1 + (c + 1) * Math.pow(q - 1, 3) + c * Math.pow(q - 1, 2); }
function easeOut(p) { const q = Math.max(0, Math.min(1, p)); return 1 - Math.pow(1 - q, 3); }
const SHAKE = [[0, 0, 0], [0.1, -2, 0], [0.2, 4, 0], [0.3, -6, 0], [0.4, 6, 0], [0.5, -6, 0], [0.6, 6, 0], [0.7, -6, 0], [0.8, 4, 0], [0.9, -2, 0], [1, 0, 0]];
const SHAKE_BIG = [[0, 0, 0], [0.1, -3, 2], [0.2, 6, -2], [0.3, -10, 3], [0.4, 10, -3], [0.5, -10, 3], [0.6, 10, -3], [0.7, -10, 3], [0.8, 6, -2], [0.9, -3, 2], [1, 0, 0]];
function shakeAt(table, p) {
  for (let i = 1; i < table.length; i++) {
    if (p <= table[i][0]) { const [p0, x0, y0] = table[i - 1]; const [p1, x1, y1] = table[i]; const f = (p - p0) / (p1 - p0); return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; }
  }
  return [0, 0];
}

const POSITIONS = {
  tl: { x: 0.015, y: 0.125, ax: 'left', ay: 'top' },
  tc: { x: 0.5, y: 0.015, ax: 'center', ay: 'top', row: true },
  tr: { x: 0.935, y: 0.21, ax: 'right', ay: 'top' },
  ml: { x: 0.015, y: 0.13, ax: 'left', ay: 'top' },
  mr: { x: 0.935, y: 0.42, ax: 'right', ay: 'top' },
  bl: { x: 0.34, y: 0.87, ax: 'left', ay: 'bottom' },
  bc: { x: 0.5, y: 0.87, ax: 'center', ay: 'bottom' },
  br: { x: 0.935, y: 0.87, ax: 'right', ay: 'bottom' },
};
const WIDGET_ORDER = ['timer', 'toasts', 'tracker', 'counters', 'kills'];
export const DEFAULT_LAYOUT = { show: ['toasts', 'effects', 'tracker', 'counters', 'kills', 'timer', 'callouts'], toasts: 'br', tracker: 'ml', counters: 'tc', kills: 'bl', timer: 'tc' };

// The scene: feed it the events, step a virtual clock, draw frames.
export class OverlayScene {
  // width/height: the frame; layout: { show, toasts, tracker, counters, kills, timer } (the Live page's settings);
  // counters: [{ id, name, mode, base }] (base: the count before this recording, for all-time counters);
  // icons: Map(item id -> image); race: theme name; bg: chroma colour.
  constructor({ width = 1920, height = 1080, layout = {}, counters = [], icons = new Map(), race = null, bg = '#00ff00', fonts = { serif: SERIF, sans: SANS } } = {}) {
    this.width = width;
    this.height = height;
    this.k = height / DESIGN_H;
    this.W = width / this.k;
    this.H = DESIGN_H;
    this.layout = { ...DEFAULT_LAYOUT, ...layout };
    this.show = new Set(this.layout.show || DEFAULT_LAYOUT.show);
    this.counters = counters;
    this.icons = icons;
    this.theme = themeFor(race);
    this.bg = bg.startsWith('#') ? bg : `#${bg}`;
    this.fonts = fonts;
    this.live = new LiveState(0);
    this.events = [];
    this.next = 0;
    this.t = 0;
    this.toasts = []; // { e, q, born, life, gone }
    this.queue = []; // callouts waiting
    this.callout = null; // { ...spec, born, hold }
    this.parts = [];
    this.shake = null; // { at, big }
    this.bumps = new Map(); // key -> at
    this.quests = new Map(); // key -> { born, gone, bars: Map(label -> { from, to, at }) }
    this.streakLevel = 0;
    this.milestone = 0;
    this.lastSecond = -1;
    this.animUntil = 0;
    this.applied = 0;
    this.random = mulberry32(7);
    this.timers = []; // { at, fn }: effects scheduled a moment later
  }

  load(events) {
    this.events = [...events].sort((a, b) => a.at - b.at);
    this.next = 0;
  }

  // Advances to t (ms from the recording's start). Returns true when the
  // picture changed since the last step.
  step(t) {
    const prev = this.t;
    this.t = t;
    let changed = false;
    while (this.next < this.events.length && this.events[this.next].at <= t) {
      const e = this.events[this.next++];
      if (e.kind === 'session' && e.action === 'stop') Object.assign(e, { kills: this.live.kills, questsDone: this.live.questsDone, deaths: this.live.deaths });
      const before = this.live.seq;
      const at = e.at;
      // The live state sees the event; then the widgets react like the overlay's onEvent.
      const ev = { ...e, at: Math.max(1, at) };
      this.live.apply(ev);
      if (this.live.seq !== before) this.onEvent(ev);
      changed = true;
    }
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at);
      this.timers = this.timers.filter((x) => x.at > t);
      for (const x of due) x.fn();
      if (due.length) changed = true;
    }
    if (this.show.has('timer') && Math.floor(t / 1000) !== this.lastSecond) { this.lastSecond = Math.floor(t / 1000); changed = true; }
    // Streak callouts on the way up, milestones every hundred kills.
    const streak = t - (this.live.lastKillAt || 0) <= STREAK_WINDOW ? this.live.streak : 0;
    const level = STREAKS.find(([n]) => streak >= n)?.[0] ?? 0;
    if (level > this.streakLevel) { const s = STREAKS.find(([n]) => n === level); this.say('streak', s[1], s[2], 2400); this.burst({ x: this.W / 2, y: this.H * 0.3, color: '#ff9f43', n: 90, speed: 8, life: 1200 }); }
    this.streakLevel = level;
    const hundreds = Math.floor((this.live.kills || 0) / 100);
    if (this.milestone && hundreds > this.milestone) this.say('streak', `${hundreds * 100} KILLS`, 'this session', 2800);
    this.milestone = hundreds || this.milestone;
    // Toasts and callouts age; particles move.
    for (const x of this.toasts) if (!x.gone && t >= x.born + x.life) { x.gone = t; this.animUntil = Math.max(this.animUntil, t + 260); }
    this.toasts = this.toasts.filter((x) => !x.gone || t < x.gone + 250);
    if (this.callout && t >= this.callout.born + this.callout.hold + 300) this.callout = null;
    if (!this.callout && this.queue.length) { this.callout = { ...this.queue.shift(), born: t }; this.animUntil = Math.max(this.animUntil, t + this.callout.hold + 300); }
    for (const [key, q] of this.quests) if (q.gone && t > q.gone + 450) this.quests.delete(key);
    if (this.parts.length) { this.stepParts(t - prev); changed = true; }
    if (t < this.animUntil || (this.shake && t < this.shake.at + (this.shake.big ? 800 : 550))) changed = true;
    if (this.show.has('kills') && streak) changed = true; // the streak bar drains
    if (this.shake && t > this.shake.at + 800) this.shake = null;
    return changed;
  }

  onEvent(e) {
    const t = this.t;
    const accent = this.theme.gold;
    const centre = { x: this.W / 2, y: this.H * 0.3 };
    switch (e.kind) {
      case 'loot': {
        const q = Math.max(0, Math.min(6, e.q ?? 1));
        if (this.show.has('toasts')) {
          this.toasts.unshift({ e, q, born: t, life: q >= 5 ? 11000 : q >= 4 ? 8500 : q >= 3 ? 6500 : 4500, gone: 0 });
          while (this.toasts.length > 5) this.toasts.pop();
          this.animUntil = Math.max(this.animUntil, t + 500);
          // Bursts around the card come from its drawn position, once it is laid out.
          this.pendingToastFx = { q, at: t };
        }
        if (this.show.has('effects') && q >= 4) {
          const color = QUALITY_COLORS[q];
          this.shake = { at: t, big: q >= 5 };
          this.storm(color, q === 4 ? 140 : 260);
          if (q >= 5) this.later(900, () => this.storm('#ffd27a', 120));
          if (!this.show.has('toasts')) this.burst({ ...centre, y: this.H / 2, color, n: q === 4 ? 120 : 220, speed: q === 4 ? 9 : 12, life: q === 4 ? 1400 : 1800, sizeMax: q === 4 ? 5 : 7 });
        }
        if (e.novel) {
          this.say('newitem', e.name || 'New item', 'new to the compendium', 3400, { q, kicker: 'NEW ITEM', item: { id: e.id, name: e.name } });
          this.burst({ ...centre, color: QUALITY_COLORS[q], n: 60 + q * 15, speed: 6, life: 1200 });
        }
        for (const c of this.counters) if (Number(c.id) === Number(e.id)) this.bumps.set(`c${c.id}|${c.mode}`, t);
        break;
      }
      case 'kill': {
        this.bumps.set('kills', t);
        const rank = e.rank && RANK_WORD[e.rank] ? e.rank : null;
        const big = BIG_RANKS.has(rank);
        if (!e.novel && !big) break;
        const kicker = big ? (rank === 'worldboss' ? 'WORLD BOSS SLAIN' : 'RARE HUNTED') : rank === 'elite' ? 'ELITE HUNTED' : 'FIRST HUNT';
        const sub = e.novel ? `new to the bestiary${rank ? ` · ${RANK_WORD[rank]}` : ''}` : RANK_WORD[rank];
        this.say('hunt', e.name || 'Hunted', sub, big ? 3800 : 3000, { rank, kicker });
        if (big) {
          this.shake = { at: t, big: rank === 'worldboss' };
          this.burst({ ...centre, color: rank === 'worldboss' ? '#ff9f43' : '#ff6fb5', n: 140, speed: 9, life: 1500, sizeMax: 6 });
          this.later(350, () => this.burst({ ...centre, color: '#ffffff', n: 60, speed: 5, life: 1000 }));
        } else if (rank === 'elite') this.burst({ ...centre, color: '#ffd35a', n: 90, speed: 7, life: 1300 });
        else this.burst({ ...centre, color: accent, n: 50, speed: 6, life: 1100 });
        break;
      }
      case 'level': this.say('level', `LEVEL ${e.level}`, 'ding', 3600); this.burst({ ...centre, color: accent, n: 120, speed: 9, life: 1500, sizeMax: 5 }); break;
      case 'death': this.say('death', 'YOU DIED', e.killer ? `killed by ${e.killer}` : '', 3400); this.shake = { at: t, big: true }; break;
      case 'rare': this.say('rare', e.name || 'Rare', `rare spotted${e.level ? ` · level ${e.level}` : ''}`, 3200); this.burst({ x: this.W / 2, y: this.H * 0.28, color: '#ff6fb5', n: 70, speed: 7, life: 1200 }); break;
      case 'quest':
        if (e.action === 'turnin') { this.say('quest', 'QUEST COMPLETE', e.title || '', 3200); this.burst({ ...centre, color: accent, n: 80, speed: 7, life: 1300 }); }
        else if (e.action === 'accept' && !e.quiet) this.say('quest', 'NEW QUEST', e.title || '', 2400);
        break;
      case 'zone': if (e.zone) this.say('zone', e.zone, e.sub || 'entering', 2600); break;
      case 'explore': this.say('zone', e.area || 'Discovered', 'discovered', 2400); break;
      case 'session':
        if (e.action === 'start') { this.say('session', 'SESSION START', 'recording', 2600); this.burst({ ...centre, color: accent, n: 70, speed: 6, life: 1100 }); }
        else if (e.action === 'stop') { this.say('session', 'SESSION COMPLETE', `${e.kills ?? 0} kills · ${e.questsDone ?? 0} quests · ${clock(e.seconds || 0)}`, 4200); this.burst({ ...centre, color: accent, n: 120, speed: 8, life: 1500, sizeMax: 5 }); }
        break;
      default: break;
    }
  }

  say(kind, title, sub, hold, extra = {}) {
    this.raceFx(this.W / 2, this.H * 0.3, 40, 1.4);
    this.later(400, () => this.raceFx(this.W / 2, this.H * 0.3, 24, 0.8));
    if (!this.show.has('callouts')) return;
    this.queue.push({ kind, title, sub, hold, ...extra });
  }

  // Something a little later (a second burst): scheduled on the virtual clock.
  later(ms, fn) {
    this.timers.push({ at: this.t + ms, fn });
  }

  // Particles ---------------------------------------------------------------

  burst({ x, y, color, n = 30, speed = 5, life = 900, gravity = 0.05, sizeMin = 1.5, sizeMax = 4, spread = Math.PI * 2, from = -Math.PI / 2, shape = 'dot', colors = null, sway = 0 }) {
    if (!this.show.has('effects') && !this.show.has('callouts') && !this.show.has('toasts')) return;
    const r = this.random;
    for (let i = 0; i < n; i++) {
      const a = from + (r() - 0.5) * spread;
      const v = speed * (0.4 + r());
      const c = colors ? colors[Math.floor(r() * colors.length)] : color;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: life * (0.6 + r() * 0.7), color: c, size: sizeMin + r() * (sizeMax - sizeMin), gravity, shape, sway, phase: r() * Math.PI * 2 });
    }
  }
  raceFx(x, y, n = 30, scale = 1) {
    const spec = RACE_FX[this.theme.name];
    if (!spec) return false;
    this.burst({ x, y, n, ...spec, speed: spec.speed * scale, spread: spec.spread ?? Math.PI * 2 });
    return true;
  }
  storm(color, n = 160) {
    const r = this.random;
    const W = this.W; const H = this.H;
    for (let i = 0; i < n; i++) {
      const side = r();
      const x = side < 0.5 ? (r() < 0.5 ? -10 : W + 10) : r() * W;
      const y = side < 0.5 ? r() * H : (r() < 0.5 ? -10 : H + 10);
      const a = Math.atan2(H / 2 - y, W / 2 - x) + (r() - 0.5) * 0.6;
      const v = 4 + r() * 8;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 1400 + r() * 900, color, size: 2 + r() * 4, gravity: 0, shape: 'dot', sway: 0, phase: 0 });
    }
  }
  stepParts(ms) {
    const dt = Math.min(50, Math.max(0, ms)) / 16.7;
    const alive = [];
    for (const p of this.parts) {
      p.age += dt * 16.7;
      if (p.age >= p.life) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      if (p.sway) p.x += Math.sin(p.age / 260 + p.phase) * p.sway * dt;
      alive.push(p);
    }
    this.parts = alive;
  }

  // Drawing -----------------------------------------------------------------

  font(weight, size, family = 'sans', style = '') { return `${style ? `${style} ` : ''}${weight} ${size}px ${family === 'serif' ? this.fonts.serif : this.fonts.sans}`; }

  draw(ctx) {
    const { k, W, H } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.scale(k, k);
    if (this.shake) {
      const dur = this.shake.big ? 800 : 550;
      const p = (this.t - this.shake.at) / dur;
      if (p >= 0 && p <= 1) { const [dx, dy] = shakeAt(this.shake.big ? SHAKE_BIG : SHAKE, p); ctx.translate(dx, dy); }
    }
    ctx.textBaseline = 'alphabetic';
    const slots = new Map();
    for (const w of WIDGET_ORDER) {
      if (!this.show.has(w)) continue;
      const pos = POSITIONS[this.layout[w]] ? this.layout[w] : DEFAULT_LAYOUT[w];
      if (!slots.has(pos)) slots.set(pos, []);
      slots.get(pos).push(w);
    }
    for (const [pos, widgets] of slots) this.drawSlot(ctx, pos, widgets);
    if (this.callout) this.drawCallout(ctx, this.callout);
    this.drawParts(ctx);
    ctx.restore();
  }

  // A slot stacks its widgets (a row at the top centre); each widget stacks
  // its own panels. Bottom slots grow upward, right slots align right.
  drawSlot(ctx, pos, widgets) {
    const P = POSITIONS[pos];
    const gap = P.row ? 16 : 12;
    const blocks = widgets.map((w) => ({ w, items: this.measure(ctx, w) })).filter((b) => b.items.length);
    for (const b of blocks) { b.width = Math.max(...b.items.map((i) => i.w)); b.height = b.items.reduce((a, i) => a + i.h, 0) + 10 * (b.items.length - 1); }
    const total = P.row ? blocks.reduce((a, b) => a + b.width, 0) + gap * (blocks.length - 1) : blocks.reduce((a, b) => a + b.height, 0) + gap * (blocks.length - 1);
    const widest = Math.max(0, ...blocks.map((b) => b.width));
    const ox = P.x * this.W; const oy = P.y * this.H;
    let x = P.row ? (ox - total / 2) : P.ax === 'right' ? ox - widest : P.ax === 'center' ? ox - widest / 2 : ox;
    let y = P.ay === 'bottom' ? oy : oy;
    const bottomUp = P.ay === 'bottom';
    const align = (bw, iw) => (P.ax === 'right' ? bw - iw : P.ax === 'center' ? (bw - iw) / 2 : 0);
    for (const b of blocks) {
      const bx = P.row ? x : x + align(widest, b.width);
      // Items in the widget: newest first in the list; at the bottom the first item sits nearest the edge.
      let iy = bottomUp ? y : y;
      for (const it of b.items) {
        const ix = bx + (P.row ? 0 : align(b.width, it.w));
        if (bottomUp) { iy -= it.h; it.draw(ix, iy); iy -= 10; } else { it.draw(ix, iy); iy += it.h + 10; }
      }
      if (P.row) x += b.width + gap;
      else if (bottomUp) y -= b.height + gap;
      else y += b.height + gap;
    }
  }

  measure(ctx, w) {
    switch (w) {
      case 'timer': return [this.timerItem(ctx)];
      case 'toasts': return this.toastItems(ctx);
      case 'tracker': return this.trackerItems(ctx);
      case 'counters': return this.counterItems(ctx);
      case 'kills': return [this.killsItem(ctx)];
      default: return [];
    }
  }

  panel(ctx, x, y, w, h, r = 12) {
    round(ctx, x, y, w, h, r);
    ctx.fillStyle = this.theme.panel;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.theme.line;
    ctx.stroke();
  }
  text(ctx, s, x, y, { font, color = INK, align = 'left', spacing = 0, stroke = null, maxWidth = 0 } = {}) {
    ctx.font = font;
    ctx.textAlign = align;
    let str = String(s ?? '');
    if (maxWidth) str = ellipsis(ctx, str, maxWidth);
    try { ctx.letterSpacing = spacing ? `${spacing}px` : '0px'; } catch { /* older canvas */ }
    if (stroke) { ctx.lineWidth = stroke.width; ctx.strokeStyle = stroke.color; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    try { ctx.letterSpacing = '0px'; } catch { /* older canvas */ }
  }
  tw(ctx, s, font, spacing = 0) {
    ctx.font = font;
    try { ctx.letterSpacing = spacing ? `${spacing}px` : '0px'; } catch { /* older canvas */ }
    const w = ctx.measureText(String(s ?? '')).width;
    try { ctx.letterSpacing = '0px'; } catch { /* older canvas */ }
    return w;
  }
  bar(ctx, x, y, w, h, frac, colors) {
    round(ctx, x, y, w, h, h / 2); ctx.fillStyle = BAR_BG; ctx.fill();
    const f = Math.max(0, Math.min(1, frac));
    if (f <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    round(ctx, x, y, Math.max(h, w * f), h, h / 2); ctx.fillStyle = g; ctx.fill();
  }
  icon(ctx, id, name, x, y, size, color, border = 2, radius = 8) {
    round(ctx, x, y, size, size, radius);
    ctx.fillStyle = '#000'; ctx.fill();
    const img = this.icons.get(Number(id));
    if (img) { ctx.save(); round(ctx, x, y, size, size, radius); ctx.clip(); try { ctx.drawImage(img, x, y, size, size); } catch { /* not drawable */ } ctx.restore(); }
    else this.text(ctx, (name || '?')[0], x + size / 2, y + size * 0.68, { font: this.font(700, size * 0.55, 'serif'), color, align: 'center' });
    round(ctx, x, y, size, size, radius);
    ctx.lineWidth = border; ctx.strokeStyle = mix(color, '#000', 0.8); ctx.stroke();
  }
  bumpScale(key, dur = 700, peak = 1.35) {
    const at = this.bumps.get(key);
    if (at == null) return 1;
    const p = (this.t - at) / dur;
    if (p >= 1) { this.bumps.delete(key); return 1; }
    return p < 0.35 ? 1 + (peak - 1) * spring(p / 0.35) : peak - (peak - 1) * easeOut((p - 0.35) / 0.65);
  }

  timerItem(ctx) {
    const c = this.live.character || {};
    const time = hms(this.t);
    const who = [c.name ? c.name : '', c.level ? `level ${c.level}` : '', c.zone ? c.zone : ''].filter(Boolean);
    const tf = this.font(700, 30, 'serif'); const wf = this.font(500, 14);
    const tw = this.tw(ctx, time, tf);
    const nameW = c.name ? this.tw(ctx, c.name, this.font(700, 14)) : 0;
    const restW = this.tw(ctx, `${c.name ? ' · ' : ''}${who.slice(c.name ? 1 : 0).join(' · ')}`, wf);
    const w = Math.max(160, 14 + tw + 14 + nameW + restW + 14);
    const h = 10 + 30 + 7 + 5 + 10;
    return { w, h, draw: (x, y) => {
      this.panel(ctx, x, y, w, h);
      this.text(ctx, time, x + 14, y + 10 + 26, { font: tf, color: this.theme.gold2 });
      let wx = x + 14 + tw + 14;
      if (c.name) { this.text(ctx, c.name, wx, y + 10 + 24, { font: this.font(700, 14), color: INK2 }); wx += nameW; }
      this.text(ctx, `${c.name ? ' · ' : ''}${who.slice(c.name ? 1 : 0).join(' · ')}`, wx, y + 10 + 24, { font: wf, color: INK2 });
      this.bar(ctx, x + 14, y + 10 + 30 + 7, w - 28, 5, c.xpMax ? c.xp / c.xpMax : 0, ['#8f6cf0', '#c9b6f5']);
    } };
  }

  killsItem(ctx) {
    const s = this.live;
    const now = this.t;
    const streakAlive = now - (s.lastKillAt || 0) <= STREAK_WINDOW ? s.streak : 0;
    const minutes = Math.max(1, now / 60000);
    const kpm = Math.round((s.kills / minutes) * 10) / 10;
    const numF = this.font(700, 54, 'serif'); const subF = this.font(500, 13);
    const num = String(s.kills);
    const streakText = streakAlive >= 2 ? `×${streakAlive} streak` : '';
    const sub1 = `${kpm}/min · best streak ${s.bestStreak || 0}`; const sub2 = `${s.deaths || 0} death${s.deaths === 1 ? '' : 's'}`;
    const bigW = this.tw(ctx, num, numF) + (streakText ? 12 + this.tw(ctx, streakText, this.font(700, 16)) : 0);
    const subW = this.tw(ctx, sub1, subF) + 12 + this.tw(ctx, sub2, subF);
    const w = Math.max(200, 28 + Math.max(bigW, subW));
    const h = 10 + 13 + 4 + 54 + 4 + 16 + 6 + 4 + 10;
    return { w, h, draw: (x, y) => {
      this.panel(ctx, x, y, w, h);
      this.text(ctx, 'KILLS', x + 14, y + 10 + 11, { font: this.font(700, 11), color: this.theme.gold, spacing: 2 });
      const by = y + 10 + 13 + 4 + 46;
      const sc = this.bumpScale('kills');
      ctx.save(); ctx.translate(x + 14, by); ctx.scale(sc, sc); this.text(ctx, num, 0, 0, { font: numF, color: sc > 1.02 ? '#fff' : this.theme.gold2 }); ctx.restore();
      if (streakText) this.text(ctx, streakText, x + 14 + this.tw(ctx, num, numF) + 12, by, { font: this.font(700, 16), color: '#ff7c5a' });
      const sy = by + 8 + 13;
      this.text(ctx, sub1, x + 14, sy, { font: subF, color: INK2 });
      this.text(ctx, sub2, x + 14 + this.tw(ctx, sub1, subF) + 12, sy, { font: subF, color: INK2 });
      const left = streakAlive ? Math.max(0, 1 - (now - s.lastKillAt) / STREAK_WINDOW) : 0;
      this.bar(ctx, x + 14, sy + 6, w - 28, 4, left, ['#ff4d4d', '#ffb347']);
    } };
  }

  counterItems(ctx) {
    const out = [];
    for (const c of this.counters) {
      const n = (Number(c.base) || 0) + (this.live.drops.get(Number(c.id))?.n ?? 0);
      const name = c.name || `Item ${c.id}`;
      const numF = this.font(700, 30, 'serif');
      const numW = Math.max(this.tw(ctx, '00', numF), this.tw(ctx, String(n), numF));
      const nameW = Math.min(220, this.tw(ctx, name, this.font(600, 14)));
      const w = Math.max(220, 14 + 40 + 10 + nameW + 10 + numW + 14);
      const h = 10 + 40 + 10;
      out.push({ w, h, draw: (x, y) => {
        this.panel(ctx, x, y, w, h);
        this.icon(ctx, c.id, name, x + 14, y + 10, 40, this.theme.gold, 1);
        this.text(ctx, name, x + 14 + 40 + 10, y + 10 + 15, { font: this.font(600, 14), color: INK2, maxWidth: w - 14 - 40 - 10 - 10 - numW - 14 });
        this.text(ctx, c.mode === 'ongoing' ? 'ALL TIME' : 'THIS SESSION', x + 14 + 40 + 10, y + 10 + 31, { font: this.font(500, 10), color: this.theme.gold, spacing: 1.5 });
        const sc = this.bumpScale(`c${c.id}|${c.mode}`);
        ctx.save(); ctx.translate(x + w - 14, y + 10 + 31); ctx.scale(sc, sc); this.text(ctx, String(n), 0, 0, { font: numF, color: sc > 1.02 ? '#fff' : this.theme.gold2, align: 'right' }); ctx.restore();
      } });
    }
    return out;
  }

  trackerItems(ctx) {
    const now = this.t;
    const list = [...this.live.quests.values()].sort((a, b) => b.at - a.at).filter((q) => q.state === 'active' || q.state === 'complete' || (q.state === 'done' && now - q.at < 9000)).slice(0, 4);
    const keep = new Set();
    const out = [];
    for (const q of list) {
      keep.add(q.key);
      let st = this.quests.get(q.key);
      if (!st) { st = { born: now, gone: 0, bars: new Map(), state: q.state }; this.quests.set(q.key, st); this.animUntil = Math.max(this.animUntil, now + 460); }
      const objectives = Object.entries(q.objectives || {}).map(([label, o]) => ({ label, ...o }));
      const tag = q.state === 'done' ? 'COMPLETE' : q.state === 'complete' ? 'TURN IN' : (now - q.at < 6000 && objectives.length === 0 ? 'NEW QUEST' : '');
      const w = 380;
      const h = 10 + 24 + objectives.length * (7 + 17 + 4 + 5) + 10;
      const p = Math.min(1, (now - st.born) / 450);
      const dx = -30 * (1 - spring(p));
      out.push({ w, h, draw: (x, y) => {
        ctx.save(); ctx.translate(dx, 0);
        this.panel(ctx, x, y, w, h);
        const tf = this.font(700, 22, 'serif');
        const tagW = tag ? this.tw(ctx, tag, this.font(800, 10), 2) + 16 : 0;
        this.text(ctx, q.title || 'Quest', x + 14, y + 10 + 19, { font: tf, color: this.theme.gold2, maxWidth: w - 28 - (tagW ? tagW + 8 : 0) });
        if (tag) {
          const tx = x + 14 + Math.min(this.tw(ctx, q.title || 'Quest', tf), w - 28 - tagW - 8) + 8;
          round(ctx, tx, y + 10 + 4, tagW, 16, 8); ctx.fillStyle = this.theme.gold; ctx.fill();
          this.text(ctx, tag, tx + 8, y + 10 + 16, { font: this.font(800, 10), color: '#120c02', spacing: 2 });
        }
        let oy = y + 10 + 24;
        for (const o of objectives) {
          oy += 7;
          const full = o.m > 0 && o.n >= o.m;
          const key = `${q.key}|${o.label}`;
          const prevBar = st.bars.get(o.label);
          const target = o.m ? Math.min(1, o.n / o.m) : 0;
          if (!prevBar || prevBar.to !== target) { st.bars.set(o.label, { from: prevBar ? prevBar.to : 0, to: target, at: now }); this.bumps.set(key, now); this.animUntil = Math.max(this.animUntil, now + 620); }
          const b = st.bars.get(o.label);
          const frac = b.from + (b.to - b.from) * easeOut((now - b.at) / 600);
          const bump = this.bumps.has(key) ? (1 - Math.abs((now - this.bumps.get(key)) / 600 - 0.3) / 0.7) : 0;
          if (this.bumps.has(key) && now - this.bumps.get(key) > 600) this.bumps.delete(key);
          const bx = x + 14 + (bump > 0 ? 4 * bump : 0);
          this.text(ctx, o.label, bx, oy + 14, { font: this.font(500, 14), color: INK2, maxWidth: w - 28 - 60 });
          this.text(ctx, `${o.n}/${o.m}`, x + w - 14, oy + 14, { font: this.font(600, 14), color: INK, align: 'right' });
          oy += 17 + 4;
          this.bar(ctx, x + 14, oy, w - 28, 5, frac, full ? [GREEN, '#b8f0a8'] : [this.theme.gold, this.theme.gold2]);
          oy += 5;
        }
        ctx.restore();
      } });
    }
    for (const [key, st] of this.quests) if (!keep.has(key) && !st.gone) st.gone = now;
    return out;
  }

  toastItems(ctx) {
    const out = [];
    const pos = POSITIONS[this.layout.toasts] ? this.layout.toasts : 'br';
    const fromLeft = pos.endsWith('l');
    for (const x of this.toasts) {
      const e = x.e; const q = x.q;
      const color = QUALITY_COLORS[q] ?? '#fff';
      const nameF = this.font(700, 24, 'serif');
      const from = e.source ? `from ${e.source}` : QUALITY[q];
      const nW = this.tw(ctx, e.name, nameF) + (e.n > 1 ? 4 + this.tw(ctx, `×${e.n}`, this.font(600, 15)) : 0);
      const w = Math.max(300, Math.min(460, 10 + 56 + 12 + Math.max(nW, this.tw(ctx, from, this.font(500, 13))) + 16));
      const h = 76;
      const age = this.t - x.born;
      let scale = 1; let dx = 0;
      if (x.gone) scale = 1 - 0.5 * easeOut((this.t - x.gone) / 250);
      else if (age < 450) { const p = spring(age / 450); scale = 0.9 + 0.1 * p; dx = (fromLeft ? -60 : 60) * (1 - p); }
      out.push({ w, h, draw: (px, py) => {
        if (this.pendingToastFx && this.pendingToastFx.at === x.born) {
          const fx = this.pendingToastFx; this.pendingToastFx = null;
          const cx = px + 36; const cy = py + h / 2;
          if (fx.q === 2) this.burst({ x: cx, y: cy, color, n: 14, speed: 3, life: 700 });
          if (fx.q === 3) this.burst({ x: cx, y: cy, color, n: 50, speed: 6, life: 1000 });
          if (fx.q === 4) this.burst({ x: cx, y: cy, color, n: 90, speed: 8, life: 1300 });
          if (fx.q >= 5) this.burst({ x: cx, y: cy, color, n: 140, speed: 10, life: 1600, sizeMax: 6 });
          this.raceFx(px + w / 2, cy, 10 + fx.q * 8, 1);
          if (fx.q >= 3) this.later(500, () => this.raceFx(px + w / 2, cy, 8 + fx.q * 4, 0.7));
        }
        ctx.save();
        ctx.translate(px + w / 2 + dx, py + h / 2); ctx.scale(scale, scale); ctx.translate(-(px + w / 2), -(py + h / 2));
        round(ctx, px, py, w, h, 12); ctx.fillStyle = this.theme.panel; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = mix(color, this.theme.panel, 0.55); ctx.stroke();
        ctx.save(); round(ctx, px, py, w, h, 12); ctx.clip(); ctx.fillStyle = color; ctx.fillRect(px, py, 4, h); ctx.restore();
        this.icon(ctx, e.id, e.name, px + 10, py + 10, 56, color, 2, 8);
        this.text(ctx, e.name, px + 10 + 56 + 12, py + 10 + 24, { font: nameF, color, maxWidth: w - 10 - 56 - 12 - 16 - (e.n > 1 ? 40 : 0) });
        if (e.n > 1) this.text(ctx, `×${e.n}`, px + 10 + 56 + 12 + Math.min(this.tw(ctx, e.name, nameF), w - 10 - 56 - 12 - 16 - 40) + 4, py + 10 + 24, { font: this.font(600, 15), color: INK });
        this.text(ctx, from, px + 10 + 56 + 12, py + 10 + 24 + 3 + 14, { font: this.font(500, 13), color: INK2, maxWidth: w - 10 - 56 - 12 - 16 });
        if (q >= 4) {
          const tag = QUALITY[q].toUpperCase();
          const tw = this.tw(ctx, tag, this.font(800, 11), 2.75) + 20;
          round(ctx, px + 14, py - 12, tw, 18, 9); ctx.fillStyle = color; ctx.fill();
          this.text(ctx, tag, px + 24, py + 1, { font: this.font(800, 11), color: '#120c02', spacing: 2.75 });
        }
        ctx.restore();
      } });
    }
    return out;
  }

  drawCallout(ctx, c) {
    const age = this.t - c.born;
    const th = this.theme;
    let scale = 1; let dy = 0;
    if (age < 500) scale = 0.7 + 0.3 * spring(age / 500);
    else if (age > c.hold) { const p = easeOut((age - c.hold) / 300); scale = 1 - 0.25 * p; dy = -30 * p; }
    const kicks = { death: ['#ff5a5a', 72], rare: ['#ff6fb5', 72], streak: ['#ff9f43', 84], quest: [th.gold2, 56], zone: [th.gold2, 48], level: [th.gold2, 96], session: [th.gold2, 60], newitem: [th.gold2, 56], hunt: [th.gold2, 64] };
    let [color, size] = kicks[c.kind] || [th.gold2, 72];
    let kickerColor = INK2;
    if (c.kind === 'newitem') color = { 2: '#b5f542', 3: '#4aa3ff', 4: '#c76bff', 5: '#ff8000' }[c.q] || th.gold2;
    if (c.kind === 'hunt') {
      if (c.rank === 'elite') { color = '#ffd35a'; kickerColor = '#ffd35a'; }
      else if (c.rank === 'rare' || c.rank === 'rareelite') { color = '#ff6fb5'; kickerColor = '#ff6fb5'; size = 80; }
      else if (c.rank === 'worldboss') { color = '#ff9f43'; kickerColor = '#ff9f43'; size = 92; }
    }
    const weight = c.kind === 'zone' ? 600 : 700;
    const spacing = c.kind === 'session' ? size * 0.08 : size * 0.02;
    const cx = this.W / 2; let y = this.H * 0.18;
    ctx.save();
    ctx.translate(cx, y + 60); ctx.scale(scale, scale); ctx.translate(-cx, -(y + 60) + dy);
    const stroke = { width: 1.5, color: th.panel };
    if (c.kicker) { this.text(ctx, c.kicker, cx, y + 20, { font: this.font(700, 20), color: kickerColor, align: 'center', spacing: 6, stroke: { width: 1, color: th.panel } }); y += 20 + 8; }
    if (c.item) { this.icon(ctx, c.item.id, c.item.name, cx - 44, y, 88, color, 3, 12); y += 88 + 10; }
    this.text(ctx, c.title, cx, y + size * 0.8, { font: this.font(weight, size, 'serif'), color, align: 'center', spacing, stroke, maxWidth: this.W * 0.8 });
    y += size;
    if (c.sub) this.text(ctx, String(c.sub).toUpperCase(), cx, y + 6 + 16, { font: this.font(600, 18), color: INK2, align: 'center', spacing: 1.5, stroke: { width: 1, color: th.panel }, maxWidth: this.W * 0.8 });
    ctx.restore();
  }

  drawParts(ctx) {
    for (const p of this.parts) {
      const t = 1 - p.age / p.life;
      let alpha = Math.min(1, t * 1.4);
      if (p.shape === 'fly') alpha *= 0.35 + 0.65 * Math.max(0, Math.sin(p.age / 140 + p.phase));
      if (p.shape === 'fly' && alpha < 0.5) continue; // lit or not: no half-tones over the key colour
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      ctx.beginPath();
      const r = p.size * (0.5 + t * 0.5);
      if (p.shape === 'ember') { ctx.ellipse(p.x, p.y, r * 1.8, r * 0.7, Math.atan2(p.vy, p.vx), 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === 'spark') { ctx.lineWidth = Math.max(1, r * 0.6); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke(); }
      else { ctx.arc(p.x, p.y, p.shape === 'wisp' ? r * 0.35 : r, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function round(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
function ellipsis(ctx, s, maxWidth) {
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0; let hi = s.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxWidth) lo = mid; else hi = mid; }
  return `${s.slice(0, lo)}…`;
}
function hex(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) { const p = r[1].split(',').map(Number); return [p[0], p[1], p[2]]; }
  return [255, 255, 255];
}
// color-mix(in srgb, a f, b): f of a, the rest b.
function mix(a, b, f) {
  const A = hex(a); const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v * f + B[i] * (1 - f))).join(', ')})`;
}
export function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function clock(sec) {
  const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

// H.264 level for the frame size and rate (what the encoder is asked for).
export function avcCodec(width, height, fps) {
  const rate = width * height * fps;
  if (rate <= 1920 * 1080 * 30) return 'avc1.640028'; // High 4.0
  if (rate <= 1920 * 1080 * 60) return 'avc1.64002a'; // High 4.2
  if (rate <= 3840 * 2160 * 30) return 'avc1.640033'; // High 5.1
  return 'avc1.640034'; // High 5.2
}
export function bitrateFor(width, height, fps) {
  // An overlay is mostly one flat colour: modest rates keep the text crisp.
  const px = width * height;
  return Math.round((px >= 3840 * 2160 ? 24e6 : px >= 2560 * 1440 ? 14e6 : 8e6) * (fps > 30 ? 1.4 : 1));
}

// Renders the scene to an .mp4 through the sink, faster than real time
// where the encoder allows. Browser only (canvas, VideoEncoder, VideoFrame).
export async function renderOverlayVideo({ scene, fps = 30, seconds, sink, canvas, onProgress = null, signal = null, keyEvery = 2, codec = null, Mp4Writer, VideoEncoderClass = globalThis.VideoEncoder, VideoFrameClass = globalThis.VideoFrame }) {
  const { width, height } = scene;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const timescale = 90000;
  const sampleDur = timescale / fps;
  const writer = new Mp4Writer(sink, { width, height, timescale });
  await writer.start();
  let pending = Promise.resolve();
  let failed = null;
  const encoder = new VideoEncoderClass({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description) writer.setDescription(meta.decoderConfig.description);
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      pending = pending.then(() => writer.addSample(bytes, { key: chunk.type === 'key', duration: sampleDur })).catch((err) => { failed = err; });
    },
    error: (err) => { failed = err; },
  });
  const base = { codec: codec || avcCodec(width, height, fps), width, height, framerate: fps, bitrate: bitrateFor(width, height, fps), latencyMode: 'quality', ...(codec && !codec.startsWith('avc1') ? {} : { avc: { format: 'avc' } }) };
  let config = { ...base, hardwareAcceleration: 'prefer-hardware' };
  try { if (!(await VideoEncoderClass.isConfigSupported(config)).supported) config = base; } catch { config = base; }
  try { if (!(await VideoEncoderClass.isConfigSupported(config)).supported) throw new Error(`This browser cannot encode ${width}×${height} at ${fps} fps (${config.codec}).`); } catch (err) { encoder.close(); throw err; }
  encoder.configure(config);
  const frames = Math.max(1, Math.round(seconds * fps));
  const startedAt = Date.now();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { encoder.close(); throw new Error('Cancelled'); }
    if (failed) { encoder.close(); throw failed; }
    const t = (i * 1000) / fps;
    const dirty = scene.step(t);
    if (dirty || i === 0) scene.draw(ctx);
    const frame = new VideoFrameClass(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * keyEvery)) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await settle(encoder);
    if (i % 8 === 0) await yieldNow();
    if (onProgress && i % fps === 0) onProgress({ frame: i, frames, seconds: i / fps, elapsed: (Date.now() - startedAt) / 1000 });
  }
  await encoder.flush();
  encoder.close();
  await pending;
  if (failed) throw failed;
  const out = await writer.finish();
  onProgress?.({ frame: frames, frames, seconds, elapsed: (Date.now() - startedAt) / 1000, done: true });
  return out;
}

// A turn of the event loop that background tabs do not throttle to once a second.
function yieldNow() {
  return new Promise((res) => {
    if (typeof MessageChannel === 'undefined') { setTimeout(res, 0); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); res(); };
    ch.port2.postMessage(0);
  });
}
function settle(encoder) {
  return new Promise((res) => {
    if (typeof encoder.addEventListener === 'function') encoder.addEventListener('dequeue', res, { once: true });
    else setTimeout(res, 4);
  });
}
