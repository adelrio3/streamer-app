// Chronicler web app. Plain modules, no build step. Data lives in Supabase;
// each computer does its part in the background (see lib/machine.js).

import { CloudStore } from './lib/cloud.js';
import { Machine } from './lib/machine.js';
import { buildCodex } from './lib/codex.js';
import { describe, category } from './lib/describe.js';
import { clockModel, resolveRecordings, buildTimelines, eventMs } from './lib/timeline.js';
import { toSRT, toCSV, toChapters, toKillsCSV, toFCPXML, lifetimeKillsBefore, stem } from './lib/exports.js';
import { foldersSupported } from './lib/folders.js';
import { buildWorld } from './lib/world.js';
import { buildCharacters, recordingCharacters } from './lib/journey.js';
import { findSegments, findHighlights, HIGHLIGHT_KINDS, timeOfDay, parsePoint } from './lib/footage.js';
import { buildIndex, search } from './lib/search.js';
import { tooltipLine } from './lib/sessions.js';
import { money, RANKS, qualityName } from './lib/describe.js';
import { ROLE_NAMES } from './lib/world.js';
import { buildMaps, routesFor, cluster, LAYERS, mapImageCandidates, heatCells, questTrail, nearestServices, toGeoJSON } from './lib/maps.js';
import { looseEnds } from './lib/coverage.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('status');

const CATS = ['quest', 'lore', 'combat', 'loot', 'mark', 'travel', 'progress', 'world', 'economy', 'character', 'social'];
const CAT_NAMES = { quest: 'Quests', lore: 'Lore', combat: 'Combat', loot: 'Loot', mark: 'Marks', travel: 'Travel', progress: 'Progress', world: 'NPCs seen', economy: 'Vendors & gold', character: 'Character', social: 'Social' };
// Busy categories start switched off in timelines and exports.
const QUIET_CATS = new Set(['travel', 'world', 'economy', 'character', 'social']);
const CLASS_COLORS = { WARRIOR: '#c69b6d', PALADIN: '#f48cba', HUNTER: '#aad372', ROGUE: '#fff468', PRIEST: '#ffffff', SHAMAN: '#0070dd', MAGE: '#3fc7eb', WARLOCK: '#8788ee', DRUID: '#ff7c0a', DEATHKNIGHT: '#c41e3a', MONK: '#00ff98', DEMONHUNTER: '#a330c9', EVOKER: '#33937f' };
const REACTION = { 1: 'Hated', 2: 'Hostile', 3: 'Unfriendly', 4: 'Neutral', 5: 'Friendly', 6: 'Honored', 7: 'Revered', 8: 'Exalted' };
const MARK_NAMES = { lore: 'Lore beat', shot: 'Beautiful shot', funny: 'Funny', redo: 'Redo', mark: 'Mark' };
const WOWHEAD = { classic: 'https://www.wowhead.com/classic', tbc: 'https://www.wowhead.com/tbc', wrath: 'https://www.wowhead.com/wotlk', cata: 'https://www.wowhead.com/cata', mop: 'https://www.wowhead.com/mop-classic' };

// sessions: from the addon; rows: recording rows; clock: clock samples.
const state = {
  client: null, store: null, user: null, machine: null, sessions: [], rows: [], clock: [], settings: {}, cache: null,
  items: [], screenshots: [], schema2: true, tracks: null, shotUrls: new Map(),
};
let status = {};

// Helpers -----------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

// Everything computed from the raw data, rebuilt only after a change.
function derived() {
  if (!state.cache) {
    const clock = clockModel(state.clock);
    const recordings = resolveRecordings(state.rows);
    // Marks you deleted stay in the addon's log; they are hidden here.
    const gone = new Set(state.settings.deletedMarks || []);
    const sessions = gone.size ? state.sessions.map((sess) => ({ ...sess, events: sess.events.filter((e) => e.e !== 'mark' || !gone.has(markKey(sess.id, e))) })) : state.sessions;
    const timelines = buildTimelines(sessions, recordings, clock);
    const where = new Map();
    for (const [rec, events] of timelines) for (const e of events) where.set(`${e.session}|${e.t}`, { rec, offset: e.offset });
    const codex = buildCodex(sessions, (sid, t) => where.get(`${sid}|${t}`) ?? null);
    const moment = (sess, e) => ({ session: sess.id, t: e.t, footage: where.get(`${sess.id}|${e.t}`) ?? null, m: e.m ?? null, x: e.x ?? null, y: e.y ?? null, z: e.z ?? null, sz: e.sz ?? null });
    const world = buildWorld(sessions, state.items, moment);
    const characters = buildCharacters(sessions, moment, timelines, recordings);
    const recChars = recordingCharacters(sessions, timelines);
    const maps = buildMaps(sessions, world, codex, moment);
    state.cache = { sessions, clock, recordings, timelines, where, codex, moment, world, characters, recChars, maps, index: null };
  }
  return state.cache;
}

async function codex() {
  return derived().codex;
}

// Identifies one mark for deletion, even if two were logged in the same frame.
function markKey(sessionId, m) {
  return `${sessionId}|${m.t}|${m.kind ?? ''}|${m.note ?? ''}`;
}

function invalidate() {
  state.cache = null;
}

const settings = () => ({ fps: 60, width: 1920, height: 1080, cueSeconds: 3, ...state.settings });

function tc(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function when(t) {
  return new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function duration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function play(m) {
  if (!m?.footage) return '<span class="muted small" title="Nothing was recording at this moment">no footage</span>';
  return `<a class="btn play" href="#/recording/${m.footage.rec}?t=${m.footage.offset.toFixed(2)}" title="${esc(when(m.t))}">▶ ${tc(m.footage.offset)}</a>`;
}

function firstFootage(moments = []) {
  return moments.find((m) => m.footage) || moments[0];
}

function wowhead(kind, id) {
  if (!id) return '';
  const base = WOWHEAD[state.sessions.at(-1)?.expansion] || 'https://www.wowhead.com';
  return `<a class="small" href="${base}/${kind}=${id}" target="_blank" rel="noopener">Wowhead ↗</a>`;
}

const wowheadBase = () => WOWHEAD[state.sessions.at(-1)?.expansion] || 'https://www.wowhead.com';

// An item: its icon (from Wowhead, with Wowhead's tooltip on hover) and its
// name linking to its page here.
function itemLink(id, name, quality, { size = 'small', count } = {}) {
  if (!id) return esc(name ?? '');
  const info = derived().world.byItem.get(Number(id));
  const q = quality ?? info?.quality ?? 1;
  const label = name ?? info?.name ?? `Item ${id}`;
  return `<span class="item"><a class="wh" href="${wowheadBase()}/item=${id}" target="_blank" rel="noopener" data-wh-icon-size="${size}" data-wh-rename-link="false" aria-label="Wowhead">&#8203;</a><a class="q${q}" href="#/item/${id}">${esc(label)}</a>${count > 1 ? ` <span class="muted">x${count}</span>` : ''}</span>`;
}

function npcLink(key, name) {
  return key ? `<a href="#/npc/${enc(key)}">${esc(name ?? 'Unknown')}</a>` : esc(name ?? '');
}

function levelText(n) {
  if (n.minLevel == null) return n.ranks.includes('skull') ? '??' : '';
  return n.minLevel === n.maxLevel ? String(n.minLevel) : `${n.minLevel}–${n.maxLevel}`;
}

function rankChips(ranks = []) {
  return ranks.filter((r) => r !== 'skull').map((r) => `<span class="chip ${r.includes('rare') || r === 'worldboss' ? 'active' : ''}">${esc(RANKS[r] ?? r)}</span>`).join(' ');
}

// Page furniture -----------------------------------------------------------

function pageHead(kicker, title, lead = '', extra = '') {
  return `<header class="page">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${extra}</header>`;
}

function crumb(href, label) {
  return `<a class="crumb" href="${href}">← ${esc(label)}</a>`;
}

// tabs: [[key, label, count?]]; current: the active key; base: '#/page?show='
function tabsHtml(tabs, current, base) {
  return `<div class="tabs">${tabs.map(([k, label, n]) => `<a class="tab ${k === current ? 'active' : ''}" href="${base}${k}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</div>`;
}

function facts(parts) {
  return `<p class="facts">${parts.filter(Boolean).join('<span class="sep">·</span>')}</p>`;
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function coords(x, y) {
  return x == null ? '' : `<span class="muted small">${Number(x).toFixed(1)}, ${Number(y).toFixed(1)}</span>`;
}

function lore(text) {
  return text ? `<div class="lore">${esc(text).replace(/\$[Nn]/g, '<i>&lt;name&gt;</i>').replace(/\$[Cc]/g, '<i>&lt;class&gt;</i>').replace(/\$[Rr]/g, '<i>&lt;race&gt;</i>').replace(/\$[Bb]/g, '\n')}</div>` : '';
}

// A sortable, searchable table. columns: { label, value(row), html(row), num }
function table(rows, columns, { search = (r) => JSON.stringify(r), sort = 0, desc = false, limit = 400, empty = 'Nothing here yet.', card = null } = {}) {
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  let state = { q: '', sort, desc, limit };
  const render = () => {
    const q = state.q.toLowerCase();
    let list = q ? rows.filter((r) => search(r).toLowerCase().includes(q)) : rows.slice();
    const col = columns[state.sort];
    if (col?.value) {
      list.sort((a, b) => {
        const x = col.value(a); const y = col.value(b);
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
        return state.desc ? -c : c;
      });
    }
    const shown = list.slice(0, state.limit);
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('.count').textContent = `${list.length} of ${rows.length}`;
    if (card) {
      // Card mode: the sort menu replaces the column headers.
      el.querySelector('.sorter').innerHTML = columns.map((c, i) => `<option value="${i}" ${i === state.sort ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
      el.querySelector('.cardgrid').innerHTML = shown.length
        ? shown.map((r, i) => `<div class="hcard" style="--i:${Math.min(i, 30)}">${card(r)}</div>`).join('')
        : `<div class="empty">${esc(empty)}</div>`;
    } else {
      el.querySelector('thead').innerHTML = `<tr>${columns.map((c, i) => `<th class="${c.num ? 'num' : ''}" data-i="${i}">${esc(c.label)}${i === state.sort ? (state.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>`;
      el.querySelector('tbody').innerHTML = shown.length
        ? shown.map((r, i) => `<tr style="--i:${Math.min(i, 40)}">${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.value(r))}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="muted">${esc(empty)}</td></tr>`;
    }
    el.querySelector('.more').hidden = list.length <= state.limit;
    setTimeout(() => window.$WowheadPower?.refreshLinks?.(), 30);
  };
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('input').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
    el.querySelector('.sorter')?.addEventListener('change', (ev) => { state = { ...state, sort: Number(ev.target.value) }; render(); });
    el.querySelector('.dir')?.addEventListener('click', () => { state = { ...state, desc: !state.desc }; render(); });
    el.querySelector('thead')?.addEventListener('click', (ev) => {
      const i = Number(ev.target.closest('th')?.dataset.i);
      if (Number.isNaN(i)) return;
      state = { ...state, desc: state.sort === i ? !state.desc : Boolean(columns[i].num), sort: i };
      render();
    });
    el.querySelector('.more').addEventListener('click', () => { state.limit += 400; render(); });
    render();
  });
  if (card) {
    return `<div id="${id}"><div class="toolbar"><input type="search" placeholder="Search…"><span class="muted small count"></span><span style="margin-left:auto" class="row"><span class="muted small">Sort</span><select class="sorter"></select><button class="ghost dir" title="Reverse order">⇅</button></span></div>
      <div class="cardgrid"></div><p><button class="more" hidden>Show more</button></p></div>`;
  }
  return `<div id="${id}"><div class="toolbar"><input type="search" placeholder="Search…"><span class="muted small count"></span></div>
    <div class="scroll"><table><thead></thead><tbody></tbody></table></div><p><button class="more" hidden>Show more</button></p></div>`;
}

// Status bar ----------------------------------------------------------------

function renderStatus() {
  const m = state.machine;
  if (!m) { statusEl.innerHTML = ''; return; }
  const pills = [`<span class="pill" title="This computer">${esc(m.name)}</span>`];
  if (m.config.plays) {
    const ok = m.wow.state === 'ok';
    pills.push(`<a class="pill" href="#/setup" title="${ok ? 'Watching the addon log' : 'Set up the WoW folder'}"><span class="dot ${ok ? 'ok' : 'bad'}"></span>WoW</a>`);
  }
  if (m.config.records && m.config.obs.enabled) {
    const o = m.obsStatus;
    const dot = o.state === 'connected' ? (o.recording ? 'live' : 'ok') : 'bad';
    pills.push(`<a class="pill" href="#/setup" title="${esc(o.error || '')}"><span class="dot ${dot}"></span>OBS ${o.recording ? 'recording' : o.state === 'connected' ? '' : esc(o.state)}</a>`);
  }
  if (m.offset != null) pills.push(`<span class="pill" title="This computer's clock compared with the shared server clock">clock ${m.offset >= 0 ? '+' : '−'}${Math.abs(m.offset / 1000).toFixed(2)}s</span>`);
  statusEl.innerHTML = pills.join('');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'notice toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// Pages ---------------------------------------------------------------------

const pages = {};

pages[''] = async () => {
  const c = await codex();
  const d = derived();
  const t = c.totals;
  const m = state.machine;
  const needsSetup = m.config.fresh || (m.config.plays && m.wow.state !== 'ok') || (m.config.records && m.rec.state !== 'ok');
  const feed = activityFeed(12);
  const manifest = await fetch('addon/manifest.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const installed = m.wow.installs?.map((i) => i.addonVersion).filter(Boolean)[0];
  const lastSession = state.sessions.at(-1);
  const unsynced = d.recordings.filter((r) => r.source === 'filename' && (d.timelines.get(r.id) || []).length).length;
  const health = [
    ['This computer', esc(m.name)],
    m.config.plays ? ['WoW folder', m.wow.state === 'ok' ? '<span class="dot ok"></span> watching' : `<a href="#/setup">set up</a>`] : null,
    m.config.plays && manifest ? ['Addon', installed ? (installed === manifest.version ? `<span class="dot ok"></span> ${esc(installed)}` : `<a href="#/setup">update to ${esc(manifest.version)}</a>`) : `<a href="#/setup">install</a>`] : null,
    m.config.records ? ['OBS', m.obsStatus.state === 'connected' ? `<span class="dot ${m.obsStatus.recording ? 'live' : 'ok'}"></span> ${m.obsStatus.recording ? 'recording' : 'connected'}` : `<a href="#/setup">${esc(m.obsStatus.state)}</a>`] : null,
    ['Last session', lastSession ? esc(when(lastSession.events.at(-1)?.t ?? lastSession.started)) : '<span class="muted">none yet</span>'],
    ['Recordings', `${d.recordings.length}${unsynced ? ` · <a href="#/recordings">${unsynced} not synced</a>` : ''}`],
    ['Database', state.schema2 ? '<span class="dot ok"></span> up to date' : '<a href="#/setup">needs update</a>'],
  ].filter(Boolean);
  return `
    ${needsSetup ? `<div class="notice">This computer (<b>${esc(m.name)}</b>) isn't fully set up yet. <a href="#/setup">Open This computer</a> to finish.</div>` : ''}
    ${pageHead('Chronicle', 'Overview', 'What you have seen, done and recorded so far.')}
    ${activityChart()}
    <div class="cards">
      ${card(t.quests, 'quests completed', '#/quests')}
      ${card(t.kills, 'creatures slain', '#/bestiary')}
      ${card(d.world.creatures.length, 'creatures met', '#/bestiary')}
      ${card(d.world.people.length, 'people met', '#/people')}
      ${card(d.world.items.length, 'items catalogued', '#/items')}
      ${card(d.maps.length, 'maps explored', '#/locations')}
      ${card(d.recordings.length, 'recordings', '#/recordings')}
      ${card(t.marks, 'marked moments', '#/marks')}
    </div>
    <div class="two">
      <div>
        <h2 style="margin-top:0">Characters</h2>
        ${d.characters.length ? `<div class="cards" style="margin-top:8px">${d.characters.map(charCard).join('')}</div>` : empty('No sessions yet. With the app open on your gaming PC, log in to WoW and then log out or type <code>/reload</code>.')}
        <h2>Recent activity</h2>
        ${feed.length ? `<div class="feed">${feed.map((f) => `<div class="row"><span class="when">${esc(when(f.t))}</span><span>${f.html}</span><span style="margin-left:auto">${play(f)}</span></div>`).join('')}</div>` : empty('Milestones appear here as you play.')}
      </div>
      <div class="panel">
        <h3>Status</h3>
        <div class="health">${health.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><span>${v}</span></div>`).join('')}</div>
      </div>
    </div>`;
};

// Events per day for the last five weeks, as thin gold bars. One series, so
// the title names it and no legend is needed; each bar carries a tooltip.
function activityChart() {
  const days = 35;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const counts = new Array(days).fill(0);
  for (const s of state.sessions) {
    for (const e of s.events) {
      const d = Math.floor((today.getTime() - new Date(e.t * 1000).setHours(0, 0, 0, 0)) / 86400000);
      if (d >= 0 && d < days) counts[days - 1 - d]++;
    }
  }
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const W = 700;
  const H = 72;
  const gap = 2;
  const bw = (W - gap * (days - 1)) / days;
  const busiest = counts.indexOf(max);
  const bars = counts.map((n, i) => {
    const h = n ? Math.max(3, (n / max) * (H - 18)) : 1.5;
    const x = i * (bw + gap);
    const date = new Date(today.getTime() - (days - 1 - i) * 86400000);
    return `<g class="bar" style="--i:${i}"><title>${esc(date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}: ${n} events</title>
      <rect x="${x.toFixed(1)}" y="${(H - 4 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${n ? 'var(--gold)' : 'var(--line-2)'}" opacity="${n ? (0.55 + 0.45 * n / max).toFixed(2) : 1}"/>
      ${i === busiest ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - 8 - h).toFixed(1)}" text-anchor="middle" class="bar-label">${n}</text>` : ''}
      <rect x="${x.toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}" fill="transparent"/></g>`;
  }).join('');
  return `<div class="panel activity"><div class="row spread"><h3>Activity, last five weeks</h3><span class="muted small">${total.toLocaleString()} events logged</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Events per day for the last ${days} days">${bars}</svg>
    <div class="row spread muted small"><span>${esc(new Date(today.getTime() - (days - 1) * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><span>today</span></div></div>`;
}

// The latest milestones across every character.
function activityFeed(limit) {
  const rows = [];
  for (const c of derived().characters) {
    for (const r of journeyRows(c)) rows.push({ ...r, html: `<b>${esc(c.name)}</b> · ${r.html}` });
  }
  return rows.sort((a, b) => b.t - a.t).slice(0, limit);
}

function card(n, label, href) {
  return `<a class="card" href="${href}"><div class="num" data-n="${Number(n) || 0}">${Number(n).toLocaleString()}</div><div class="lbl">${esc(label)}</div></a>`;
}

// Numbers in stat cards count up when a page appears.
function animateNumbers(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of root.querySelectorAll('.num[data-n]')) {
    const target = Number(el.dataset.n);
    if (!target) continue;
    const start = performance.now();
    const dur = 650 + Math.min(600, Math.log10(target + 1) * 150);
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

pages.quests = async () => {
  const c = await codex();
  return `${pageHead('Chronicle', 'Quests', 'Every quest you have been offered, accepted or turned in, with the text exactly as you read it.')}
    ${table(c.quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title ?? `Quest ${q.qid}`)}</a>` },
      { label: 'Zone', value: (q) => q.zone },
      { label: 'Giver', value: (q) => q.giver?.name ?? '' },
      { label: 'By', value: (q) => (q.characters || []).map((k) => k.split('-')[0]).join(', ') },
      { label: 'Lvl', value: (q) => q.level ?? 0, html: (q) => q.level ?? '', num: true },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { search: (q) => `${q.title} ${q.zone} ${q.giver?.name} ${q.text}`, sort: 5, empty: 'No quests logged yet.' })}`;
};

pages.quest = async (key) => {
  const c = await codex();
  if (!state.tracks && state.schema2) { try { state.tracks = await state.store.loadTracks(); } catch { state.tracks = new Map(); } }
  const q = c.quests.find((x) => x.key === key);
  if (!q) return '<p>Quest not found.</p>';
  const moments = [
    ...q.offered.map((m) => ['Offered', m]), ...q.accepted.map((m) => ['Accepted', m]),
    ...q.turnedIn.map((m) => ['Turned in', m]), ...q.abandoned.map((m) => ['Abandoned', m]),
  ].sort((a, b) => a[1].t - b[1].t);
  return `${crumb('#/quests', 'Quests')}
    ${pageHead('Quest', esc(q.title ?? `Quest ${q.qid}`), '', `<div class="row"><span class="chip ${q.status}">${q.status}</span>${wowhead('quest', q.qid)}</div>`)}
    ${facts([esc(q.zone ?? ''), q.giver ? `from <a href="#/npc/${enc(q.giver.npcId ? `n${q.giver.npcId}` : `s${q.giver.name}`)}">${esc(q.giver.name)}</a>` : '', q.turnInNpc && q.turnInNpc.name !== q.giver?.name ? `turn in to ${esc(q.turnInNpc.name)}` : '', q.level ? `accepted at level ${q.level}` : '', (q.characters || []).length ? `by ${esc(q.characters.map((k) => k.split('-')[0]).join(', '))}` : '', q.qid ? `ID ${q.qid}` : ''])}
    <div class="panel"><h3>Moments</h3><table><tbody>${moments.map(([what, m]) => `<tr><td>${esc(what)}</td><td>${play(m)}</td><td class="muted">${esc(when(m.t))}</td></tr>`).join('')}</tbody></table></div>
    ${questWhere(q)}
    ${q.text ? `<h3>Description</h3>${lore(q.text)}` : ''}
    ${q.objectives ? `<h3>Objectives</h3>${lore(q.objectives)}` : ''}
    ${q.progress ? `<h3>Progress</h3>${lore(q.progress)}` : ''}
    ${q.reward ? `<h3>Completion</h3>${lore(q.reward)}` : ''}`;
};

// Bestiary: things you can fight -------------------------------------------

// The quest's map: pickup, objective progress, kills while active, turn-in.
function questWhere(q) {
  const d = derived();
  const trail = questTrail(q, d.sessions, state.tracks, d.moment);
  if (!trail || !trail.mapId) return '';
  const pin = (mo, layer, label, extra = {}) => (mo?.x != null && mo.m === trail.mapId ? [{ x: mo.x, y: mo.y, zone: mo.z, sub: mo.sz, session: mo.session, t: mo.t, footage: mo.footage, layer, label, ...extra }] : []);
  const markers = [
    ...q.offered.flatMap((mo) => pin(mo, 'quest', `Offered: ${q.title}`, { key: 'offer' })),
    ...q.accepted.flatMap((mo) => pin(mo, 'quest', `Accepted: ${q.title}`, { key: 'accept' })),
    ...trail.objectives.flatMap((o) => pin(o, 'mark', o.text, { key: `o${o.text}` })),
    ...trail.killSpots.map((k) => ({ x: k.x, y: k.y, session: k.session, t: k.t, footage: k.footage, layer: 'creature', label: k.name, key: `k${k.npcId ?? k.name}`, href: `#/npc/${enc(k.npcId ? `n${k.npcId}` : `s${k.name}`)}` })),
    ...q.turnedIn.flatMap((mo) => pin(mo, 'quest', `Turned in: ${q.title}`, { key: 'turnin' })),
  ];
  const zoneName = d.maps.find((m) => m.id === trail.mapId)?.zone ?? `Map ${trail.mapId}`;
  setTimeout(() => {
    wireMap('questMap', trail.mapId, markers, { routes: trail.routes, heat: { density: heatCells(trail.killSpots, 3) }, hidden: new Set(['density']) });
    document.getElementById('questGeo')?.addEventListener('click', () => download(`${(q.title ?? 'quest').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.geojson`, 'application/geo+json', JSON.stringify(toGeoJSON({ name: q.title, mapId: trail.mapId, zone: zoneName, markers, routes: trail.routes }), null, 1)));
  });
  const at = (mo) => (mo?.x != null ? `${coords(mo.x, mo.y)}${mo.sz ? ` <span class="muted small">${esc(mo.sz)}</span>` : ''}` : '<span class="muted small">no position</span>');
  return `<h2>Where</h2>
    ${facts([`<a href="#/map/${trail.mapId}">${esc(zoneName)}</a>`, q.accepted[0] ? `picked up at ${at(q.accepted[0])}` : q.offered[0] ? `offered at ${at(q.offered[0])}` : '', q.turnedIn[0] ? `turned in at ${at(q.turnedIn[0])}` : '', trail.minutes != null ? `${trail.minutes} min from pickup to turn-in` : '', '<button class="ghost small" id="questGeo">Download GeoJSON</button>'])}
    <div class="filters" id="mapLayers">${['quest', 'creature', 'mark', 'route', 'density'].map((k) => `<label><input type="checkbox" value="${k}" ${k === 'density' ? '' : 'checked'}><span class="cat" style="background:${LAYERS[k].color}"></span>${k === 'mark' ? 'Objective progress' : k === 'creature' ? 'Kills while active' : k === 'density' ? 'Kill density' : LAYERS[k].name}</label>`).join('')}</div>
    <div class="map-wrap"><div class="map" id="questMap"></div><div class="map-info panel" id="mapInfo">
      ${trail.kills.length ? `<h3>Killed while active</h3>${trail.kills.slice(0, 12).map((k) => `<div class="row spread"><a href="#/npc/${enc(k.npcId ? `n${k.npcId}` : `s${k.name}`)}">${esc(k.name)}</a><b>${k.n}</b></div>`).join('')}` : '<p class="muted">Click a pin.</p>'}
    </div></div>
    ${trail.objectives.length ? table(trail.objectives, [
      { label: 'Progress', value: (o) => o.text },
      { label: 'Where', value: (o) => o.sz ?? '', html: (o) => `${esc(o.sz ?? o.z ?? '')} ${coords(o.x, o.y)}` },
      { label: 'Footage', value: (o) => o.footage?.offset ?? -1, html: (o) => play(o) },
    ], { sort: 2, limit: 100 }) : ''}`;
}

pages.creatures = (_, params) => pages.bestiary(_, params);
pages.npcs = (_, params) => pages.people(_, params);
pages.creature = (key) => pages.npc(key);

function creatureColumns() {
  return [
    { label: 'Creature', value: (n) => n.name, html: (n) => `${npcLink(n.key, n.name)}${n.rare ? ' <span class="chip active">rare</span>' : ''}` },
    { label: 'Level', value: (n) => n.minLevel ?? 0, html: (n) => `${levelText(n)} ${rankChips(n.ranks.filter((r) => r !== 'rare' || !n.rare))}` },
    { label: 'Type', value: (n) => [n.ctype, n.family].filter(Boolean).join(' · ') },
    { label: 'Seen', value: (n) => n.sightings, num: true },
    { label: 'Kills', value: (n) => n.kills, num: true },
    { label: 'Loots', value: (n) => n.loots, num: true },
    { label: 'Drops', value: (n) => n.drops.length, html: (n) => n.drops.slice(0, 3).map((d) => itemLink(d.id, d.name)).join(' ') + (n.drops.length > 3 ? ` <span class="muted">+${n.drops.length - 3}</span>` : ''), num: true },
    { label: 'Zones', value: (n) => n.zones.join(', ') },
    { label: 'First seen', value: (n) => n.first?.t ?? 0, html: (n) => (n.first ? play(n.first) : '') },
  ];
}

pages.bestiary = async (_, params) => {
  const { world } = derived();
  const show = params.get('show') || 'all';
  const zone = params.get('zone') || '';
  const filters = {
    all: () => true, killed: (n) => n.kills > 0, unkilled: (n) => n.kills === 0,
    rare: (n) => n.rare || n.ranks.some((r) => r.includes('rare') || r === 'worldboss'), elite: (n) => n.ranks.includes('elite') || n.ranks.includes('rareelite'),
    killers: (n) => n.killedYou > 0,
  };
  let list = world.creatures.filter(filters[show] ?? filters.all);
  if (zone) list = list.filter((n) => n.zones.includes(zone));
  const count = (k) => world.creatures.filter(filters[k]).length;
  const zones = [...new Set(world.creatures.flatMap((n) => n.zones))].sort();
  setTimeout(() => document.getElementById('zoneSel')?.addEventListener('change', (ev) => { location.hash = `#/bestiary?show=${show}${ev.target.value ? `&zone=${enc(ev.target.value)}` : ''}`; }));
  return `${pageHead('World', 'Bestiary', 'Every creature you can fight: seen on a nameplate, targeted, fought near, killed or looted. Drop rates come from your own loot windows.')}
    <div class="row spread">
      ${tabsHtml([['all', 'All', world.creatures.length], ['killed', 'Killed', count('killed')], ['unkilled', 'Not yet killed', count('unkilled')], ['rare', 'Rares', count('rare')], ['elite', 'Elites', count('elite')], ['killers', 'Killed you', count('killers')]], show, '#/bestiary?show=')}
      <select id="zoneSel"><option value="">All zones</option>${zones.map((z) => `<option ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
    </div>
    ${table(list, creatureColumns(), { search: (n) => `${n.name} ${n.ctype} ${n.family} ${n.zones.join(' ')} ${n.ranks.join(' ')} ${n.drops.map((d) => d.name).join(' ')}`, sort: 4, desc: true, empty: 'No creatures yet. They appear as you fight, target and loot.' })}`;
};

// People: everyone you deal with rather than fight ----------------------------

pages.vendors = (_, params) => pages.people(_, new URLSearchParams('show=vendor'));

pages.people = async (_, params) => {
  const { world } = derived();
  const show = params.get('show') || 'all';
  const list = show === 'all' ? world.people : world.people.filter((n) => n.roles.includes(show));
  const count = (k) => world.people.filter((n) => n.roles.includes(k)).length;
  return `${pageHead('World', 'People', 'Everyone you have talked to, bought from, trained with or passed by: quest givers, vendors, trainers, flight masters and the townsfolk in between.')}
    ${tabsHtml([['all', 'Everyone', world.people.length], ['quest', 'Quest givers', count('quest')], ['vendor', 'Vendors', count('vendor')], ['trainer', 'Trainers', count('trainer')], ['taxi', 'Flight masters', count('taxi')], ['innkeeper', 'Innkeepers', count('innkeeper')], ['talker', 'Just talked', count('talker')], ['other', 'Passed by', count('other')]], show, '#/people?show=')}
    ${table(list, [
      { label: 'Name', value: (n) => n.name, html: (n) => `${npcLink(n.key, n.name)} ${n.titles[0] ? `<span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>` : ''}` },
      { label: 'Role', value: (n) => n.roles.join(' '), html: (n) => n.roles.filter((r) => r !== 'other').map((r) => `<span class="chip">${esc(ROLE_NAMES[r])}</span>`).join(' ') },
      { label: 'Zone', value: (n) => n.zones.join(', ') },
      { label: 'Quests', value: (n) => n.quests.size, num: true },
      { label: 'Lines', value: (n) => n.lines.length, num: true },
      { label: 'Sells', value: (n) => n.vendor?.items.length ?? 0, html: (n) => (n.vendor ? n.vendor.items.length : ''), num: true },
      { label: 'Seen', value: (n) => n.sightings, num: true },
      { label: 'First seen', value: (n) => n.first?.t ?? 0, html: (n) => (n.first ? play(n.first) : '') },
    ], { search: (n) => `${n.name} ${n.titles.join(' ')} ${n.roles.join(' ')} ${n.zones.join(' ')} ${n.lines.map((l) => l.text).join(' ')}`, sort: 7, desc: true, empty: 'Nobody yet.' })}`;
};

// One NPC, creature or object -------------------------------------------------

pages.npc = async (key) => {
  const { world, codex } = derived();
  const n = world.byNpc.get(key);
  if (!n) return '<p>Not found.</p>';
  const quests = [...n.quests].map((qk) => codex.quests.find((q) => q.key === qk)).filter(Boolean);
  const kicker = n.object ? 'Object' : n.attackable ? 'Creature' : n.roles.filter((r) => r !== 'other' && r !== 'talker').map((r) => ROLE_NAMES[r]).join(' · ') || 'Person';
  const back = n.object ? ['#/items?show=objects', 'Herbs, ore & chests'] : n.attackable ? ['#/bestiary', 'Bestiary'] : ['#/people', 'People'];
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  const byMap = new Map();
  for (const sp of n.spots) { if (!byMap.has(sp.m)) byMap.set(sp.m, []); byMap.get(sp.m).push(sp); }
  const mapId = [...byMap.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const onMap = n.spots.filter((sp) => sp.m === mapId);
  if (mapId) setTimeout(() => wireMap('npcMap', mapId, onMap.map((sp) => ({ ...sp, layer: n.object ? 'object' : n.attackable ? 'creature' : 'person', label: n.name, sub2: sp.kind, key: n.key })), { routes: false, heat: n.attackable ? { density: heatCells(onMap, 3) } : {} }));
  return `${crumb(back[0], back[1])}
    ${pageHead(kicker, `${esc(n.name)}${n.titles[0] ? ` <span class="muted" style="font-size:.55em;font-family:var(--sans);font-weight:400">&lt;${esc(n.titles.join('> <'))}&gt;</span>` : ''}`, '', `<div class="row">${wowhead(n.object ? 'object' : 'npc', n.npcId)}</div>`)}
    ${facts([levelText(n) && `Level ${levelText(n)}`, rankChips(n.ranks), [n.ctype, n.family].filter(Boolean).join(' · '), n.react ? REACTION[n.react] : '', esc(n.faction ?? ''), n.hp ? `${n.hp.toLocaleString()} health` : '', esc(n.zones.join(', ')), n.npcId ? `ID ${n.npcId}` : ''])}
    <div class="cards">
      ${card(n.sightings, 'times seen', '#/bestiary')}${n.attackable || n.kills ? card(n.kills, 'killed', '#/bestiary?show=killed') : ''}${n.loots ? card(n.loots, 'looted', '#/items') : ''}${n.killedYou ? card(n.killedYou, 'times it killed you', '#/highlights?kind=death') : ''}${n.quests.size ? card(n.quests.size, 'quests', '#/quests') : ''}
    </div>
    <div class="row">${n.first ? `First seen ${play(n.first)}` : ''} ${n.firstKill ? `First kill ${play(n.firstKill)}` : ''}</div>
    ${section('Drops', n.drops.length ? `<p class="muted small">From ${n.loots} loot${n.loots === 1 ? '' : 's'}${n.moneyDrops ? `, dropped coins ${n.moneyDrops} time${n.moneyDrops === 1 ? '' : 's'}` : ''}.</p>` + table(n.drops, [
      { label: 'Item', value: (d) => d.name, html: (d) => itemLink(d.id, d.name) },
      { label: 'Times', value: (d) => d.times, num: true },
      { label: 'Total', value: (d) => d.qty, num: true },
      { label: 'Drop rate', value: (d) => d.rate ?? 0, html: (d) => (d.rate != null ? `${Math.round(d.rate * 100)}%` : ''), num: true },
    ], { sort: 1, desc: true }) : '')}
    ${section('For sale', n.vendor ? vendorTable(n.vendor) : '')}
    ${section('Trains', n.trainer ? `${n.trainer.greeting ? lore(n.trainer.greeting) : ''}` + table(n.trainer.services, [
      { label: 'Skill', value: (x) => x.name, html: (x) => `${esc(x.name)} ${x.rank ? `<span class="muted">${esc(x.rank)}</span>` : ''}` },
      { label: 'Level', value: (x) => x.level ?? 0, num: true },
      { label: 'Cost', value: (x) => x.cost ?? 0, html: (x) => (x.cost ? money(x.cost) : ''), num: true },
      { label: 'Status', value: (x) => x.status },
    ], { sort: 1 }) : '')}
    ${section('Flights', n.taxi ? table(n.taxi.nodes, [
      { label: 'Destination', value: (x) => x.name },
      { label: 'Cost', value: (x) => x.cost ?? 0, html: (x) => (x.cost ? money(x.cost) : ''), num: true },
      { label: 'Known', value: (x) => x.type, html: (x) => (x.type === 'CURRENT' ? 'You are here' : x.type === 'REACHABLE' ? 'Yes' : 'Not yet') },
    ], { sort: 0 }) : '')}
    ${section('Quests', quests.length ? `<ul>${quests.map((q) => `<li><a href="#/quest/${enc(q.key)}">${esc(q.title)}</a> <span class="chip ${q.status}">${q.status}</span></li>`).join('')}</ul>` : '')}
    ${section('Dialogue', n.lines.map((l) => `<div class="row"><span class="chip">${esc(l.kind)}</span>${play(firstFootage(l.moments))}${l.moments.length > 1 ? `<span class="muted small">heard ${l.moments.length}×</span>` : ''}</div>${lore(l.text)}`).join(''))}
    ${section('Where', n.spots.length ? `${mapId ? `${n.attackable && onMap.length > 2 ? `<div class="filters" id="mapLayers"><label><input type="checkbox" value="creature" checked><span class="cat" style="background:${LAYERS.creature.color}"></span>Sightings</label><label><input type="checkbox" value="density" checked><span class="cat" style="background:${LAYERS.density.color}"></span>Density</label></div>` : ''}<div class="map-wrap"><div class="map" id="npcMap"></div></div>` : ''}${[...byMap.keys()].length > 1 ? `<p class="small muted">Also on: ${[...byMap.entries()].filter(([id]) => id !== mapId).map(([id, sp]) => `<a href="#/map/${id}">${esc(sp[0].z ?? `Map ${id}`)}</a> (${sp.length})`).join(', ')}</p>` : ''}` + table(n.spots.slice().reverse(), [
      { label: 'When', value: (sp) => sp.t, html: (sp) => `<span class="muted">${esc(when(sp.t))}</span>` },
      { label: 'Footage', value: (sp) => sp.footage?.offset ?? -1, html: (sp) => play(sp) },
      { label: 'How', value: (sp) => sp.kind },
      { label: 'Where', value: (sp) => (sp.sz ? `${sp.z}: ${sp.sz}` : sp.z ?? '') },
      { label: 'Coords', value: (sp) => sp.x, html: (sp) => coords(sp.x, sp.y), num: true },
    ], { sort: 0, desc: true, limit: 200 }) : '')}
    ${section('Tooltip', n.tip ? tooltipBox(n.tip) : '')}`;
};

function vendorTable(vendor) {
  return `<p class="muted small">Seen ${play(vendor.at)}${vendor.repair ? ' · repairs' : ''}</p>` + table(vendor.items, [
    { label: 'Item', value: (i) => i.name, html: (i) => itemLink(i.id, i.name, null, { count: i.per }) },
    { label: 'Price', value: (i) => i.price ?? 0, html: (i) => priceText(i), num: true },
    { label: 'Stock', value: (i) => i.stock ?? Infinity, html: (i) => (i.stock != null ? `${i.stock} (limited)` : 'unlimited'), num: true },
  ], { sort: 0, limit: 1000 });
}

function priceText(v) {
  const parts = [];
  if (v.price) parts.push(money(v.price));
  for (const c of v.costs || []) parts.push(`${c.value} × ${itemLink(c.id, c.name)}`);
  return parts.join(' + ') || 'free';
}

function tooltipBox(lines) {
  return `<div class="tooltip">${lines.map((raw) => {
    const l = tooltipLine(raw);
    return `<div class="tt-line"${l.color ? ` style="color:#${l.color}"` : ''}><span>${esc(l.left)}</span>${l.right ? `<span>${esc(l.right)}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

// Items -------------------------------------------------------------------

pages.items = async (_, params) => {
  const { world } = derived();
  const show = params.get('show') || 'items';
  const tabs = tabsHtml([['items', 'Items', world.items.length], ['objects', 'Herbs, ore & chests', world.objects.length]], show, '#/items?show=');
  if (show === 'objects') {
    return `${pageHead('World', 'Herbs, ore & chests', 'Everything you gathered or opened, and what came out of it.')}${tabs}
      ${table(world.objects, [
        { label: 'Object', value: (n) => n.name, html: (n) => npcLink(n.key, n.name) },
        { label: 'Opened', value: (n) => n.loots, num: true },
        { label: 'Gave', value: (n) => n.drops.length, html: (n) => n.drops.slice(0, 4).map((d) => itemLink(d.id, d.name)).join(' ') + (n.drops.length > 4 ? ` <span class="muted">+${n.drops.length - 4}</span>` : ''), num: true },
        { label: 'Zones', value: (n) => n.zones.join(', ') },
        { label: 'First', value: (n) => n.first?.t ?? n.spots[0]?.t ?? 0, html: (n) => (n.first ? play(n.first) : n.spots[0] ? play(n.spots[0]) : '') },
      ], { sort: 1, desc: true, empty: 'Nothing gathered yet. Herbs, ore and chests appear here after you loot them.' })}`;
  }
  return `${pageHead('World', 'Items', 'Every item you have looted, seen dropped, been offered, bought, worn, carried or hovered, with everything the game says about it.')}
    ${state.schema2 ? '' : schemaNotice()}${tabs}
    ${table(world.items, [
      { label: 'Item', value: (i) => i.name, html: (i) => itemLink(i.id, i.name, i.quality) },
      { label: 'Quality', value: (i) => i.quality ?? -1, html: (i) => esc(qualityName(i.quality) ?? ''), num: true },
      { label: 'Type', value: (i) => [i.info?.type, i.info?.sub].filter(Boolean).join(' · ') },
      { label: 'iLvl', value: (i) => i.info?.ilvl ?? 0, html: (i) => i.info?.ilvl ?? '', num: true },
      { label: 'Req', value: (i) => i.info?.req ?? 0, html: (i) => i.info?.req || '', num: true },
      { label: 'Sells for', value: (i) => i.info?.sell ?? 0, html: (i) => (i.info?.sell ? money(i.info.sell) : ''), num: true },
      { label: 'Looted', value: (i) => i.looted, num: true },
      { label: 'Sources', value: (i) => i.droppedBy.length + i.soldBy.length + i.rewardFrom.length, html: (i) => [
        i.droppedBy.length && `${i.droppedBy.length} drop`, i.soldBy.length && `${i.soldBy.length} vendor`, i.rewardFrom.length && `${i.rewardFrom.length} quest`,
      ].filter(Boolean).join(', '), num: true },
    ], { search: (i) => `${i.name} ${i.info?.type} ${i.info?.sub} ${(i.info?.tip || []).join(' ')}`, sort: 1, desc: true, empty: 'No items yet.' })}`;
};

pages.item = async (id) => {
  const { world, codex } = derived();
  const it = world.byItem.get(Number(id));
  if (!it) return '<p>Item not found.</p>';
  const info = it.info || {};
  const stats = info.stats && !Array.isArray(info.stats) ? Object.entries(info.stats) : [];
  const facts = [
    info.type, info.sub, info.slot?.replace('INVTYPE_', '').toLowerCase(), info.ilvl && `item level ${info.ilvl}`,
    info.req && `requires level ${info.req}`, info.stack > 1 && `stacks to ${info.stack}`, info.sell && `sells for ${money(info.sell)}`,
    info.icon && `icon ${info.icon}`, `ID ${it.id}`,
  ].filter(Boolean).map(esc).join(' · ');
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  const quest = (r) => codex.quests.find((q) => (r.qid && q.qid === r.qid) || q.title === r.title);
  return `${crumb('#/items', 'Items')}
    ${pageHead(qualityName(it.quality) ? `${qualityName(it.quality)} item` : 'Item', `<span class="item-big">${itemLink(it.id, it.name, it.quality, { size: 'large' })}</span>`)}
    <p class="muted">${facts}</p>
    ${info.tip ? tooltipBox(info.tip) : '<p class="muted">Full details arrive once the addon has scanned this item (hover it in game, or loot or see it again).</p>'}
    ${stats.length ? `<p class="small">${stats.map(([k, v]) => `<span class="chip">${esc(k.replace(/^ITEM_MOD_|_SHORT$|_NAME$/g, '').replace(/_/g, ' ').toLowerCase())} ${esc(v)}</span>`).join(' ')}</p>` : ''}
    ${info.spell ? `<p class="small">Use effect: <b>${esc(info.spell)}</b></p>` : ''}
    <div class="cards">${card(it.looted, 'looted', '#/items')}${it.created ? card(it.created, 'crafted', '#/items') : ''}${it.received ? card(it.received, 'received', '#/items') : ''}</div>
    ${it.moments.length ? `<p>First looted ${play(firstFootage(it.moments))}</p>` : ''}
    ${section('Dropped by', it.droppedBy.length ? table(it.droppedBy, [
      { label: 'Source', value: (d) => d.name, html: (d) => npcLink(d.key, d.name) },
      { label: 'Times', value: (d) => d.times, num: true },
      { label: 'Of loots', value: (d) => d.loots, num: true },
      { label: 'Drop rate', value: (d) => d.rate ?? 0, html: (d) => (d.rate != null ? `${Math.round(d.rate * 100)}%` : ''), num: true },
    ], { sort: 3, desc: true }) : '')}
    ${section('Sold by', it.soldBy.length ? table(it.soldBy, [
      { label: 'Vendor', value: (v) => v.name, html: (v) => npcLink(v.key, v.name) },
      { label: 'Price', value: (v) => v.price ?? 0, html: (v) => `${priceText(v)}${v.per > 1 ? ` for ${v.per}` : ''}`, num: true },
      { label: 'Stock', value: (v) => v.stock ?? Infinity, html: (v) => (v.stock != null ? `${v.stock} (limited)` : 'unlimited'), num: true },
      { label: 'Zone', value: (v) => v.zone ?? '' },
    ], { sort: 1 }) : '')}
    ${section('Quest reward from', it.rewardFrom.length ? `<ul>${it.rewardFrom.map((r) => { const q = quest(r); return `<li>${q ? `<a href="#/quest/${enc(q.key)}">${esc(r.title)}</a>` : esc(r.title)}${r.choice ? ' <span class="muted">(choice)</span>' : ''}</li>`; }).join('')}</ul>` : '')}
    ${section('Used to buy', it.costOf.length ? `<ul>${it.costOf.map((c) => `<li>${c.value} for ${itemLink(c.id, c.name)} from ${esc(c.vendor)}</li>`).join('')}</ul>` : '')}
    ${section('Worn by', it.equippedBy.length ? `<ul>${it.equippedBy.map((e) => `<li>${esc(e.char.split('-')[0])} ${play(e.moment)}</li>`).join('')}</ul>` : '')}`;
};

// Characters --------------------------------------------------------------

function charCard(c) {
  const i = c.info;
  return `<a class="card charcard" href="#/character/${enc(c.key)}" style="--class:${CLASS_COLORS[i.classToken] ?? 'var(--gold)'}"><div class="num">${esc(c.name)}</div>
    <div class="lbl">Level ${c.level} ${esc(i.race ?? '')} ${esc(i.class ?? '')} · ${esc(c.realm ?? '')}</div>
    <div class="lbl">${c.questsDone} quests · ${c.recordings.length} recordings · ${duration(c.playSeconds)} logged</div></a>`;
}

pages.characters = async () => {
  const { characters } = derived();
  return `${pageHead('Chronicle', 'Characters', "Each character's journey: levels, quests, gear, talents, and the footage they appear in.")}
    <div class="cards">${characters.map(charCard).join('') || '<p class="muted">No characters yet.</p>'}</div>`;
};

pages.character = async (key) => {
  const c = derived().characters.find((x) => x.key === key);
  if (!c) return '<p>Character not found.</p>';
  const i = c.info;
  const tabs = (c.talents?.tabs || []).map((t) => `<div class="panel"><h3>${esc(t.name)} <span class="muted">${t.spent ?? 0}</span></h3>${(t.talents || []).map((x) => `<div>${esc(x.name)} <span class="muted">${x.rank}/${x.max}</span></div>`).join('') || '<span class="muted">none</span>'}</div>`).join('');
  const statRow = (st) => ['str', 'agi', 'sta', 'int', 'spi', 'armor', 'hp', 'power', 'ap', 'crit', 'dodge'].map((k) => `<td class="num">${st[k] ?? ''}</td>`).join('');
  const shots = state.screenshots.filter((sh) => c.sessions.some((sid) => sessionCovers(sid, sh)));
  if (shots.length) setTimeout(() => loadShots(shots));
  const moneyNow = c.money.at(-1)?.total ?? i.money;
  const color = CLASS_COLORS[i.classToken] ?? 'var(--gold)';
  const xpPct = i.xpMax ? Math.min(1, (i.xp ?? 0) / i.xpMax) : 0;
  const R = 34;
  const circ = 2 * Math.PI * R;
  return `${crumb('#/characters', 'Characters')}
    <header class="page hero" style="--class:${color}">
      <div class="ring" title="${i.xpMax ? `${(i.xp ?? 0).toLocaleString()} / ${i.xpMax.toLocaleString()} XP into level ${c.level}` : `Level ${c.level}`}">
        <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}" class="ring-bg"/><circle cx="40" cy="40" r="${R}" class="ring-fg" style="stroke-dasharray:${circ.toFixed(1)};--to:${(circ * (1 - xpPct)).toFixed(1)}"/></svg>
        <div class="ring-num">${c.level}</div>
      </div>
      <div>
        <p class="kicker">${esc(i.race ?? '')} ${esc(i.class ?? '')}${i.faction ? ` · ${esc(i.faction)}` : ''}</p>
        <h1>${esc(c.name)} <span class="muted" style="font-size:.5em;font-family:var(--sans);font-weight:400">${esc(c.realm ?? '')}</span></h1>
        ${facts([i.guild ? `&lt;${esc(i.guild)}&gt;` : '', i.bind ? `Hearth: ${esc(i.bind)}` : '', moneyNow != null ? money(moneyNow) : '', i.xpMax ? `${Math.round(xpPct * 100)}% into level ${c.level}` : ''])}
      </div>
    </header>
    <div class="cards">
      ${card(c.questsDone, 'quests completed', '#/quests')}${card(c.kills, 'kills', '#/bestiary?show=killed')}${card(c.deaths.length, 'deaths', '#/highlights?kind=death')}
      ${card(c.zones.length, 'zones visited', '#/zones')}${card(c.recordings.length, 'recordings', '#/recordings')}${card(Math.round(c.playSeconds / 3600), 'hours logged', '#/sessions')}
    </div>
    <h2>Journey</h2>
    ${table(journeyRows(c), [
      { label: 'When', value: (r) => r.t, html: (r) => `<span class="muted">${esc(when(r.t))}</span>` },
      { label: 'Footage', value: (r) => r.footage?.offset ?? -1, html: (r) => play(r) },
      { label: 'Milestone', value: (r) => r.label, html: (r) => r.html },
    ], { sort: 0, desc: true, limit: 300, search: (r) => r.label })}
    <h2>Gear</h2>
    ${table(c.gear, [
      { label: 'Slot', value: (g) => g.slot, html: (g) => esc(g.slotName) },
      { label: 'Item', value: (g) => g.name, html: (g) => itemLink(g.id, g.name) },
      { label: 'Since', value: (g) => g.since.t, html: (g) => play(g.since) },
    ], { sort: 0, empty: 'No gear logged yet.' })}
    <h2>Gear progression</h2>
    ${table(c.gearHistory, [
      { label: 'When', value: (g) => g.t, html: (g) => `<span class="muted">${esc(when(g.t))}</span>` },
      { label: 'Slot', value: (g) => g.slotName },
      { label: 'Equipped', value: (g) => g.name, html: (g) => (g.id ? itemLink(g.id, g.name) : '<span class="muted">(removed)</span>') },
      { label: 'Replaced', value: (g) => g.was ?? 0, html: (g) => (g.was ? itemLink(g.was) : '') },
      { label: 'Footage', value: (g) => g.footage?.offset ?? -1, html: (g) => play(g) },
    ], { sort: 0, desc: true })}
    ${tabs ? `<h2>Talents</h2><div class="grid3">${tabs}</div>` : ''}
    ${c.stats.length ? `<h2>Stats by level</h2><div class="scroll"><table><thead><tr><th>Level</th>${['Str', 'Agi', 'Sta', 'Int', 'Spi', 'Armor', 'Health', 'Mana', 'AP', 'Crit %', 'Dodge %'].map((h) => `<th class="num">${h}</th>`).join('')}</tr></thead><tbody>${c.stats.map((st) => `<tr><td>${st.level}</td>${statRow(st)}</tr>`).join('')}</tbody></table></div>` : ''}
    ${c.reputation.length ? `<h2>Reputation</h2>${table(c.reputation, [
      { label: 'Faction', value: (f) => f.name },
      { label: 'Standing', value: (f) => f.standing, html: (f) => esc(REACTION[f.standing] ?? f.standing) },
      { label: 'Progress', value: (f) => f.value, html: (f) => (f.high > f.low ? `${f.value - f.low} / ${f.high - f.low}` : ''), num: true },
    ], { sort: 1, desc: true })}` : ''}
    ${c.skills.length ? `<h2>Skills</h2>${table(c.skills, [
      { label: 'Skill', value: (k) => k.name }, { label: 'Rank', value: (k) => k.rank, html: (k) => `${k.rank} / ${k.max}`, num: true },
    ], { sort: 1, desc: true })}` : ''}
    ${shots.length ? `<h2>Screenshots</h2><div class="shots">${shots.slice(-40).reverse().map(shotTile).join('')}</div>` : ''}
    <h2>Quests completed</h2>
    ${table(c.quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.qid ? `q${q.qid}` : `t${q.title}`)}">${esc(q.title ?? `Quest ${q.qid}`)}</a>` },
      { label: 'Zone', value: (q) => q.zone ?? '' },
      { label: 'Level', value: (q) => q.level ?? 0, num: true },
      { label: 'Turned in', value: (q) => q.t, html: (q) => play(q) },
    ], { sort: 3, desc: true, empty: 'No quests turned in yet.' })}
    <h2>Recordings</h2>
    ${table(c.recordings, [
      { label: 'Recording', value: (r) => r.start ?? 0, html: (r) => `<a href="#/recording/${r.id}">${esc(r.name)}</a>` },
      { label: 'Length', value: (r) => r.duration ?? 0, html: (r) => (r.duration ? duration(r.duration) : ''), num: true },
      { label: 'Events', value: (r) => r.events, num: true },
    ], { sort: 0, desc: true, empty: 'No footage of this character yet.' })}`;
};

function journeyRows(c) {
  const rows = [];
  for (const l of c.levels) rows.push({ ...l, label: `Reached level ${l.level}`, html: `<b>Reached level ${l.level}</b>` });
  for (const z of c.zones) rows.push({ ...z, label: `First visit to ${z.name}`, html: `First visit to <a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` });
  for (const g of c.gearHistory) if (!g.first && g.id) rows.push({ ...g, label: `Equipped ${g.name}`, html: `Equipped ${itemLink(g.id, g.name)}` });
  for (const d of c.deaths) rows.push({ ...d, label: `Died${d.killer ? ` to ${d.killer}` : ''}`, html: `Died${d.killer ? ` to <b>${esc(d.killer)}</b>` : ''}` });
  for (const q of c.quests) rows.push({ ...q, label: `Completed ${q.title}`, html: `Completed <a href="#/quest/${enc(q.qid ? `q${q.qid}` : `t${q.title}`)}">${esc(q.title)}</a>` });
  return rows;
}

// Screenshots ---------------------------------------------------------------

function sessionCovers(sessionId, shot) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s || !s.events.length || !shot.taken_ms) return false;
  const clock = derived().clock;
  const a = eventMs(s, s.events[0], clock) - 60000;
  const b = eventMs(s, s.events.at(-1), clock) + 60000;
  return shot.taken_ms >= a && shot.taken_ms <= b;
}

function shotTile(sh) {
  return `<a class="shot" data-shot="${esc(sh.path)}" target="_blank" rel="noopener"><img alt="${esc(sh.name)}" loading="lazy"><span class="muted small">${esc(new Date(sh.taken_ms).toLocaleString())}</span></a>`;
}

// Screenshots are private: ask Supabase for temporary links, then show them.
async function loadShots(shots) {
  const need = shots.map((s) => s.path).filter((p) => !state.shotUrls.has(p));
  if (need.length) {
    try {
      for (const [p, url] of await state.store.screenshotUrls(need)) state.shotUrls.set(p, url);
    } catch (err) { console.warn(err); }
  }
  for (const el of document.querySelectorAll('[data-shot]')) {
    const url = state.shotUrls.get(el.dataset.shot);
    if (url) { el.href = url; el.querySelector('img').src = url; }
  }
}

pages.screenshots = async () => {
  const shots = [...state.screenshots].sort((a, b) => (b.taken_ms ?? 0) - (a.taken_ms ?? 0));
  if (shots.length) setTimeout(() => loadShots(shots.slice(0, 120)));
  return `${pageHead('Footage', 'Screenshots', 'Taken in game while Chronicler was logging: automatically at rares, level-ups, discoveries and deaths (<code>/chron shots off</code> to stop), and whenever you press Print Screen. Your gaming PC uploads them, shrunk, while the app is open.')}
    ${state.schema2 ? '' : schemaNotice()}
    <div class="shots">${shots.slice(0, 120).map(shotTile).join('') || '<p class="muted">None yet.</p>'}</div>`;
};

// Footage finder -------------------------------------------------------------

pages.footage = async (_, params) => {
  if (!state.tracks) {
    main.innerHTML = '<p class="muted">Loading your routes…</p>';
    try { state.tracks = state.schema2 ? await state.store.loadTracks() : new Map(); } catch (err) { state.tracks = new Map(); toast(err.message); }
  }
  const f = Object.fromEntries(params);
  const filters = { ui: f.ui || 'any', motion: f.motion || 'any', place: f.place || 'any', time: f.time || 'any', minSeconds: Number(f.min || 60), noCombat: f.combat !== 'include' };
  const { recordings, clock } = derived();
  const segs = findSegments(state.sessions, state.tracks, recordings, (s, t) => eventMs(s, { t }, clock), filters)
    .filter((sg) => !f.zone || sg.zones.some((z) => z.toLowerCase().includes(f.zone.toLowerCase())));
  const select = (name, label, options) => `<label><span>${label}</span><select name="${name}">${options.map(([v, t]) => `<option value="${v}" ${String(f[name] ?? options[0][0]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  setTimeout(() => {
    document.getElementById('footageForm')?.addEventListener('change', (ev) => {
      const data = new URLSearchParams(new FormData(ev.currentTarget));
      location.hash = `#/footage?${data}`;
    });
  });
  return `${pageHead('Footage', 'Footage finder', 'Stretches of your recordings that match, found from where you were and what you were doing every 2 seconds. Made for sleep and ambience videos.')}
    ${state.schema2 ? '' : schemaNotice()}
    <form id="footageForm" class="panel grid4" onsubmit="return false">
      ${select('ui', 'Interface', [['any', 'Any'], ['hidden', 'Hidden (Alt+Z)']])}
      ${select('motion', 'Moving', [['any', 'Any'], ['moving', 'Moving'], ['foot', 'On foot'], ['mounted', 'Mounted'], ['flight', 'Flight path'], ['swimming', 'Swimming'], ['still', 'Standing still']])}
      ${select('place', 'Place', [['any', 'Anywhere'], ['outdoors', 'Outdoors'], ['indoors', 'Indoors']])}
      ${select('time', 'Time of day (in game)', [['any', 'Any'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']])}
      ${select('combat', 'Combat', [['exclude', 'No combat'], ['include', 'Include combat']])}
      ${select('min', 'At least', [['60', '1 minute'], ['30', '30 seconds'], ['180', '3 minutes'], ['300', '5 minutes'], ['600', '10 minutes']])}
      <label><span>Zone</span><input type="text" name="zone" value="${esc(f.zone ?? '')}" placeholder="e.g. Duskwood"></label>
    </form>
    <p class="muted">${segs.length} stretch${segs.length === 1 ? '' : 'es'}, ${duration(segs.reduce((n, sg) => n + sg.duration, 0))} in total.</p>
    ${table(segs, [
      { label: 'Footage', value: (sg) => sg.t, html: (sg) => `<a class="btn play" href="#/recording/${sg.rec}?t=${sg.from.toFixed(2)}">▶ ${tc(sg.from)}</a> <span class="muted small">${esc(sg.recName)}</span>` },
      { label: 'Length', value: (sg) => sg.duration, html: (sg) => duration(sg.duration), num: true },
      { label: 'Where', value: (sg) => sg.zones.join(', ') },
      { label: 'What', value: (sg) => '', html: (sg) => [sg.uiHidden && 'no UI', sg.flight && 'flight path', sg.mounted && 'mounted', sg.swimming && 'swimming', sg.indoors && 'indoors', ...sg.times].filter(Boolean).map((x) => `<span class="chip">${x}</span>`).join(' ') },
      { label: 'Character', value: (sg) => sg.char ?? '' },
    ], { sort: 1, desc: true, empty: 'Nothing matches. Tracks come from the addon (0.3.0 or later) while you record.' })}`;
};

// Highlights ----------------------------------------------------------------

const HL_COLORS = { close: '#e06a5f', death: '#ff4d4d', rare: '#b48cf0', elite: '#e0b95a', brawl: '#c9a27a', loot: '#0070dd', level: '#79c07a', discovery: '#5cc8a8', mark: '#6aa8e8' };

pages.highlights = async (_, params) => {
  const { world } = derived();
  const all = findHighlights(derived().sessions, derived().moment, (id) => world.byItem.get(id)?.quality ?? null);
  const kind = params.get('kind') || 'all';
  const list = kind === 'all' ? all : all.filter((h) => h.kind === kind);
  const counts = {};
  for (const h of all) counts[h.kind] = (counts[h.kind] || 0) + 1;
  const tabs = tabsHtml([['all', 'Everything', all.length], ...Object.entries(HIGHLIGHT_KINDS).map(([k, label]) => [k, label, counts[k] || 0])], kind, '#/highlights?kind=');
  return `${pageHead('Footage', 'Highlights', 'Moments worth a short, found automatically: close calls, deaths, rares, elite fights, great loot, level-ups, discoveries and your marks.')}
    ${tabs}
    ${table(list, [
      { label: 'Newest', value: (h) => h.t },
      { label: 'Kind', value: (h) => HIGHLIGHT_KINDS[h.kind] },
      { label: 'Zone', value: (h) => h.zone ?? '' },
      { label: 'Character', value: (h) => h.char ?? '' },
    ], {
      sort: 0, desc: true, search: (h) => `${h.label} ${h.zone} ${h.char} ${h.kind}`, empty: 'Nothing yet. Highlights appear as you play: close calls, deaths, rares, elite fights, great loot, level-ups, discoveries and marks.',
      card: (h) => `<div class="hcard-top" style="--k:${HL_COLORS[h.kind] ?? 'var(--gold)'}"><span class="chip">${esc(HIGHLIGHT_KINDS[h.kind])}</span><span class="muted small">${esc(when(h.t))}</span></div>
        <div class="hcard-body"><b>${esc(h.label)}</b><div class="muted small">${esc([h.zone, h.char].filter(Boolean).join(' · '))}</div></div>
        <div class="hcard-foot">${h.footage ? `<a class="btn primary play-big" href="#/recording/${h.footage.rec}?t=${h.footage.offset.toFixed(2)}">▶ ${tc(h.footage.offset)}</a>` : '<span class="muted small">no footage</span>'}${h.m ? `<a class="ghost btn small" href="#/map/${h.m}">map</a>` : ''}</div>`,
    })}`;
};

// Locations: maps with everything pinned -------------------------------------

pages.locations = async () => {
  const { maps } = derived();
  return `${pageHead('Chronicle', 'Locations', 'Every map you have set foot on, with everything pinned where it happened: quests, creatures, people, vendors, loot, deaths, marks, and the route you walked.')}
    ${state.schema2 ? '' : schemaNotice()}
    ${table(maps, [
      { label: 'Map', value: (m) => m.zone ?? `Map ${m.id}`, html: (m) => `<a href="#/map/${m.id}">${esc(m.zone ?? `Map ${m.id}`)}</a> <span class="muted small">${m.id}</span>` },
      { label: 'Areas', value: (m) => m.subzones.join(', ') },
      { label: 'Pins', value: (m) => m.markers.length, num: true },
      { label: 'Quests', value: (m) => m.counts.quest ?? 0, num: true },
      { label: 'Creatures', value: (m) => m.counts.creature ?? 0, num: true },
      { label: 'People', value: (m) => (m.counts.person ?? 0) + (m.counts.vendor ?? 0), num: true },
      { label: 'First visit', value: (m) => m.first?.t ?? 0, html: (m) => (m.first ? play(m.first) : '') },
    ], { search: (m) => `${m.zone} ${m.subzones.join(' ')}`, sort: 2, desc: true, empty: 'No maps yet. Positions are logged by addon 0.3.0 and later.' })}`;
};

pages.map = async (id, params) => {
  const { maps } = derived();
  const m = maps.find((x) => String(x.id) === String(id));
  if (!m) return '<p>Map not found.</p>';
  if (!state.tracks && state.schema2) {
    try { state.tracks = await state.store.loadTracks(); } catch { state.tracks = new Map(); }
  }
  const hidden = new Set((params.get('hide') || 'loot,lore,time').split(',').filter(Boolean));
  const timePoints = routesFor(m.id, derived().sessions, state.tracks).flatMap((r) => r.points.map(([x, y]) => ({ x, y })));
  const heat = { density: heatCells(m.markers.filter((mk) => mk.layer === 'creature'), 4), time: heatCells(timePoints, 3) };
  const services = derived().world.people;
  setTimeout(() => {
    wireMap('zoneMap', m.id, m.markers, {
      routes: true, hidden, heat,
      onBackground: (x, y) => {
        const near = nearestServices(services, m.id, x, y);
        const KIND = { repair: 'Repair', vendor: 'Vendor', trainer: 'Trainer', flight: 'Flight master', inn: 'Innkeeper', bank: 'Bank', quests: 'Quests' };
        document.getElementById('mapInfo').innerHTML = `<h3>Nearest to ${coords(x, y)}</h3>
          ${near.length ? near.map((n) => `<div class="row spread near"><span>${npcLink(n.key, n.name)}<br><span class="muted small">${n.kinds.map((k) => KIND[k]).join(' · ')}</span></span><span class="muted small" style="text-align:right">${n.dist.toFixed(1)}% ${n.bearing}<br>${coords(n.x, n.y)}</span></div>`).join('') : '<p class="muted small">No vendors, trainers, innkeepers or flight masters seen on this map yet.</p>'}
          <p class="muted small" style="margin-top:8px">Click a pin for its moments, or anywhere else for what is nearby.</p>`;
      },
    });
    document.getElementById('geojson')?.addEventListener('click', () => {
      const routes = routesFor(m.id, derived().sessions, state.tracks);
      download(`${(m.zone ?? `map-${m.id}`).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.geojson`, 'application/geo+json', JSON.stringify(toGeoJSON({ name: m.zone ?? `Map ${m.id}`, mapId: m.id, zone: m.zone, markers: cluster(m.markers), routes }), null, 1));
    });
  });
  const layers = Object.entries(LAYERS).filter(([k, l]) => k === 'route' || l.heat ? true : m.counts[k]);
  return `${crumb('#/locations', 'Locations')}
    ${pageHead('Map', esc(m.zone ?? `Map ${m.id}`), esc(m.subzones.join(' · ')), `<div class="row">${m.zone ? `<a class="btn ghost" href="#/zone/${enc(m.zone)}">Zone page</a>` : ''}<label class="btn ghost" style="margin:0"><input type="file" id="mapUpload" accept="image/*" hidden><span>Use my own map image</span></label><button class="ghost" id="geojson" title="Every pin and route as GeoJSON">Download GeoJSON</button><span class="muted small">Take a screenshot of the in-game map (M), crop it to the map itself, and choose it here. Until then the map comes from Wowhead.</span></div>`)}
    <div class="filters" id="mapLayers">${layers.map(([k, l]) => `<label><input type="checkbox" value="${k}" ${hidden.has(k) ? '' : 'checked'}><span class="cat" style="background:${l.color}"></span>${l.name}${m.counts[k] ? ` <span class="muted">${m.counts[k]}</span>` : ''}</label>`).join('')}</div>
    <div class="map-wrap"><div class="map" id="zoneMap"></div><div class="map-info panel" id="mapInfo"><p class="muted">Click a pin for its moments, or anywhere else on the map for the nearest repair, innkeeper, trainer and flight master.</p></div></div>`;
};

// Draws a map: the image, the route from the position track, and clustered
// pins. Clicking a pin shows its moments in #mapInfo (when present).
async function wireMap(elId, mapId, markers, { routes = true, hidden = new Set(), heat = {}, onBackground = null } = {}) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const own = state.settings.maps?.[mapId];
  const candidates = mapImageCandidates(mapId);
  if (own) {
    if (!state.shotUrls.has(own)) {
      try { for (const [p, u] of await state.store.screenshotUrls([own])) state.shotUrls.set(p, u); } catch { /* fall back to the public sources */ }
    }
    if (state.shotUrls.get(own)) candidates.unshift(state.shotUrls.get(own));
  }
  const src = candidates[0];
  const pins = cluster(markers);
  const routeLines = Array.isArray(routes) ? routes : routes ? routesFor(mapId, derived().sessions, state.tracks) : [];
  const path = (r) => r.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const heatSvg = Object.entries(heat).map(([layer, cells]) => `<g class="heat layer-${layer}" fill="${LAYERS[layer]?.color ?? '#fff'}">${cells.map((c) => `<ellipse cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" rx="${(2 + 3 * c.w).toFixed(2)}" ry="${(3 + 4.5 * c.w).toFixed(2)}" opacity="${(0.15 + 0.45 * c.w).toFixed(2)}"/>`).join('')}</g>`).join('');
  el.className = `map ${[...hidden].map((h) => `hide-${h}`).join(' ')}`;
  el.innerHTML = `<img src="${src}" alt="" draggable="false" referrerpolicy="no-referrer" crossorigin="anonymous">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">${heatSvg}${routeLines.map((r) => `<path d="${path(r)}" class="route" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <div class="you" hidden></div>
    ${pins.map((p, i) => `<a class="pin layer-${p.layer}" style="left:${p.x}%;top:${p.y}%;--c:${LAYERS[p.layer]?.color ?? '#fff'};--i:${Math.min(i, 60)}" data-i="${i}" href="${p.href ?? '#'}" title="${esc(p.label)}${p.n > 1 ? ` (${p.n})` : ''}">${p.n > 1 ? `<b>${p.n}</b>` : ''}</a>`).join('')}
    <div class="map-legend muted small">${pins.length} pins${routeLines.length ? ` · ${routeLines.length} route segment${routeLines.length === 1 ? '' : 's'}` : ''} · coordinates are the game's map percentages</div>
    <div class="map-missing" hidden><b>No map image for this zone yet.</b><br>Open the map in game (M), take a screenshot, crop it to just the map, and use <i>Use my own map image</i> above. Pins are still placed correctly.</div>`;
  const img = el.querySelector('img');
  let attempt = 0;
  img.addEventListener('load', () => { el.classList.remove('no-image'); el.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; });
  img.addEventListener('error', () => {
    attempt++;
    if (attempt < candidates.length) { img.src = candidates[attempt]; return; }
    el.classList.add('no-image');
    el.querySelector('.map-missing').hidden = false;
  });
  const info = document.getElementById('mapInfo');
  el.addEventListener('click', (ev) => {
    const pin = ev.target.closest('.pin');
    if (!pin) {
      if (!onBackground) return;
      const rect = img.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) onBackground(x, y);
      return;
    }
    const p = pins[Number(pin.dataset.i)];
    if (!info) return;
    ev.preventDefault();
    const moments = p.moments.slice().sort((a, b) => b.t - a.t);
    info.innerHTML = `<h3>${p.href && p.href !== '#' ? `<a href="${p.href}">${esc(p.label)}</a>` : esc(p.label)}</h3>
      <p class="muted small">${esc(LAYERS[p.layer]?.name ?? '')}${p.sub2 ? ` · ${esc(p.sub2)}` : ''}${p.sub ? ` · ${esc(p.sub)}` : ''} · ${coords(p.x, p.y)}${p.n > 1 ? ` · ${p.n} times here` : ''}</p>
      ${moments.map((mo) => `<div class="row"><span class="muted small">${esc(when(mo.t))}</span>${play(mo)}</div>`).join('')}`;
  });
  document.getElementById('mapLayers')?.addEventListener('change', (ev) => {
    el.classList.toggle(`hide-${ev.target.value}`, !ev.target.checked);
  });
  const you = el.querySelector('.you');
  const api = {
    // Moves the "you are here" marker to a map position (percent).
    setYou(x, y) {
      if (x == null) { you.hidden = true; return; }
      you.hidden = false;
      you.style.left = `${x}%`;
      you.style.top = `${y}%`;
    },
  };
  document.getElementById('mapUpload')?.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const rect = await cropDialog(bitmap);
      if (!rect) return;
      const scale = Math.min(1, 1600 / rect.w);
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(rect.w * scale), height: Math.round(rect.h * scale) });
      canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      const path = await state.store.saveMapImage(mapId, blob);
      state.settings = { ...state.settings, maps: { ...(state.settings.maps || {}), [mapId]: path } };
      await state.store.saveSettings(state.settings);
      state.shotUrls.delete(path);
      toast('Map image saved. If pins look shifted, upload again with a tighter crop.');
      route();
    } catch (err) { toast(err.message); }
  });
  return api;
}

// Lets you drag a box around the map artwork in a screenshot. Resolves to
// { x, y, w, h } in image pixels, or null if cancelled.
function cropDialog(bitmap) {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = 'crop-dialog';
    dlg.innerHTML = `<div class="crop-panel">
      <div class="row spread"><h3 style="margin:0">Crop to the map artwork</h3><span class="muted small">Drag a box from one corner of the map picture to the opposite corner. Leave out the border, title and buttons. Drag the box edges to adjust.</span></div>
      <div class="crop-stage"><canvas></canvas><div class="crop-box" hidden><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div>
      <div class="row spread"><span class="muted small" id="cropSize"></span><div class="row"><button type="button" id="cropCancel">Cancel</button><button type="button" class="primary" id="cropSave" disabled>Save map</button></div></div>
    </div>`;
    document.body.append(dlg);
    const stage = dlg.querySelector('.crop-stage');
    const canvas = dlg.querySelector('canvas');
    const box = dlg.querySelector('.crop-box');
    const size = dlg.querySelector('#cropSize');
    const save = dlg.querySelector('#cropSave');
    const maxW = Math.min(window.innerWidth - 80, 1100);
    const maxH = window.innerHeight - 200;
    const k = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let rect = null; // in canvas pixels
    const show = () => {
      if (!rect) return;
      box.hidden = false;
      Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      size.textContent = `${Math.round(rect.w / k)} × ${Math.round(rect.h / k)} px · ratio ${(rect.w / rect.h).toFixed(2)} (WoW maps are 1.50)`;
      save.disabled = rect.w < 20 || rect.h < 20;
    };
    const pos = (ev) => { const r = canvas.getBoundingClientRect(); return { x: Math.min(Math.max(ev.clientX - r.left, 0), canvas.width), y: Math.min(Math.max(ev.clientY - r.top, 0), canvas.height) }; };
    let drag = null;
    stage.addEventListener('pointerdown', (ev) => {
      const h = ev.target.dataset?.h;
      const p = pos(ev);
      if (h && rect) {
        const anchor = { x: h.includes('w') ? rect.x + rect.w : rect.x, y: h.includes('n') ? rect.y + rect.h : rect.y };
        drag = { anchor };
      } else if (ev.target === box && rect) {
        drag = { move: { dx: p.x - rect.x, dy: p.y - rect.y } };
      } else {
        drag = { anchor: p };
        rect = { x: p.x, y: p.y, w: 0, h: 0 };
      }
      stage.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    stage.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const p = pos(ev);
      if (drag.move) {
        rect.x = Math.min(Math.max(p.x - drag.move.dx, 0), canvas.width - rect.w);
        rect.y = Math.min(Math.max(p.y - drag.move.dy, 0), canvas.height - rect.h);
      } else {
        rect = { x: Math.min(drag.anchor.x, p.x), y: Math.min(drag.anchor.y, p.y), w: Math.abs(p.x - drag.anchor.x), h: Math.abs(p.y - drag.anchor.y) };
      }
      show();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    const done = (value) => { dlg.remove(); resolve(value); };
    dlg.querySelector('#cropCancel').addEventListener('click', () => done(null));
    save.addEventListener('click', () => done({ x: rect.x / k, y: rect.y / k, w: rect.w / k, h: rect.h / k }));
  });
}

// Search --------------------------------------------------------------------

pages.search = async (_, params) => {
  const q = params.get('q') || '';
  const d = derived();
  d.index ??= buildIndex({ codex: d.codex, world: d.world, characters: d.characters });
  const hits = search(d.index, q);
  const groups = new Map();
  for (const h of hits) {
    if (!groups.has(h.type)) groups.set(h.type, []);
    groups.get(h.type).push(h);
  }
  return `${pageHead('Search', q ? esc(q) : 'Search')}
    <p class="muted">${q ? `${hits.length}${hits.length === 200 ? '+' : ''} result${hits.length === 1 ? '' : 's'} for <b>${esc(q)}</b>. Searches names, quest and book text, dialogue, item tooltips (flavor text too), vendor stock and zones.` : 'Type in the search box at the top.'}</p>
    ${[...groups.entries()].map(([type, list]) => `<h2>${esc(type)}s <span class="muted small">${list.length}</span></h2><ul class="results">${list.map((h) => `<li>${h.type === 'Item' ? itemLink(Number(h.href.split('/').pop()), h.title) : `<a href="${h.href}">${esc(h.title)}</a>`} <span class="muted small">${esc(h.sub)}</span></li>`).join('')}</ul>`).join('')}`;
};

function schemaNotice() {
  return `<div class="notice">Your database needs the version 2 update for items, routes and screenshots. Copy the setup file again from <a href="https://github.com/adelrio3/streamer-app/blob/claude/wow-lore-youtube-concept-311j74/supabase/schema.sql" target="_blank" rel="noopener">supabase/schema.sql</a> (the two-squares <b>Copy raw file</b> button), paste it into <a href="https://supabase.com/dashboard/project/_/sql/new" target="_blank" rel="noopener">Supabase › SQL Editor › New query</a> and click <b>Run</b>. Then reload this page.</div>`;
}

pages.texts = (_, params) => pages.lore(_, params);

// Lore: every text and every line of dialogue, by zone, for scripts ----------

pages.lore = async (_, params) => {
  const c = await codex();
  const { world } = derived();
  const show = params.get('show') || 'all';
  const zone = params.get('zone') || '';
  const entries = [];
  for (const b of c.books) entries.push({ kind: 'text', title: b.title, zone: b.zone, text: b.pages.join('\n\n'), pages: b.pages, moment: firstFootage(b.moments), heard: b.moments.length });
  for (const n of world.npcs) {
    for (const l of n.lines) entries.push({ kind: l.kind === 'gossip' ? 'gossip' : 'speech', title: n.name, key: n.key, zone: n.zones[0] ?? null, text: l.text, moment: firstFootage(l.moments), heard: l.moments.length, sub: n.titles[0] });
  }
  for (const q of c.quests) if (q.text) entries.push({ kind: 'quest', title: q.title, qkey: q.key, zone: q.zone, text: [q.text, q.objectives, q.reward].filter(Boolean).join('\n\n'), moment: q.offered[0] ?? q.accepted[0], heard: 1 });
  entries.sort((a, b) => (b.moment?.t ?? 0) - (a.moment?.t ?? 0));
  const zones = [...new Set(entries.map((e) => e.zone).filter(Boolean))].sort();
  let list = show === 'all' ? entries : entries.filter((e) => e.kind === show);
  if (zone) list = list.filter((e) => e.zone === zone);
  const q = (params.get('q') || '').toLowerCase();
  if (q) list = list.filter((e) => `${e.title} ${e.text}`.toLowerCase().includes(q));
  const count = (k) => entries.filter((e) => e.kind === k).length;
  setTimeout(() => {
    const go = () => { const zs = document.getElementById('loreZone')?.value || ''; const qq = document.getElementById('loreQ')?.value || ''; location.hash = `#/lore?show=${show}${zs ? `&zone=${enc(zs)}` : ''}${qq ? `&q=${enc(qq)}` : ''}`; };
    document.getElementById('loreZone')?.addEventListener('change', go);
    document.getElementById('loreQ')?.addEventListener('change', go);
  });
  const KIND = { text: 'Book / plaque', gossip: 'Gossip', speech: 'Said aloud', quest: 'Quest text' };
  return `${pageHead('Chronicle', 'Lore', 'Everything the world told you, in its own words: books and plaques, what NPCs said when you spoke to them, what they shouted across the zone, and every quest text. Filter by zone when writing a script.')}
    <div class="row spread">
      ${tabsHtml([['all', 'Everything', entries.length], ['quest', 'Quest text', count('quest')], ['gossip', 'Conversations', count('gossip')], ['speech', 'Overheard', count('speech')], ['text', 'Books & plaques', count('text')]], show, '#/lore?show=')}
      <div class="row"><select id="loreZone"><option value="">All zones</option>${zones.map((z) => `<option ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select><input type="search" id="loreQ" placeholder="Words in the text…" value="${esc(params.get('q') || '')}"></div>
    </div>
    <p class="muted small">${list.length} of ${entries.length}</p>
    ${list.slice(0, 150).map((e) => `<div class="panel">
      <div class="row spread"><div><span class="chip">${KIND[e.kind]}</span> <b>${e.key ? npcLink(e.key, e.title) : e.qkey ? `<a href="#/quest/${enc(e.qkey)}">${esc(e.title)}</a>` : esc(e.title)}</b>${e.sub ? ` <span class="muted small">&lt;${esc(e.sub)}&gt;</span>` : ''}</div>
        <div class="row"><span class="muted small">${esc(e.zone ?? '')}${e.heard > 1 ? ` · heard ${e.heard}×` : ''}</span>${e.moment ? play(e.moment) : ''}</div></div>
      ${e.pages ? e.pages.map((pg, i) => `${e.pages.length > 1 ? `<div class="muted small">Page ${i + 1}</div>` : ''}${lore(pg)}`).join('') : lore(e.text)}
    </div>`).join('') || empty('Nothing here yet.')}
    ${list.length > 150 ? `<p class="muted">Showing 150. Narrow it down with the zone or word filters.</p>` : ''}`;
};

pages.zones = async () => {
  const c = await codex();
  const quests = new Map(c.quests.map((q) => [q.key, q]));
  return `${pageHead('Chronicle', 'Zones', 'Where you have been, with what happened there. Each zone links to its map.')}
    ${table(c.zones, [
      { label: 'Zone', value: (z) => z.name, html: (z) => `<a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` },
      { label: 'Map', value: (z) => '', html: (z) => derived().maps.filter((m) => m.zone === z.name).map((m) => `<a class="chip" href="#/map/${m.id}">map</a>`).join(' ') },
      { label: 'Quests done', value: (z) => z.quests.filter((k) => quests.get(k)?.status === 'done').length, num: true },
      { label: 'Quests seen', value: (z) => z.quests.length, num: true },
      { label: 'Kills', value: (z) => z.kills, num: true },
      { label: 'Subzones', value: (z) => z.subzones.length, num: true },
      { label: 'Loose ends', value: (z) => looseEnds(z.name, c, derived().world).total, html: (z) => { const n = looseEnds(z.name, c, derived().world).total; return n ? `<a class="chip active" href="#/zone/${enc(z.name)}#loose">${n}</a>` : '<span class="chip done">clear</span>'; }, num: true },
      { label: 'First visit', value: (z) => z.first.t, html: (z) => play(z.first) },
    ], { search: (z) => `${z.name} ${z.subzones.join(' ')}`, sort: 6 })}`;
};

pages.zone = async (name) => {
  const c = await codex();
  const z = c.zones.find((x) => x.name === name);
  if (!z) return '<p>Not found.</p>';
  const quests = z.quests.map((k) => c.quests.find((q) => q.key === k)).filter(Boolean);
  const { world, maps } = derived();
  const creatures = world.creatures.filter((k) => k.zones.includes(name));
  const people = world.people.filter((k) => k.zones.includes(name));
  const marks = c.marks.filter((m) => m.z === name);
  const zoneMaps = maps.filter((m) => m.zone === name);
  return `${crumb('#/zones', 'Zones')}
    ${pageHead('Zone', esc(name), esc(z.subzones.join(' · ')), zoneMaps.length ? `<div class="row">${zoneMaps.map((m) => `<a class="btn" href="#/map/${m.id}">Open map${zoneMaps.length > 1 ? ` ${m.id}` : ''}</a>`).join('')}<a class="btn ghost" href="#/lore?zone=${enc(name)}">Lore from here</a><a class="btn ghost" href="#/bestiary?zone=${enc(name)}">Creatures here</a></div>` : '')}
    <h2>Quests (${quests.filter((q) => q.status === 'done').length}/${quests.length} done)</h2>
    ${table(quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title)}</a>` },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { sort: 2 })}
    ${looseEndsSection(name, c, world)}
    <h2>Creatures</h2>
    <p>${creatures.map((k) => `<a href="#/npc/${enc(k.key)}">${esc(k.name)}</a> <span class="muted">${k.kills}</span>`).join(' · ') || '<span class="muted">None</span>'}</p>
    <h2>People</h2>
    <p>${people.map((k) => `<a href="#/npc/${enc(k.key)}">${esc(k.name)}</a>${k.titles[0] ? ` <span class="muted small">&lt;${esc(k.titles[0])}&gt;</span>` : ''}`).join(' · ') || '<span class="muted">None</span>'}</p>
    ${marks.length ? `<h2>Marks</h2><table><tbody>${marks.map((m) => `<tr><td>${play(m)}</td><td>${esc(MARK_NAMES[m.kind])}</td><td>${esc(m.note ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
};

// What you came across in a zone but did not finish.
function looseEndsSection(zoneName, c, world) {
  const le = looseEnds(zoneName, c, world);
  const list = (title, items) => (items.length ? `<div class="panel loose"><h3>${title} <span class="muted">${items.length}</span></h3><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : '');
  return `<h2 id="loose">Loose ends ${le.total ? `<span class="chip active">${le.total}</span>` : '<span class="chip done">all clear</span>'}</h2>
    <p class="muted">Things you came across here but did not finish. Built only from what you saw, so it never nags you about quests you have not found yet.</p>
    ${le.total ? `<div class="grid3">
      ${list('Quests not turned in', le.quests.map((q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title)}</a> <span class="chip ${q.status}">${q.status}</span>${q.giver ? ` <span class="muted small">from ${esc(q.giver.name)}</span>` : ''}`))}
      ${list('Rares seen, not killed', le.rares.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">seen ${n.sightings}×</span>`))}
      ${list('Creatures met, never killed', le.creatures.filter((n) => !le.rares.includes(n)).slice(0, 40).map((n) => `${npcLink(n.key, n.name)} <span class="muted small">${levelText(n) ? `lvl ${levelText(n)} · ` : ''}seen ${n.sightings}×</span>`))}
      ${list('Shops seen, never opened', le.shops.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>`))}
      ${list('Trainers seen, never opened', le.trainers.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>`))}
    </div>` : ''}`;
}

pages.marks = async () => {
  const c = await codex();
  setTimeout(() => {
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-del-mark]');
      if (!b) return;
      if (!window.confirm('Delete this mark? It disappears from every page and export. The addon\'s own log is not changed.')) return;
      const gone = new Set(state.settings.deletedMarks || []);
      gone.add(b.dataset.delMark);
      state.settings = { ...state.settings, deletedMarks: [...gone] };
      try { await state.store.saveSettings(state.settings); } catch (err) { toast(err.message); return; }
      invalidate();
      route({ keepScroll: true });
    });
  });
  const deleted = (state.settings.deletedMarks || []).length;
  setTimeout(() => document.getElementById('undeleteMarks')?.addEventListener('click', async () => {
    state.settings = { ...state.settings, deletedMarks: [] };
    try { await state.store.saveSettings(state.settings); } catch (err) { toast(err.message); return; }
    invalidate();
    route();
  }));
  return `${pageHead('Footage', 'Marks', 'Moments you flagged in game with a Chronicler key binding or <code>/chron mark</code>. Deleting a mark hides it everywhere; the addon\'s log is untouched.', deleted ? `<div class="row"><button class="ghost" id="undeleteMarks">Restore ${deleted} deleted mark${deleted === 1 ? '' : 's'}</button></div>` : '')}
    ${table(c.marks.slice().reverse(), [
      { label: 'Footage', value: (m) => m.t, html: (m) => play(m) },
      { label: 'Kind', value: (m) => MARK_NAMES[m.kind] ?? m.kind },
      { label: 'Note', value: (m) => m.note ?? '' },
      { label: 'Where', value: (m) => (m.sz ? `${m.z}: ${m.sz}` : m.z ?? ''), html: (m) => `${esc(m.sz ? `${m.z}: ${m.sz}` : m.z ?? '')} ${m.m ? `<a class="small" href="#/map/${m.m}">map</a>` : ''}` },
      { label: 'When', value: (m) => m.t, html: (m) => esc(when(m.t)) },
      { label: '', value: () => '', html: (m) => `<button class="ghost small" data-del-mark="${esc(markKey(m.session, m))}" title="Delete this mark">✕</button>` },
    ], { search: (m) => `${m.kind} ${m.note} ${m.z} ${m.sz}`, sort: 4, desc: true, empty: 'No marks yet.' })}`;
};

pages.sessions = async () => {
  const list = state.sessions.map((s) => ({
    id: s.id, char: s.char, build: s.build, flavor: s.flavor, machine: s.machine, events: s.events.length,
    first: s.events[0]?.t ?? s.started, last: s.events.at(-1)?.t ?? s.started,
    zones: [...new Set(s.events.map((e) => e.z).filter(Boolean))],
  }));
  return `${pageHead('System', 'Sessions', 'One per WoW login or /reload, uploaded by your gaming PC.')}
    ${table(list, [
      { label: 'Started', value: (s) => s.first, html: (s) => `<a href="#/session/${enc(s.id)}">${esc(when(s.first))}</a>` },
      { label: 'Character', value: (s) => `${s.char?.name ?? ''} (${s.char?.class ?? ''})` },
      { label: 'Length', value: (s) => s.last - s.first, html: (s) => duration(s.last - s.first), num: true },
      { label: 'Events', value: (s) => s.events, num: true },
      { label: 'Zones', value: (s) => s.zones.join(', ') },
      { label: 'Client', value: (s) => `${s.build?.version ?? ''} ${s.flavor ?? ''}` },
    ], { search: (s) => `${s.char?.name} ${s.zones.join(' ')}`, sort: 0, desc: true, empty: 'No sessions yet.' })}`;
};

pages.session = async (id) => {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return '<p>Session not found.</p>';
  const { where } = derived();
  const events = s.events.map((e) => ({ ...e, label: describe(e), cat: category(e), footage: where.get(`${s.id}|${e.t}`) ?? null }));
  return `<p><a href="#/sessions">← Sessions</a></p>
    <h1>${esc(s.char?.name ?? '')} · ${esc(when(s.events[0]?.t ?? s.started))}</h1>
    <p class="muted">${events.length} events · ${events.filter((e) => e.footage).length} on video</p>
    ${eventTable(events)}`;
};

function eventTable(events) {
  return table(events, [
    { label: 'Time', value: (e) => e.t, html: (e) => `<span class="muted">${new Date(e.t * 1000).toLocaleTimeString()}</span>` },
    { label: 'Footage', value: (e) => e.footage?.offset ?? -1, html: (e) => play(e) },
    { label: 'Event', value: (e) => e.label, html: (e) => `<span class="cat cat-${e.cat}"></span>${esc(e.label)}` },
    { label: 'Where', value: (e) => (e.sz ? `${e.z}: ${e.sz}` : e.z ?? '') },
    { label: 'Lvl', value: (e) => e.lvl ?? 0, num: true },
  ], { search: (e) => `${e.label} ${e.z} ${e.sz} ${e.cat}`, sort: 0, limit: 1000 });
}

function recSummary(r) {
  const events = derived().timelines.get(r.id) || [];
  const counts = {};
  for (const e of events) counts[e.cat] = (counts[e.cat] || 0) + 1;
  return { ...r, events: events.length, counts, zones: [...new Set(events.map((e) => e.z).filter(Boolean))] };
}

pages.recordings = async () => {
  const { recChars } = derived();
  const list = derived().recordings.map((r) => ({ ...recSummary(r), chars: recChars.get(r.id) || [] }));
  return `${pageHead('Footage', 'Recordings', 'Reported by the app on your recording computer. Videos stay on that computer; only their times are shared.')}
    ${table(list, [
      { label: 'Recording', value: (r) => r.start, html: (r) => `<a href="#/recording/${r.id}">${esc(r.name)}</a>` },
      { label: 'Length', value: (r) => r.duration, html: (r) => duration(r.duration), num: true },
      { label: 'Events', value: (r) => r.events, num: true },
      { label: 'Quests', value: (r) => r.counts.quest ?? 0, num: true },
      { label: 'Kills', value: (r) => r.counts.combat ?? 0, num: true },
      { label: 'Marks', value: (r) => r.counts.mark ?? 0, num: true },
      { label: 'Character', value: (r) => r.chars.join(', ') },
      { label: 'Zones', value: (r) => r.zones.join(', ') },
      { label: 'Timing', value: (r) => r.source, html: (r) => `<span class="chip">${esc(r.source)}</span>` },
    ], { search: (r) => `${r.name} ${r.zones.join(' ')} ${r.chars.join(' ')}`, sort: 0, desc: true, empty: 'No recordings yet. Open this app on your recording computer with OBS running.' })}`;
};

let videoURL = null;

pages.recording = async (id, params) => {
  const base = derived().recordings.find((x) => x.id === id);
  if (!base) return '<p>Recording not found.</p>';
  const r = { ...recSummary(base), timeline: derived().timelines.get(id) || [] };
  const start = Number(params.get('t') || 0);
  setTimeout(() => wirePlayer(r, start));
  const exportBtn = (fmt, label) => `<button data-fmt="${fmt}">${label}</button>`;
  return `<p><a href="#/recordings">← Recordings</a></p>
    <div class="row spread"><h1>${esc(r.name)}</h1><span class="muted">${esc(new Date(r.start).toLocaleString())} · ${duration(r.duration)}${(derived().recChars.get(r.id) || []).length ? ` · ${(derived().recChars.get(r.id)).map((n) => { const c = derived().characters.find((x) => x.name === n); return c ? `<a href="#/character/${enc(c.key)}">${esc(n)}</a>` : esc(n); }).join(', ')}` : ''}</span></div>
    <div class="player">
      <div>
        <video id="video" controls preload="metadata"></video>
        <p class="muted small" id="videoNote"></p>
        ${syncPanel(r)}
        <div class="panel">
          <h3>Export for editing</h3>
          <div class="filters" id="exportCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" ${QUIET_CATS.has(c) ? '' : 'checked'}><span class="cat cat-${c}"></span>${CAT_NAMES[c]} <span class="muted">${r.counts[c] ?? 0}</span></label>`).join('')}</div>
          <div class="row">
            ${exportBtn('xml', 'Premiere markers (.xml)')}
            ${exportBtn('srt', 'Captions (.srt)')}
            ${exportBtn('csv', 'Events (.csv)')}
            ${exportBtn('kills', 'Kill counter (.csv)')}
            ${exportBtn('chapters', 'YouTube chapters')}
          </div>
          <p class="muted small">Downloads go to this computer's Downloads folder. In Premiere, use File › Import on the .xml to get a sequence of this recording with a marker per event, or drop the .srt on the timeline as a caption track. The category checkboxes apply to markers, captions and events.
          ${r.path ? '' : '<br>The .xml needs the video\'s full path, which is filled in automatically when OBS is connected on the recording computer.'}</p>
        </div>
      </div>
      <div>
        <div class="map recording-map" id="recMap" hidden></div>
        <div class="filters" id="tlCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" ${QUIET_CATS.has(c) ? '' : 'checked'}><span class="cat cat-${c}"></span>${CAT_NAMES[c]}</label>`).join('')}</div>
        <div class="timeline" id="timeline"></div>
      </div>
    </div>`;
};

const EXPORTS = {
  xml: { ext: '.xml', type: 'application/xml' },
  srt: { ext: '.srt', type: 'application/x-subrip' },
  csv: { ext: '.events.csv', type: 'text/csv' },
  chapters: { ext: '.chapters.txt', type: 'text/plain' },
  kills: { ext: '.kills.csv', type: 'text/csv' },
};

function renderExport(r, format, cats) {
  const cfg = settings();
  const list = cats ? r.timeline.filter((e) => cats.has(e.cat)) : r.timeline;
  switch (format) {
    case 'xml': return toFCPXML(r, list, cfg);
    case 'srt': return toSRT(list, cfg.cueSeconds);
    case 'csv': return toCSV(list);
    case 'chapters': return toChapters(r.timeline);
    case 'kills': {
      const clock = derived().clock;
      return toKillsCSV(r.timeline, lifetimeKillsBefore(state.sessions, r.start, (s, e) => eventMs(s, e, clock)));
    }
    default: return '';
  }
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const TIMING = {
  sync: 'Lined up exactly with a sync flash in this recording.',
  'sync-inferred': 'Using the correction measured by the sync flash in',
  obs: 'Start and stop reported by OBS, on the shared clock. Usually within a fraction of a second; a sync flash makes it exact.',
  filename: 'Start time from the file name (the app was not open on the recording computer). A sync flash makes it exact.',
};

function syncPanel(r) {
  const note = r.source === 'sync-inferred' ? `${TIMING[r.source]} <code>${esc(r.syncedFrom)}</code>.` : TIMING[r.source] ?? '';
  return `<div class="panel" id="syncPanel">
    <div class="row spread"><h3>Timing</h3><span class="chip">${esc(r.source)}</span></div>
    <p class="small">${note}</p>
    <div class="row">
      <button data-step="-1">« 1s</button><button data-step="-f">‹ frame</button><button data-step="f">frame ›</button><button data-step="1">1s »</button>
      <label class="check" style="margin:0"><span class="muted small">Flash at</span><input type="text" id="flashAt" size="12" placeholder="0:00.000"></label>
      <button class="primary" id="findSync">Line up with sync flash</button>
      ${r.source === 'sync' ? '<button id="clearSync">Remove sync</button>' : ''}
    </div>
    <p class="muted small">Pause on the first frame where the screen turns white (the sound spike is right there too), or type the time from your editor, then press Line up.</p>
    <div id="syncChoices"></div>
  </div>`;
}

function parseTime(text) {
  const parts = String(text).trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function rowFor(r) {
  return state.rows.find((x) => x.name === r.name);
}

function wireSync(r, video) {
  const input = document.getElementById('flashAt');
  const fmt = (sec) => `${tc(sec)}.${String(Math.round((sec % 1) * 1000)).padStart(3, '0')}`;
  video.addEventListener('pause', () => { input.value = fmt(video.currentTime); });
  video.addEventListener('seeked', () => { if (video.paused) input.value = fmt(video.currentTime); });
  for (const b of document.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      video.pause();
      const fps = settings().fps;
      const step = b.dataset.step === 'f' ? 1 / fps : b.dataset.step === '-f' ? -1 / fps : Number(b.dataset.step);
      video.currentTime = Math.max(0, video.currentTime + step);
    });
  }
  document.getElementById('clearSync')?.addEventListener('click', async () => {
    await state.machine.putRow({ ...rowFor(r), sync: null });
    route();
  });
  document.getElementById('findSync').addEventListener('click', () => {
    const at = parseTime(input.value || fmt(video.currentTime));
    const box = document.getElementById('syncChoices');
    if (at == null || at < 0 || at > r.duration + 1) { box.innerHTML = '<p class="small" style="color:var(--red)">Type the flash time, within this recording, as seconds or h:mm:ss.ms.</p>'; return; }
    const clock = derived().clock;
    const estimate = r.rawStart + at * 1000;
    const list = [];
    for (const s of state.sessions) {
      for (const e of s.events) if (e.e === 'sync') { const ms = eventMs(s, e, clock); list.push({ ms, char: s.char?.name, zone: e.z, distance: (ms - estimate) / 1000 }); }
    }
    list.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
    list.splice(8);
    if (!list.length) {
      box.innerHTML = '<p class="small">No sync flashes uploaded yet. In game, press your Sync key (or type <code>/chron sync</code>) right after starting a recording, then log out or /reload with the app open on your gaming PC.</p>';
      return;
    }
    const gap = (d) => (Math.abs(d) < 90 ? `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}s` : `${d >= 0 ? '+' : '−'}${duration(Math.abs(d))}`);
    box.innerHTML = `<p class="small">Which flash is at <b>${fmt(at)}</b>? Closest first.</p><table><tbody>${list.map((c, i) => `<tr>
      <td>${esc(new Date(c.ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }))}</td>
      <td class="muted">${esc(c.char ?? '')} ${esc(c.zone ?? '')}</td>
      <td class="muted small">${gap(c.distance)} from current timing</td>
      <td><button data-pick="${i}" class="${i === 0 ? 'primary' : ''}">Use this</button></td></tr>`).join('')}</tbody></table>`;
    for (const b of box.querySelectorAll('[data-pick]')) {
      b.addEventListener('click', async () => {
        const c = list[Number(b.dataset.pick)];
        await state.machine.putRow({ ...rowFor(r), sync: { start_ms: Math.round(c.ms - at * 1000), flash_ms: c.ms, videoTime: at } });
        toast('Synced. Every event in this recording now lines up with the flash.');
        location.hash = `#/recording/${r.id}?t=${at.toFixed(3)}`;
        route();
      });
    }
  });
}

async function wirePlayer(r, start) {
  const video = document.getElementById('video');
  const tl = document.getElementById('timeline');
  if (!video || !tl) return;
  const note = document.getElementById('videoNote');
  const local = state.machine.rec.videos.get(r.name.toLowerCase());
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
  if (local) {
    videoURL = URL.createObjectURL(await local.handle.getFile());
    video.src = videoURL;
  } else {
    video.hidden = true;
    note.textContent = state.machine.config.records
      ? 'This video is not in the recordings folder chosen on This computer.'
      : 'The video lives on your recording computer. Open this page there to watch it; events and exports work here too.';
  }
  video.addEventListener('loadedmetadata', () => {
    if (start) video.currentTime = start;
    // The video knows its real length; fix the stored one if it is off.
    const row = rowFor(r);
    if (row && Number.isFinite(video.duration) && Math.abs(video.duration - r.duration) >= 1) state.machine.putRow({ ...row, duration: video.duration });
  }, { once: true });
  video.addEventListener('error', () => {
    if (local) note.textContent = 'Chrome cannot play this file. Set OBS to record MP4 (Settings › Output › Recording Format), or remux it (File › Remux Recordings). Timestamps and exports still work.';
  });
  wireSync(r, video);
  const follow = await recordingMap(r, video);
  const shownCats = () => new Set([...document.querySelectorAll('#tlCats input:checked')].map((i) => i.value));
  const draw = () => {
    const cats = shownCats();
    tl.innerHTML = r.timeline.map((e, i) => (cats.has(e.cat)
      ? `<div class="ev" data-i="${i}" data-o="${e.offset}"><span class="tc">${tc(e.offset)}</span><span><span class="cat cat-${e.cat}"></span>${esc(e.label)}</span></div>`
      : '')).join('') || '<p class="muted" style="padding:10px">No events in this recording yet.</p>';
  };
  draw();
  document.getElementById('tlCats').addEventListener('change', draw);
  tl.addEventListener('click', (ev) => {
    const row = ev.target.closest('.ev');
    if (row && !video.hidden) { video.currentTime = Number(row.dataset.o); video.play().catch(() => {}); }
  });
  let lastNow = null;
  video.addEventListener('timeupdate', () => {
    follow?.(video.currentTime);
    let cur = null;
    for (const row of tl.querySelectorAll('.ev')) { if (Number(row.dataset.o) <= video.currentTime + 0.25) cur = row; else break; }
    if (cur !== lastNow) {
      lastNow?.classList.remove('now');
      cur?.classList.add('now');
      cur?.scrollIntoView({ block: 'nearest' });
      lastNow = cur;
    }
  });
  for (const b of document.querySelectorAll('[data-fmt]')) {
    b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      const checked = [...document.querySelectorAll('#exportCats input:checked')].map((i) => i.value);
      const cats = ['xml', 'srt', 'csv'].includes(fmt) ? new Set(checked) : null;
      download(stem(r.name) + EXPORTS[fmt].ext, EXPORTS[fmt].type, renderExport(r, fmt, cats));
    });
  }
}

// A small map beside the video: the route during this recording and a marker
// that follows playback. Returns a function (seconds) => void, or null.
async function recordingMap(r, video) {
  const el = document.getElementById('recMap');
  if (!el) return null;
  if (!state.tracks && state.schema2) { try { state.tracks = await state.store.loadTracks(); } catch { state.tracks = new Map(); } }
  const { clock, sessions } = derived();
  const points = [];
  for (const s of sessions) {
    for (const str of (state.tracks?.get(s.id) || s.track || [])) {
      const p = parsePoint(str);
      const offset = (eventMs(s, { t: p.t }, clock) - r.start) / 1000;
      if (offset >= -2 && offset <= r.duration + 2 && p.map && (p.x > 0 || p.y > 0)) points.push({ ...p, offset });
    }
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.offset - b.offset);
  const counts = new Map();
  for (const p of points) counts.set(p.map, (counts.get(p.map) || 0) + 1);
  const mapId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const onMap = points.filter((p) => p.map === mapId);
  el.hidden = false;
  const api = await wireMap('recMap', mapId, [], {
    routes: [{ points: onMap.map((p) => [p.x, p.y, p.t, p.flags]) }],
    // Click the route to jump the video to when you were there.
    onBackground: (x, y) => {
      let best = null;
      for (const p of onMap) {
        const d = Math.hypot(p.x - x, (p.y - y) * 1.5);
        if (!best || d < best.d) best = { d, p };
      }
      if (best && best.d < 6 && video) { video.currentTime = Math.max(0, best.p.offset); video.play().catch(() => {}); }
    },
  });
  if (!api) return null;
  el.title = 'Click the route to jump the video there';
  return (seconds) => {
    // Nearest track point at or before this second, if it is close enough.
    let lo = 0;
    let hi = onMap.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (onMap[mid].offset <= seconds) lo = mid; else hi = mid - 1; }
    const p = onMap[lo];
    if (!p || Math.abs(p.offset - seconds) > 45) api.setYou(null);
    else api.setYou(p.x, p.y);
  };
}

// This computer -------------------------------------------------------------

pages.setup = async () => {
  const m = state.machine;
  const cfg = m.config;
  const s = settings();
  const wow = m.wow;
  const manifest = await fetch('addon/manifest.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  // Wire the buttons once the page below is on screen.
  setTimeout(wireSetup);
  const wowBody = {
    off: '<p class="muted">Checking…</p>',
    none: `<p>Choose your <b>World of Warcraft</b> folder (to find it: Battle.net › World of Warcraft › gear icon next to Play › <b>Show in Explorer</b>).</p>
      <button class="primary" data-act="pickWow">Choose World of Warcraft folder</button>
      <p class="muted small">Chrome asks whether this site may view and edit files there. Choose <b>Edit files</b> so it can install the addon for you.</p>
      <details class="small"><summary><b>Chrome says it "can't open this folder because it contains system files"?</b></summary>
        <p>Chrome never lets websites into <code>C:\Program Files (x86)</code>. Move WoW once to <code>C:\Games</code>; your addons and settings move with it:</p>
        <ol class="steps">
          <li>Quit WoW, then quit Battle.net completely: right-click its icon at the bottom right of the taskbar (click <b>^</b> if hidden) › <b>Exit</b>.</li>
          <li>In File Explorer open <code>C:\</code>, right-click an empty spot › <b>New › Folder</b>, name it <code>Games</code>.</li>
          <li>Open <code>C:\Program Files (x86)</code>, right-click <b>World of Warcraft</b> › <b>Cut</b>. Open <code>C:\Games</code>, right-click › <b>Paste</b>, and click <b>Continue</b> if Windows asks. It takes a second.</li>
          <li>Start Battle.net, open <b>World of Warcraft</b>, pick <b>World of Warcraft Classic Era</b> in the version menu above the button, and click <b>Locate the game</b> under the Install button. Select <code>C:\Games\World of Warcraft</code>. The button turns back into <b>Play</b>.</li>
          <li>Back here, click <b>Choose World of Warcraft folder</b> and pick <code>C:\Games\World of Warcraft</code>.</li>
        </ol>
      </details>`,
    'needs-permission': `<p>Chrome needs your OK again to read the WoW folder (it asks once after each browser restart).</p><button class="primary" data-act="grantWow">Allow access to the WoW folder</button>`,
    'wrong-folder': `<p style="color:var(--red)">That folder has no WoW game in it. Pick the folder called <b>World of Warcraft</b> (the one that contains <code>_classic_era_</code>).</p><button class="primary" data-act="pickWow">Choose again</button>`,
    ok: `<p><span class="dot ok" style="display:inline-block"></span> Watching <b>${esc(m.wowRoot?.name ?? '')}</b>. New play sessions upload a few seconds after you log out or /reload.
      ${wow.lastIngest ? `Last upload ${esc(new Date(wow.lastIngest.at).toLocaleTimeString())}.` : ''}</p>
      <table><tbody>${wow.installs.map((inst, i) => `<tr><td><b>${esc(inst.flavor)}</b></td>
        <td>${inst.addonVersion ? `Addon ${esc(inst.addonVersion)} installed` : '<span class="muted">Addon not installed</span>'}</td>
        <td>${manifest ? `<button data-install="${i}" class="${inst.addonVersion === manifest.version ? '' : 'primary'}">${inst.addonVersion ? (inst.addonVersion === manifest.version ? 'Reinstall' : `Update to ${esc(manifest.version)}`) : `Install addon ${esc(manifest.version)}`}</button>` : ''}</td>
        <td class="muted small">${wow.files.filter((f) => f.flavor === inst.flavor).map((f) => `log found for ${esc(f.account)}`).join(', ') || 'no addon log yet'}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">After installing or updating, type <code>/reload</code> in game (or restart WoW). <button data-act="pickWow">Choose a different folder</button></p>`,
  }[wow.state] ?? '';
  const obs = m.obsStatus;
  const recBody = {
    off: '<p class="muted">Checking…</p>',
    none: `<p>Choose the folder OBS saves recordings to${obs.recordDirectory ? `: OBS says <code>${esc(obs.recordDirectory)}</code>` : ' (in OBS: Settings › Output › Recording Path; on a Mac usually your <b>Movies</b> folder)'}.</p><button class="primary" data-act="pickRec">Choose recordings folder</button>`,
    'needs-permission': '<p>Chrome needs your OK again to read the recordings folder.</p><button class="primary" data-act="grantRec">Allow access to recordings</button>',
    ok: `<p><span class="dot ok" style="display:inline-block"></span> Reading <b>${esc(m.recRoot?.name ?? '')}</b>: ${m.rec.videos.size} video${m.rec.videos.size === 1 ? '' : 's'}. <button data-act="pickRec">Choose a different folder</button></p>`,
  }[m.rec.state] ?? '';
  return `${pageHead('System', 'This computer', 'What this computer does for Chronicler, and how it is connected.')}
    ${foldersSupported() ? '' : '<div class="notice error">This browser can\'t open local folders. Use Google Chrome (or Microsoft Edge on Windows).</div>'}
    <form id="machineForm" class="panel">
      <h3>What this computer does</h3>
      <div class="grid2">
        <label><span>Name for this computer</span><input type="text" name="name" value="${esc(cfg.name)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="plays" ${cfg.plays ? 'checked' : ''}><span>I play WoW on this computer</span></label>
      <label class="check"><input type="checkbox" name="records" ${cfg.records ? 'checked' : ''}><span>OBS records on this computer</span></label>
      <button class="primary" type="submit">${cfg.fresh ? 'Save and continue' : 'Save'}</button>
      ${cfg.fresh ? '<p class="muted small">These are guesses for this computer; change them if they are wrong.</p>' : ''}
    </form>
    ${cfg.plays && !cfg.fresh ? `<div class="panel"><h3>World of Warcraft</h3>${wowBody}</div>
      <div class="panel"><h3>In game</h3><p class="small">Key bindings: Options › Keybindings › AddOns › Chronicler. Bind <b>Sync flash</b> and the marks you want. Press Sync right after starting a recording.</p>
        <p class="small">Optional commands: <code>/chron scanner on</code> logs every NPC within about 40 yards using invisible nameplates (it changes your nameplate settings; <code>/chron scanner off</code> puts them back). <code>/chron shots off</code> stops automatic screenshots. <code>/chron social on</code> also logs group, duels and chat. <code>/chron</code> lists everything.</p></div>` : ''}
    ${state.schema2 ? '' : schemaNotice()}
    ${cfg.records && !cfg.fresh ? `<form id="obsForm" class="panel"><h3>OBS</h3>
      <p class="small">In OBS: <b>Tools › WebSocket Server Settings</b>, tick <b>Enable WebSocket server</b>, then click <b>Show Connect Info</b> and copy the <b>Server Password</b> here. If Chrome asks to let this site access apps on this device, click <b>Allow</b>.</p>
      <label class="check"><input type="checkbox" name="enabled" ${cfg.obs.enabled ? 'checked' : ''}><span>Connect to OBS on this computer</span></label>
      <div class="grid2">
        <label><span>Server password</span><input type="password" name="password" value="${esc(cfg.obs.password)}" autocomplete="off"></label>
        <label><span>Server port</span><input type="number" name="port" value="${cfg.obs.port}"></label>
        <label><span>OBS file name format (Settings › Advanced › Recording)</span><input type="text" name="pattern" value="${esc(cfg.pattern)}"></label>
      </div>
      <p class="small">Status: <b>${esc(obs.state)}</b>${obs.recording ? ' · recording now' : ''}${obs.error ? ` · <span style="color:var(--red)">${esc(obs.error)}</span>` : ''}</p>
      <button class="primary" type="submit">Save</button></form>
      <div class="panel"><h3>Recordings folder</h3>${recBody}</div>` : ''}
    <form id="videoForm" class="panel"><h3>Video settings (shared by all your computers)</h3>
      <div class="grid2">
        <label><span>Recording frame rate</span><input type="number" step="0.001" name="fps" value="${s.fps}"></label>
        <label><span>Width</span><input type="number" name="width" value="${s.width}"></label>
        <label><span>Height</span><input type="number" name="height" value="${s.height}"></label>
        <label><span>Caption length, seconds</span><input type="number" step="0.5" name="cueSeconds" value="${s.cueSeconds}"></label>
      </div>
      <button type="submit">Save</button></form>
    <div class="panel"><h3>Account</h3><p class="small">Logged in as <b>${esc(state.user.email)}</b>. Clock: ${m.offset == null ? 'measuring…' : `${(m.offset / 1000).toFixed(3)}s from the server (±${Math.round((m.rtt ?? 0) / 2)} ms)`}.</p><button data-act="logout">Log out</button></div>
    <div class="panel danger"><h3>Start over</h3>
      <p class="small">Deletes every session, recording, item, route, screenshot, clock sample and deleted-mark record from your account, on both computers. Your own map images are kept. Sessions and recordings from before now will not come back even if the addon still has them; afterwards, type <code>/chron clear confirm</code> in game to empty the addon's log too.</p>
      <div class="row"><input type="text" id="wipeWord" placeholder="type DELETE" autocomplete="off"><button class="danger-btn" id="wipe" disabled>Delete everything and start over</button></div>
    </div>`;
};

function wireSetup() {
  const m = state.machine;
  const act = {
    pickWow: () => m.pickWow(), grantWow: () => m.grantWow(), pickRec: () => m.pickRec(), grantRec: () => m.grantRec(),
    logout: async () => { await state.client.auth.signOut(); location.hash = '#/'; location.reload(); },
  };
  for (const b of document.querySelectorAll('[data-act]')) {
    b.addEventListener('click', async (ev) => {
      ev.preventDefault();
      try { await act[b.dataset.act](); } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
      route();
    });
  }
  for (const b of document.querySelectorAll('[data-install]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const v = await m.installAddon(m.wow.installs[Number(b.dataset.install)]);
        toast(`Addon ${v} installed. Type /reload in game.`);
      } catch (err) { toast(err.message); }
      route();
    });
  }
  const wipeWord = document.getElementById('wipeWord');
  const wipe = document.getElementById('wipe');
  wipeWord?.addEventListener('input', () => { wipe.disabled = wipeWord.value.trim() !== 'DELETE'; });
  wipe?.addEventListener('click', async () => {
    if (!window.confirm('Really delete everything? This cannot be undone.')) return;
    wipe.disabled = true;
    wipe.textContent = 'Deleting…';
    try {
      m.stop();
      await state.store.deleteAll({ keepMaps: true });
      const keep = { maps: state.settings.maps || {}, fps: state.settings.fps, width: state.settings.width, height: state.settings.height, cueSeconds: state.settings.cueSeconds };
      state.settings = { ...keep, resetAt: Math.floor((Date.now() + (m.offset ?? 0)) / 1000) };
      await state.store.saveSettings(state.settings);
      for (const k of Object.keys(localStorage)) if (k.startsWith('chronicler.track.')) localStorage.removeItem(k);
      Object.assign(state, { sessions: [], rows: [], clock: [], items: [], screenshots: [], tracks: new Map(), shotUrls: new Map() });
      invalidate();
      toast('Everything deleted. Type /chron clear confirm in game to empty the addon too.');
      m.restart();
      location.hash = '#/';
      route();
    } catch (err) { toast(err.message); wipe.textContent = 'Delete everything and start over'; wipe.disabled = false; }
  });
  document.getElementById('machineForm')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    m.saveConfig({ name: String(f.get('name')).trim() || m.config.name, plays: f.get('plays') === 'on', records: f.get('records') === 'on' });
    toast('Saved.');
    // Stay here for the next steps (folders, OBS).
    if (location.hash !== '#/setup') location.hash = '#/setup'; else route();
  });
  document.getElementById('obsForm')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    m.saveConfig({ pattern: f.get('pattern'), obs: { enabled: f.get('enabled') === 'on', password: f.get('password'), port: Number(f.get('port')) || 4455 } });
    toast('Saved.');
    setTimeout(route, 1500);
  });
  document.getElementById('videoForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const next = {};
    for (const k of ['fps', 'width', 'height', 'cueSeconds']) next[k] = Number(f.get(k)) || settings()[k];
    state.settings = { ...state.settings, ...next };
    await state.store.saveSettings(state.settings);
    toast('Saved.');
  });
}

// Signing in ------------------------------------------------------------------

function renderLogin(message = '') {
  document.getElementById('nav').hidden = true;
  main.innerHTML = `<div class="login"><div class="panel glow">
    <div class="brand" style="font-size:2rem;margin-bottom:6px"><span class="brand-mark"></span>Chronicler</div>
    <p class="muted">Log in with the same account on your gaming PC and your recording computer. Use the same email address as your Supabase account: Supabase's built-in mailer only sends to addresses on your Supabase team.</p>
    ${message ? `<div class="notice">${message}</div>` : ''}
    <form id="login">
      <label><span>Email</span><input type="email" name="email" required autocomplete="username" style="width:100%"></label>
      <label><span>Password</span><input type="password" name="password" required minlength="6" autocomplete="current-password" style="width:100%"></label>
      <div class="row"><button class="primary" type="submit" name="mode" value="in">Log in</button><button type="submit" name="mode" value="up">Create account</button></div>
    </form></div></div>`;
  document.getElementById('login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const creds = { email: f.get('email'), password: f.get('password') };
    const auth = state.client.auth;
    const { data, error } = ev.submitter?.value === 'up'
      ? await auth.signUp({ ...creds, options: { emailRedirectTo: location.origin + location.pathname } })
      : await auth.signInWithPassword(creds);
    if (error) return renderLogin(esc(error.message));
    if (!data.session) return renderLogin('Account created. Supabase sent you a confirmation email (from Supabase Auth, check spam too): click <b>Confirm your mail</b> in it. If the page it opens does not load, that is fine: your account is confirmed anyway. Then come back here and log in.');
    startApp(data.session.user);
  });
}

function renderConnect(message = '') {
  document.getElementById('nav').hidden = true;
  main.innerHTML = `<div class="panel" style="max-width:560px;margin:40px auto">
    <h1>Connect to Supabase</h1>
    <p class="muted">This site isn't linked to your Supabase project yet. The Netlify setup normally does this for you; you can also paste the two values here (Supabase › Project Settings › API).</p>
    ${message ? `<div class="notice error">${esc(message)}</div>` : ''}
    <form id="connect">
      <label><span>Project URL</span><input type="text" name="url" placeholder="https://xxxx.supabase.co" style="width:100%"></label>
      <label><span>anon public key</span><input type="text" name="anonKey" style="width:100%"></label>
      <button class="primary" type="submit">Connect</button>
    </form></div>`;
  document.getElementById('connect').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    localStorage.setItem('chronicler.supabase', JSON.stringify({ url: String(f.get('url')).trim(), anonKey: String(f.get('anonKey')).trim() }));
    location.reload();
  });
}

// Router and start-up -------------------------------------------------------

let redrawTimer = null;
function changed() {
  invalidate();
  renderStatus();
  // Redraw the current page with new data, except where it would interrupt:
  // the video player, or a form being typed in.
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    const page = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
    if (page === 'recording') return;
    if (document.activeElement?.matches('input, textarea, select')) return;
    route({ keepScroll: true });
  }, 400);
}

async function route({ keepScroll = false } = {}) {
  if (!state.machine) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = hash.split('?');
  const [page, ...rest] = pathPart.split('/');
  const params = new URLSearchParams(query);
  for (const a of document.querySelectorAll('#nav a')) {
    const target = a.getAttribute('href').slice(2);
    let alias = { item: 'items', character: 'characters', quest: 'quests', zone: 'zones', recording: 'recordings', session: 'sessions', map: 'locations', texts: 'lore', vendors: 'people', creatures: 'bestiary', npcs: 'people', creature: 'bestiary' }[page] ?? page;
    if (page === 'npc') {
      const n = state.cache?.world?.byNpc.get(rest.map(decodeURIComponent).join('/'));
      alias = n?.attackable ? 'bestiary' : n?.object ? 'items' : 'people';
    }
    a.classList.toggle('active', target.split('?')[0] === alias);
  }
  const render = state.machine.config.fresh && page !== 'setup' ? pages.setup : pages[page] ?? pages[''];
  const y = window.scrollY;
  try {
    main.innerHTML = await render(rest.map(decodeURIComponent).join('/'), params);
  } catch (err) {
    main.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    console.error(err);
  }
  // Entrance: children rise in one after another; numbers count up.
  if (!keepScroll) {
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
    [...main.children].forEach((child, i) => child.style.setProperty('--i', Math.min(i, 12)));
    animateNumbers(main);
  }
  moveNavGlow();
  window.scrollTo(0, keepScroll ? y : 0);
  const box = document.getElementById('searchBox');
  if (box && page === 'search' && document.activeElement !== box) box.value = params.get('q') || '';
  // Wowhead's script turns item links into icons with tooltips.
  setTimeout(() => window.$WowheadPower?.refreshLinks?.(), 50);
}

async function loadConfig() {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.url && cfg.anonKey) return cfg;
    }
  } catch { /* not on Netlify */ }
  try {
    return JSON.parse(localStorage.getItem('chronicler.supabase') || 'null');
  } catch {
    return null;
  }
}

async function makeClient(cfg) {
  if (window.__chroniclerTestClient) return window.__chroniclerTestClient;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  return createClient(cfg.url, cfg.anonKey);
}

async function startApp(user) {
  state.user = user;
  state.store = new CloudStore(state.client, user.id);
  main.innerHTML = '<div class="loading"><span class="brand-mark spin"></span><span class="muted">Opening your chronicle…</span></div>';
  const all = await state.store.loadAll();
  Object.assign(state, {
    sessions: all.sessions, rows: all.recordings, clock: all.clock, settings: all.settings,
    items: all.items, screenshots: all.screenshots, schema2: all.schema2,
  });
  state.machine = new Machine({ store: state.store, state, changed, notify: toast });
  document.getElementById('nav').hidden = false;
  renderStatus();
  await route();
  state.machine.start().then(changed).catch((err) => toast(err.message));
}

async function boot() {
  const cfg = await loadConfig();
  if (!cfg && !window.__chroniclerTestClient) return renderConnect();
  try {
    state.client = await makeClient(cfg);
    const { data } = await state.client.auth.getSession();
    if (!data.session) return renderLogin();
    await startApp(data.session.user);
  } catch (err) {
    renderConnect(`Could not reach Supabase: ${err.message}`);
  }
}

// The gold bar in the sidebar slides to the active page.
function moveNavGlow() {
  const nav = document.getElementById('nav');
  const active = nav?.querySelector('a.active');
  let glow = nav?.querySelector('.nav-glow');
  if (!nav) return;
  if (!glow) { glow = document.createElement('span'); glow.className = 'nav-glow'; nav.prepend(glow); }
  if (!active) { glow.style.opacity = '0'; return; }
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  glow.style.opacity = '1';
  glow.style.transform = `translateY(${ar.top - nr.top + nav.scrollTop}px)`;
  glow.style.height = `${ar.height}px`;
}

window.addEventListener('resize', moveNavGlow);
window.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    const box = document.getElementById('searchBox');
    document.getElementById('side')?.classList.add('open');
    box?.focus();
    box?.select();
  }
});
window.addEventListener('hashchange', () => { document.getElementById('side')?.classList.remove('open'); route(); });
document.getElementById('menuToggle')?.addEventListener('click', (ev) => {
  const side = document.getElementById('side');
  side.classList.toggle('open');
  ev.currentTarget.setAttribute('aria-expanded', side.classList.contains('open'));
});
document.getElementById('search')?.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = document.getElementById('searchBox').value.trim();
  if (q) location.hash = `#/search?q=${enc(q)}`;
});
boot();
