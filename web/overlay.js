// The stream overlay (overlay.html), an OBS browser source. Every second it
// reads what the gaming PC wrote to the cloud (the `live` row, found through
// the token in the address) and shows what is new: drop toasts with icons and
// effects by quality, a quest tracker that fills in as objectives update,
// item counters, kills and streaks, deaths, levels, and the session timer.
// ?demo=1 plays a script of fake events for setting things up.

import { fetchLiveByToken } from './lib/cloud.js';
import { LiveState, STREAK_WINDOW } from './lib/live.js';

const params = new URLSearchParams(location.search);
const token = params.get('token');
const demo = params.get('demo') === '1';
const show = new Set((params.get('show') || 'toasts,tracker,counters,kills,timer,callouts').split(',').filter(Boolean));
const replay = params.get('replay') === '1';
const debug = params.get('debug') === '1';
const POS = { toasts: 'br', tracker: 'tl', counters: 'tr', kills: 'bl', timer: 'bc' };
for (const k of Object.keys(POS)) POS[k] = params.get(k) || POS[k];
document.documentElement.style.setProperty('--scale', String(Number(params.get('scale')) || 1));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const QUALITY = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'];
const QCOLOR = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80'];
const STREAKS = [[30, 'LEGENDARY', 'thirty kills without a pause'], [20, 'UNSTOPPABLE', 'twenty in a row'], [10, 'RAMPAGE', 'ten in a row'], [5, 'KILLING SPREE', 'five in a row']];

for (const [k, el] of Object.entries({ toasts: $('toasts'), tracker: $('tracker'), counters: $('counters'), kills: $('kills'), timer: $('timer') })) {
  el.className = `widget pos-${POS[k]}`;
  el.hidden = !show.has(k);
}
const icons = () => setTimeout(() => window.$WowheadPower?.refreshLinks?.(), 40);

// Particles ------------------------------------------------------------------

const fx = $('fx');
const ctx = fx.getContext('2d');
let parts = [];
let running = false;
function size() { fx.width = innerWidth; fx.height = innerHeight; }
size();
addEventListener('resize', size);

function burst({ x, y, color, n = 30, speed = 5, life = 900, gravity = 0.05, sizeMin = 1.5, sizeMax = 4, spread = Math.PI * 2, from = -Math.PI / 2 }) {
  for (let i = 0; i < n; i++) {
    const a = from + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: life * (0.6 + Math.random() * 0.7), color, size: sizeMin + Math.random() * (sizeMax - sizeMin), gravity, spin: Math.random() * 6 });
  }
  if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
}
function storm(color, n = 160) {
  for (let i = 0; i < n; i++) {
    const side = Math.random();
    const x = side < 0.5 ? (Math.random() < 0.5 ? -10 : innerWidth + 10) : Math.random() * innerWidth;
    const y = side < 0.5 ? Math.random() * innerHeight : (Math.random() < 0.5 ? -10 : innerHeight + 10);
    const cx = innerWidth / 2; const cy = innerHeight / 2;
    const a = Math.atan2(cy - y, cx - x) + (Math.random() - 0.5) * 0.6;
    const v = 4 + Math.random() * 8;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 1400 + Math.random() * 900, color, size: 2 + Math.random() * 4, gravity: 0, spin: Math.random() * 6 });
  }
  if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
}
let last = 0;
function step(now) {
  const dt = Math.min(50, now - last) / 16.7;
  last = now;
  ctx.clearRect(0, 0, fx.width, fx.height);
  const alive = [];
  for (const p of parts) {
    p.age += dt * 16.7;
    if (p.age >= p.life) continue;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
    const t = 1 - p.age / p.life;
    ctx.globalAlpha = Math.min(1, t * 1.4);
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2);
    ctx.fill();
    alive.push(p);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  parts = alive;
  if (parts.length) requestAnimationFrame(step); else { running = false; ctx.clearRect(0, 0, fx.width, fx.height); }
}

function flash(color) {
  const f = $('flash');
  f.style.setProperty('--fc', color);
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}
function shake(big) {
  document.body.classList.remove('shake', 'big');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  if (big) document.body.classList.add('big');
  setTimeout(() => document.body.classList.remove('shake', 'big'), big ? 900 : 600);
}

// Toasts ---------------------------------------------------------------------

function itemIcon(id, name) {
  return `<div class="ticon"><span class="fallback">${esc((name || '?')[0])}</span><a href="https://www.wowhead.com/classic/item=${Number(id) || 0}" data-wh-icon-size="large" data-wh-rename-link="false"></a></div>`;
}

function toast(e) {
  if (!show.has('toasts')) return;
  const q = Math.max(0, Math.min(6, e.q ?? 1));
  const el = document.createElement('div');
  el.className = `toast q${q}`;
  el.innerHTML = `${q >= 4 ? `<div class="tag">${QUALITY[q].toUpperCase()}</div>` : ''}${q >= 5 ? '<div class="rays"></div>' : ''}${q >= 3 ? '<div class="ring"></div>' : ''}
    ${itemIcon(e.id, e.name)}
    <div class="ttext"><div class="tname">${esc(e.name)}${e.n > 1 ? `<span class="tn">×${e.n}</span>` : ''}</div><div class="tfrom">${e.source ? `from ${esc(e.source)}` : QUALITY[q]}</div></div>`;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 5) box.lastElementChild.remove();
  requestAnimationFrame(() => {
    el.classList.add('in');
    const r = el.getBoundingClientRect();
    const x = r.left + 36; const y = r.top + r.height / 2;
    const color = QCOLOR[q];
    if (q === 2) burst({ x, y, color, n: 14, speed: 3, life: 700 });
    if (q === 3) burst({ x, y, color, n: 50, speed: 6, life: 1000 });
    if (q === 4) { flash(color); shake(false); burst({ x, y, color, n: 90, speed: 8, life: 1300 }); storm(color, 140); }
    if (q >= 5) { flash(color); shake(true); burst({ x, y, color, n: 140, speed: 10, life: 1600, sizeMax: 6 }); storm(color, 260); setTimeout(() => storm('#ffd27a', 120), 900); }
  });
  icons();
  const life = q >= 5 ? 11000 : q >= 4 ? 8500 : q >= 3 ? 6500 : 4500;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, life);
}

// Callouts -------------------------------------------------------------------

const queue = [];
let showing = false;
function callout(kind, title, sub, hold = 2600) {
  if (!show.has('callouts')) return;
  queue.push({ kind, title, sub, hold });
  pump();
}
function pump() {
  if (showing || !queue.length) return;
  showing = true;
  const c = queue.shift();
  const el = document.createElement('div');
  el.className = `callout ${c.kind}`;
  el.innerHTML = `<div class="ctitle">${esc(c.title)}</div>${c.sub ? `<div class="csub">${esc(c.sub)}</div>` : ''}`;
  $('callouts').append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); showing = false; pump(); }, 450);
  }, c.hold);
}

// Widgets --------------------------------------------------------------------

const questEls = new Map();
function renderTracker(quests, now) {
  const box = $('tracker');
  const keep = new Set();
  const list = (quests || []).filter((q) => q.state === 'active' || q.state === 'complete' || (q.state === 'done' && now - q.at < 9000)).slice(0, 4);
  for (const q of list) {
    keep.add(q.key);
    let el = questEls.get(q.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'quest panel';
      el.dataset.state = '';
      el.innerHTML = '<div class="qtitle"><span class="t"></span><span class="qtag" hidden></span></div><div class="objs"></div>';
      box.append(el);
      questEls.set(q.key, el);
      requestAnimationFrame(() => el.classList.add('in'));
    }
    el.querySelector('.t').textContent = q.title || 'Quest';
    const tag = el.querySelector('.qtag');
    const state = q.state === 'done' ? 'done' : q.state === 'complete' ? 'ready' : (now - q.at < 6000 && Object.keys(q.objectives || {}).length === 0 ? 'new' : '');
    if (el.dataset.state !== q.state) {
      el.classList.toggle('done', q.state === 'done');
      el.classList.toggle('ready', q.state === 'complete');
      el.dataset.state = q.state;
    }
    tag.hidden = !state;
    tag.textContent = state === 'done' ? 'Complete' : state === 'ready' ? 'Ready to turn in' : 'New quest';
    const objs = el.querySelector('.objs');
    for (const o of q.objectives || []) {
      const key = o.label;
      let line = [...objs.children].find((c) => c.dataset.key === key);
      if (!line) {
        line = document.createElement('div');
        line.className = 'obj';
        line.dataset.key = key;
        line.innerHTML = '<div class="oline"><span class="ol"></span><span class="on"></span></div><div class="bar"><div></div></div>';
        objs.append(line);
      }
      const text = `${o.n}/${o.m}`;
      const numEl = line.querySelector('.on');
      line.querySelector('.ol').textContent = key;
      if (numEl.textContent !== text) {
        numEl.textContent = text;
        line.querySelector('.bar > div').style.width = `${o.m ? Math.min(100, (o.n / o.m) * 100) : 0}%`;
        line.classList.toggle('full', o.m > 0 && o.n >= o.m);
        line.classList.remove('bump');
        void line.offsetWidth;
        line.classList.add('bump');
      }
    }
  }
  for (const [key, el] of questEls) {
    if (keep.has(key)) continue;
    el.classList.add('gone');
    questEls.delete(key);
    setTimeout(() => el.remove(), 450);
  }
}

const counterEls = new Map();
function renderCounters(counters) {
  const box = $('counters');
  const keep = new Set();
  for (const c of counters || []) {
    const key = `${c.id}|${c.mode}`;
    keep.add(key);
    let el = counterEls.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'counter panel';
      el.innerHTML = `${itemIcon(c.id, c.name)}<div class="cname">${esc(c.name || `Item ${c.id}`)}<div class="cmode">${c.mode === 'ongoing' ? 'all time' : 'this session'}</div></div><div class="cnum">0</div>`;
      box.append(el);
      counterEls.set(key, el);
      icons();
    }
    const num = el.querySelector('.cnum');
    const text = String(c.n ?? 0);
    if (num.textContent !== text) {
      num.textContent = text;
      num.classList.remove('bump');
      void num.offsetWidth;
      num.classList.add('bump');
    }
  }
  for (const [key, el] of counterEls) if (!keep.has(key)) { el.remove(); counterEls.delete(key); }
}

let prevKills = null;
function renderKills(s, now) {
  const box = $('kills');
  if (!box.firstChild) box.innerHTML = '<div class="panel"><div class="label">Kills</div><div class="big"><span class="num">0</span><span class="streak"></span></div><div class="sub"><span class="rate"></span><span class="deaths"></span></div><div class="sbar"><div></div></div></div>';
  const num = box.querySelector('.num');
  if (num.textContent !== String(s.kills)) {
    num.textContent = String(s.kills);
    num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
  }
  const streakAlive = now - (s.lastKillAt || 0) <= STREAK_WINDOW ? s.streak : 0;
  box.querySelector('.streak').textContent = streakAlive >= 2 ? `×${streakAlive} streak` : '';
  box.querySelector('.rate').textContent = `${s.killsPerMinute ?? 0}/min · best streak ${s.bestStreak || 0}`;
  box.querySelector('.deaths').textContent = `${s.deaths || 0} death${s.deaths === 1 ? '' : 's'}`;
  const left = streakAlive ? Math.max(0, 1 - (now - s.lastKillAt) / STREAK_WINDOW) : 0;
  box.querySelector('.sbar > div').style.transform = `scaleX(${left.toFixed(3)})`;
  prevKills = s.kills;
}

let clockBase = null;
function renderTimer(s) {
  const box = $('timer');
  if (!box.firstChild) box.innerHTML = '<div class="panel"><div class="row"><span class="time">00:00:00</span><span class="who"></span></div><div class="xp"><div></div></div></div>';
  const c = s.character || {};
  box.querySelector('.who').innerHTML = `${c.name ? `<b>${esc(c.name)}</b>` : ''}${c.level ? ` · level ${c.level}` : ''}${c.zone ? ` · ${esc(c.zone)}` : ''}`;
  box.querySelector('.xp > div').style.width = c.xpMax ? `${Math.min(100, (c.xp / c.xpMax) * 100)}%` : '0%';
  clockBase = { since: s.since, at: s.at, local: Date.now() };
}
function tickTimer() {
  if (!clockBase || !show.has('timer')) return;
  const el = $('timer').querySelector('.time');
  if (!el) return;
  const ms = Math.max(0, clockBase.at - clockBase.since + (Date.now() - clockBase.local));
  const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const sec = Math.floor((ms % 60000) / 1000);
  el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
setInterval(tickTimer, 1000);
setInterval(() => { if (lastSnap && show.has('kills')) renderKills(lastSnap, serverNow()); }, 250);

// Events ---------------------------------------------------------------------

let lastSeq = replay ? 0 : null;
let lastSnap = null;
let prevStreakLevel = 0;
let questsDoneSeen = null;
let killsMilestone = 0;
const serverNow = () => (lastSnap ? lastSnap.at + (Date.now() - lastSnapLocal) : Date.now());
let lastSnapLocal = Date.now();

function onEvent(e) {
  switch (e.kind) {
    case 'loot': toast(e); break;
    case 'level': callout('level', `LEVEL ${e.level}`, 'ding', 3600); flash('#f2cc6b'); burst({ x: innerWidth / 2, y: innerHeight * 0.3, color: '#f2cc6b', n: 120, speed: 9, life: 1500, sizeMax: 5 }); break;
    case 'death': callout('death', 'YOU DIED', e.killer ? `killed by ${e.killer}` : '', 3400); flash('#ff2a2a'); shake(true); break;
    case 'rare': callout('rare', e.name || 'Rare', `rare spotted${e.level ? ` · level ${e.level}` : ''}`, 3200); burst({ x: innerWidth / 2, y: innerHeight * 0.28, color: '#ff6fb5', n: 70, speed: 7, life: 1200 }); break;
    case 'quest':
      if (e.action === 'turnin') { callout('quest', 'QUEST COMPLETE', e.title || '', 3200); burst({ x: innerWidth / 2, y: innerHeight * 0.3, color: '#f2cc6b', n: 80, speed: 7, life: 1300 }); }
      else if (e.action === 'accept') callout('quest', 'NEW QUEST', e.title || '', 2400);
      break;
    case 'zone': if (e.zone) callout('zone', e.zone, e.sub || 'entering', 2600); break;
    case 'explore': callout('zone', e.area || 'Discovered', 'discovered', 2400); break;
    case 'skill': break;
    default: break;
  }
}

function handle(snap) {
  lastSnap = snap;
  lastSnapLocal = Date.now();
  const now = snap.at || Date.now();
  if (lastSeq === null) lastSeq = snap.seq || 0;
  const fresh = (snap.events || []).filter((e) => e.seq > lastSeq).sort((a, b) => a.seq - b.seq);
  for (const e of fresh) onEvent(e);
  if (fresh.length) lastSeq = fresh.at(-1).seq;
  // Streak callouts on the way up, milestones every hundred kills.
  const streak = now - (snap.lastKillAt || 0) <= STREAK_WINDOW ? snap.streak : 0;
  const level = STREAKS.find(([n]) => streak >= n)?.[0] ?? 0;
  if (level > prevStreakLevel) { const s = STREAKS.find(([n]) => n === level); callout('streak', s[1], s[2], 2400); burst({ x: innerWidth / 2, y: innerHeight * 0.3, color: '#ff9f43', n: 90, speed: 8, life: 1200 }); }
  prevStreakLevel = level;
  const hundreds = Math.floor((snap.kills || 0) / 100);
  if (killsMilestone && hundreds > killsMilestone) callout('streak', `${hundreds * 100} KILLS`, 'this session', 2800);
  killsMilestone = hundreds || killsMilestone;
  if (show.has('tracker')) renderTracker(snap.quests, now);
  if (show.has('counters')) renderCounters(snap.counters);
  if (show.has('kills')) renderKills(snap, now);
  if (show.has('timer')) renderTimer(snap);
}

// Data -----------------------------------------------------------------------

async function config() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) { const c = await r.json(); if (c.url && c.anonKey) return c; }
  } catch { /* not on Netlify */ }
  try { return JSON.parse(localStorage.getItem('chronicler.supabase') || 'null'); } catch { return null; }
}

function status(text) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('show', Boolean(text) && debug);
}

async function poll(cfg) {
  try {
    const data = await fetchLiveByToken(cfg.url, cfg.anonKey, token);
    if (data?.state) {
      handle(data.state);
      const age = Date.now() - Date.parse(data.updated_at);
      status(age > 90000 ? `gaming PC last seen ${Math.round(age / 60000)} min ago` : '');
    } else status('no live data for this token yet');
  } catch (err) {
    status(err.message);
  }
  setTimeout(() => poll(cfg), 1000);
}

// Demo: a script of fake events, so the overlay can be laid out without playing.
function runDemo() {
  const live = new LiveState(Date.now() - 754000);
  live.apply({ at: Date.now() - 754000, kind: 'begin', name: 'Aldric', realm: 'Mankrik', level: 11 });
  live.apply({ at: Date.now() - 700000, kind: 'heartbeat', level: 11, xp: 1450, xpMax: 2800, zone: 'Elwynn Forest', sub: 'Goldshire', x: 42, y: 65, money: 12345 });
  live.apply({ at: Date.now() - 600000, kind: 'quest', action: 'accept', qid: 176, title: 'Wanted: "Hogger"' });
  live.apply({ at: Date.now() - 500000, kind: 'quest', action: 'accept', qid: 62, title: 'The Fargodeep Mine' });
  live.apply({ at: Date.now() - 400000, kind: 'quest', action: 'progress', text: 'Kobold Worker slain: 3/10' });
  for (let i = 0; i < 14; i++) live.apply({ at: Date.now() - 300000 + i * 3000, kind: 'kill', npcId: 257, name: 'Kobold Worker' });
  live.apply({ at: Date.now() - 200000, kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 2, source: 'Kobold Worker' });
  const counters = () => [
    { id: 2589, name: 'Linen Cloth', mode: 'session', n: live.drops.get(2589)?.n ?? 0 },
    { id: 1121, name: 'Feet of the Lynx', mode: 'ongoing', n: 3 + (live.drops.get(1121)?.n ?? 0) },
  ];
  const script = [
    { kind: 'kill', npcId: 448, name: 'Hogger' },
    { kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 3, source: 'Hogger' },
    { kind: 'quest', action: 'progress', text: 'Kobold Worker slain: 4/10' },
    { kind: 'loot', id: 1121, name: 'Feet of the Lynx', q: 2, n: 1, source: 'Hogger' },
    { kind: 'kill', npcId: 257, name: 'Kobold Worker' }, { kind: 'kill', npcId: 257, name: 'Kobold Worker' }, { kind: 'kill', npcId: 257, name: 'Kobold Worker' },
    { kind: 'quest', action: 'progress', text: 'Kobold Worker slain: 7/10' },
    { kind: 'loot', id: 2244, name: 'Krol Blade', q: 3, n: 1, source: 'Kobold Worker' },
    { kind: 'kill', npcId: 257, name: 'Kobold Worker' }, { kind: 'kill', npcId: 257, name: 'Kobold Worker' },
    { kind: 'rare', npcId: 471, name: 'Mother Fang', level: 10, rank: 'rare' },
    { kind: 'kill', npcId: 471, name: 'Mother Fang' },
    { kind: 'loot', id: 871, name: 'Flurry Axe', q: 4, n: 1, source: 'Mother Fang' },
    { kind: 'quest', action: 'progress', text: 'Kobold Worker slain: 10/10' },
    { kind: 'quest', action: 'complete', qid: 62, title: 'The Fargodeep Mine' },
    { kind: 'quest', action: 'turnin', qid: 62, title: 'The Fargodeep Mine', xp: 450, money: 900 },
    { kind: 'level', level: 12 },
    { kind: 'heartbeat', level: 12, xp: 120, xpMax: 3200, zone: 'Elwynn Forest', sub: 'Goldshire', x: 42, y: 65, money: 13245 },
    { kind: 'loot', id: 17182, name: 'Sulfuras, Hand of Ragnaros', q: 5, n: 1, source: 'Ragnaros' },
    { kind: 'zone', zone: 'Westfall', sub: 'Sentinel Hill' },
    { kind: 'quest', action: 'accept', qid: 11, title: 'Riverpaw Gnoll Bounty' },
    { kind: 'death', killer: 'Hogger', killerId: 448 },
  ];
  let i = 0;
  const push = () => {
    live.apply({ at: Date.now(), ...script[i % script.length] });
    i++;
    const snap = live.snapshot(Date.now());
    snap.counters = counters();
    handle(snap);
    setTimeout(push, script[(i) % script.length]?.kind === 'kill' ? 1300 : 2800);
  };
  const first = live.snapshot(Date.now());
  first.counters = counters();
  handle(first);
  setTimeout(push, 1200);
}

(async () => {
  if (demo) { runDemo(); return; }
  if (!token) { status('add ?token=… from Chronicler › Live overlay'); return; }
  const cfg = await config();
  if (!cfg) { status('no Supabase connection (open the app on this computer once)'); return; }
  poll(cfg);
})();
