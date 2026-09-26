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
import { findSegments, findHighlights, HIGHLIGHT_KINDS, timeOfDay } from './lib/footage.js';
import { buildIndex, search } from './lib/search.js';
import { tooltipLine } from './lib/sessions.js';
import { money, RANKS, qualityName } from './lib/describe.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('status');

const CATS = ['quest', 'lore', 'combat', 'loot', 'mark', 'travel', 'progress', 'world', 'economy', 'character', 'social'];
const CAT_NAMES = { quest: 'Quests', lore: 'Lore', combat: 'Combat', loot: 'Loot', mark: 'Marks', travel: 'Travel', progress: 'Progress', world: 'NPCs seen', economy: 'Vendors & gold', character: 'Character', social: 'Social' };
// Busy categories start switched off in timelines and exports.
const QUIET_CATS = new Set(['travel', 'world', 'economy', 'character', 'social']);
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
    const timelines = buildTimelines(state.sessions, recordings, clock);
    const where = new Map();
    for (const [rec, events] of timelines) for (const e of events) where.set(`${e.session}|${e.t}`, { rec, offset: e.offset });
    const codex = buildCodex(state.sessions, (sid, t) => where.get(`${sid}|${t}`) ?? null);
    const moment = (sess, e) => ({ session: sess.id, t: e.t, footage: where.get(`${sess.id}|${e.t}`) ?? null });
    const world = buildWorld(state.sessions, state.items, moment);
    const characters = buildCharacters(state.sessions, moment, timelines, recordings);
    const recChars = recordingCharacters(state.sessions, timelines);
    state.cache = { clock, recordings, timelines, where, codex, moment, world, characters, recChars, index: null };
  }
  return state.cache;
}

async function codex() {
  return derived().codex;
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

function lore(text) {
  return text ? `<div class="lore">${esc(text).replace(/\$[Nn]/g, '<i>&lt;name&gt;</i>').replace(/\$[Cc]/g, '<i>&lt;class&gt;</i>').replace(/\$[Rr]/g, '<i>&lt;race&gt;</i>').replace(/\$[Bb]/g, '\n')}</div>` : '';
}

// A sortable, searchable table. columns: { label, value(row), html(row), num }
function table(rows, columns, { search = (r) => JSON.stringify(r), sort = 0, desc = false, limit = 400, empty = 'Nothing here yet.' } = {}) {
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
    el.querySelector('thead').innerHTML = `<tr>${columns.map((c, i) => `<th class="${c.num ? 'num' : ''}" data-i="${i}">${esc(c.label)}${i === state.sort ? (state.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>`;
    el.querySelector('tbody').innerHTML = shown.length
      ? shown.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.value(r))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="muted">${esc(empty)}</td></tr>`;
    el.querySelector('.more').hidden = list.length <= state.limit;
  };
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('input').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
    el.querySelector('thead').addEventListener('click', (ev) => {
      const i = Number(ev.target.closest('th')?.dataset.i);
      if (Number.isNaN(i)) return;
      state = { ...state, desc: state.sort === i ? !state.desc : Boolean(columns[i].num), sort: i };
      render();
    });
    el.querySelector('.more').addEventListener('click', () => { state.limit += 400; render(); });
    render();
  });
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
  el.className = 'notice';
  el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9;max-width:420px';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// Pages ---------------------------------------------------------------------

const pages = {};

pages[''] = async () => {
  const c = await codex();
  const t = c.totals;
  const m = state.machine;
  const needsSetup = m.config.fresh || (m.config.plays && m.wow.state !== 'ok') || (m.config.records && m.rec.state !== 'ok');
  const recentMarks = c.marks.slice(-8).reverse();
  return `
    ${needsSetup ? `<div class="notice">This computer (<b>${esc(m.name)}</b>) isn't fully set up yet. <a href="#/setup">Open This computer</a> to finish.</div>` : ''}
    <h1>Your chronicle</h1>
    <div class="cards">
      ${card(t.quests, 'quests completed', '#/quests')}
      ${card(t.kills, 'creatures slain', '#/bestiary?show=killed')}
      ${card(derived().world.npcs.length, 'NPCs and creatures seen', '#/bestiary')}
      ${card(derived().world.items.length, 'items catalogued', '#/items')}
      ${card(derived().world.vendors.length, 'vendors', '#/vendors')}
      ${card(t.books, 'books & plaques', '#/texts')}
      ${card(t.marks, 'marked moments', '#/marks')}
    </div>
    <h2>Characters</h2>
    ${derived().characters.length ? `<div class="cards">${derived().characters.map(charCard).join('')}</div>` : '<p class="muted">No sessions yet. With the app open on your gaming PC, log in to WoW and then log out or type /reload.</p>'}
    <h2>Latest marks</h2>
    ${recentMarks.length ? `<table><tbody>${recentMarks.map((mk) => `<tr><td>${play(mk)}</td><td>${esc(MARK_NAMES[mk.kind] ?? mk.kind)}</td><td>${esc(mk.note ?? '')}</td><td class="muted">${esc(mk.sz ? `${mk.z}: ${mk.sz}` : mk.z ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Press a Chronicler key binding in game to mark a moment.</p>'}`;
};

function card(n, label, href) {
  return `<a class="card" href="${href}"><div class="num">${Number(n).toLocaleString()}</div><div class="lbl">${esc(label)}</div></a>`;
}

pages.quests = async () => {
  const c = await codex();
  return `<h1>Quests</h1>
    <p class="muted">Every quest you have been offered, accepted or turned in, with the text exactly as you read it.</p>
    ${table(c.quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title ?? `Quest ${q.qid}`)}</a>` },
      { label: 'Zone', value: (q) => q.zone },
      { label: 'Giver', value: (q) => q.giver?.name ?? '' },
      { label: 'Lvl', value: (q) => q.level ?? 0, html: (q) => q.level ?? '', num: true },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { search: (q) => `${q.title} ${q.zone} ${q.giver?.name} ${q.text}`, sort: 5, empty: 'No quests logged yet.' })}`;
};

pages.quest = async (key) => {
  const c = await codex();
  const q = c.quests.find((x) => x.key === key);
  if (!q) return '<p>Quest not found.</p>';
  const moments = [
    ...q.offered.map((m) => ['Offered', m]), ...q.accepted.map((m) => ['Accepted', m]),
    ...q.turnedIn.map((m) => ['Turned in', m]), ...q.abandoned.map((m) => ['Abandoned', m]),
  ].sort((a, b) => a[1].t - b[1].t);
  return `<p><a href="#/quests">← Quests</a></p>
    <div class="row spread"><h1>${esc(q.title ?? `Quest ${q.qid}`)}</h1><div class="row"><span class="chip ${q.status}">${q.status}</span>${wowhead('quest', q.qid)}</div></div>
    <p class="muted">${esc(q.zone ?? '')}${q.giver ? ` · from <a href="#/npc/${enc(q.giver.npcId ? `n${q.giver.npcId}` : `s${q.giver.name}`)}">${esc(q.giver.name)}</a>` : ''}${q.turnInNpc && q.turnInNpc.name !== q.giver?.name ? ` · turn in to ${esc(q.turnInNpc.name)}` : ''}${q.level ? ` · accepted at level ${q.level}` : ''}${q.qid ? ` · ID ${q.qid}` : ''}</p>
    <div class="panel"><h3>Moments</h3><table><tbody>${moments.map(([what, m]) => `<tr><td>${esc(what)}</td><td>${play(m)}</td><td class="muted">${esc(when(m.t))}</td></tr>`).join('')}</tbody></table></div>
    ${q.text ? `<h3>Description</h3>${lore(q.text)}` : ''}
    ${q.objectives ? `<h3>Objectives</h3>${lore(q.objectives)}` : ''}
    ${q.progress ? `<h3>Progress</h3>${lore(q.progress)}` : ''}
    ${q.reward ? `<h3>Completion</h3>${lore(q.reward)}` : ''}`;
};

// Bestiary -----------------------------------------------------------------

pages.creatures = (_, params) => pages.bestiary(_, new URLSearchParams('show=killed'));
pages.npcs = (_, params) => pages.bestiary(_, new URLSearchParams('show=talked'));
pages.creature = (key) => pages.npc(key);

pages.bestiary = async (_, params) => {
  const { world } = derived();
  const show = params.get('show') || 'all';
  const filters = {
    all: () => true, killed: (n) => n.kills > 0, talked: (n) => n.lines.length || n.quests.size || n.vendor || n.trainer || n.taxi,
    rare: (n) => n.rare || n.ranks.some((r) => r.includes('rare') || r === 'worldboss'), elite: (n) => n.ranks.includes('elite') || n.ranks.includes('rareelite'),
    objects: (n) => n.object,
  };
  const list = world.npcs.filter(filters[show] ?? filters.all);
  const tabs = [['all', 'Everything'], ['killed', 'Killed'], ['talked', 'Spoke with'], ['rare', 'Rares'], ['elite', 'Elites'], ['objects', 'Herbs, ore & chests']]
    .map(([k, label]) => `<a class="btn ${k === show ? 'primary' : ''}" href="#/bestiary?show=${k}">${label}</a>`).join(' ');
  return `<h1>Bestiary</h1>
    <p class="muted">Every NPC and creature you have targeted, moused over, seen on a nameplate, fought near, heard, talked to or looted.</p>
    <div class="row">${tabs}</div>
    ${table(list, [
      { label: 'Name', value: (n) => n.name, html: (n) => `${npcLink(n.key, n.name)} ${n.titles[0] ? `<span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>` : ''}` },
      { label: 'Level', value: (n) => n.minLevel ?? 0, html: (n) => `${levelText(n)} ${rankChips(n.ranks)}` },
      { label: 'Type', value: (n) => [n.ctype, n.family].filter(Boolean).join(' · ') },
      { label: 'Seen', value: (n) => n.sightings, num: true },
      { label: 'Kills', value: (n) => n.kills, num: true },
      { label: 'Loots', value: (n) => n.loots, num: true },
      { label: 'Zones', value: (n) => n.zones.join(', ') },
      { label: 'First seen', value: (n) => n.first?.t ?? 0, html: (n) => (n.first ? play(n.first) : '') },
    ], { search: (n) => `${n.name} ${n.titles.join(' ')} ${n.ctype} ${n.family} ${n.zones.join(' ')} ${n.ranks.join(' ')}`, sort: 3, desc: true, empty: 'Nothing seen yet.' })}`;
};

pages.npc = async (key) => {
  const { world, codex } = derived();
  const n = world.byNpc.get(key);
  if (!n) return '<p>Not found.</p>';
  const quests = [...n.quests].map((qk) => codex.quests.find((q) => q.key === qk)).filter(Boolean);
  const facts = [
    levelText(n) && `Level ${levelText(n)}`, rankChips(n.ranks), [n.ctype, n.family].filter(Boolean).join(' · '),
    n.react ? REACTION[n.react] : null, n.faction, n.hp ? `${n.hp.toLocaleString()} health` : null, n.npcId ? `ID ${n.npcId}` : null,
  ].filter(Boolean).join(' · ');
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  return `<p><a href="#/bestiary">← Bestiary</a></p>
    <div class="row spread"><h1>${esc(n.name)}${n.titles[0] ? ` <span class="muted small">&lt;${esc(n.titles.join('> <'))}&gt;</span>` : ''}</h1>${wowhead(n.object ? 'object' : 'npc', n.npcId)}</div>
    <p>${facts}</p>
    <p class="muted">${esc(n.zones.join(', '))}</p>
    <div class="cards">
      ${card(n.sightings, 'times seen', '#/bestiary')}${card(n.kills, 'killed', '#/bestiary?show=killed')}${card(n.loots, 'looted', '#/bestiary')}${n.killedYou ? card(n.killedYou, 'times it killed you', '#/highlights?kind=death') : ''}
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

pages.items = async () => {
  const { world } = derived();
  return `<h1>Items</h1>
    <p class="muted">Every item you have looted, seen dropped, been offered, bought, worn, carried or hovered, with everything the game says about it.</p>
    ${state.schema2 ? '' : schemaNotice()}
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
    qualityName(it.quality), info.type, info.sub, info.slot?.replace('INVTYPE_', '').toLowerCase(), info.ilvl && `item level ${info.ilvl}`,
    info.req && `requires level ${info.req}`, info.stack > 1 && `stacks to ${info.stack}`, info.sell && `sells for ${money(info.sell)}`,
    info.icon && `icon ${info.icon}`, `ID ${it.id}`,
  ].filter(Boolean).map(esc).join(' · ');
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  const quest = (r) => codex.quests.find((q) => (r.qid && q.qid === r.qid) || q.title === r.title);
  return `<p><a href="#/items">← Items</a></p>
    <div class="row"><span class="item-big">${itemLink(it.id, it.name, it.quality, { size: 'large' })}</span></div>
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

// Vendors -------------------------------------------------------------------

pages.vendors = async () => {
  const { world } = derived();
  return `<h1>Vendors</h1>
    <p class="muted">Every shop you have opened and what it sold, at what price, the last time you looked.</p>
    ${table(world.vendors, [
      { label: 'Vendor', value: (n) => n.name, html: (n) => `${npcLink(n.key, n.name)} ${n.titles[0] ? `<span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>` : ''}` },
      { label: 'Zone', value: (n) => n.vendor.zone ?? n.zones[0] ?? '' },
      { label: 'Items', value: (n) => n.vendor.items.length, num: true },
      { label: 'Limited', value: (n) => n.vendor.items.filter((i) => i.stock != null).length, num: true },
      { label: 'Repairs', value: (n) => (n.vendor.repair ? 'yes' : '') },
      { label: 'Visited', value: (n) => n.vendor.at.t, html: (n) => play(n.vendor.at) },
    ], { search: (n) => `${n.name} ${n.titles.join(' ')} ${n.zones.join(' ')} ${n.vendor.items.map((i) => i.name).join(' ')}`, sort: 0, empty: 'No vendors yet. Open a shop in game.' })}`;
};

// Characters --------------------------------------------------------------

function charCard(c) {
  const i = c.info;
  return `<a class="card" href="#/character/${enc(c.key)}"><div class="num">${esc(c.name)}</div>
    <div class="lbl">Level ${c.level} ${esc(i.race ?? '')} ${esc(i.class ?? '')} · ${esc(c.realm ?? '')}</div>
    <div class="lbl">${c.questsDone} quests · ${c.recordings.length} recordings · ${duration(c.playSeconds)} logged</div></a>`;
}

pages.characters = async () => {
  const { characters } = derived();
  return `<h1>Characters</h1>
    <p class="muted">Each character's journey: levels, quests, gear, talents, and the footage they appear in.</p>
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
  return `<p><a href="#/characters">← Characters</a></p>
    <h1>${esc(c.name)} <span class="muted small">${esc(c.realm ?? '')}</span></h1>
    <p>Level ${c.level} ${esc(i.race ?? '')} ${esc(i.class ?? '')} · ${esc(i.faction ?? '')}${i.guild ? ` · &lt;${esc(i.guild)}&gt;` : ''}${i.bind ? ` · Hearth: ${esc(i.bind)}` : ''}${moneyNow != null ? ` · ${money(moneyNow)}` : ''}</p>
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
  return `<h1>Screenshots</h1>
    <p class="muted">Taken in game while Chronicler was logging: automatically at rares, level-ups, discoveries and deaths (<code>/chron shots off</code> to stop), and whenever you press Print Screen. Your gaming PC uploads them, shrunk, while the app is open.</p>
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
  return `<h1>Footage finder</h1>
    <p class="muted">Stretches of your recordings that match, found from where you were and what you were doing every 2 seconds. Great for sleep and ambience videos.</p>
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

pages.highlights = async (_, params) => {
  const { world } = derived();
  const all = findHighlights(state.sessions, derived().moment, (id) => world.byItem.get(id)?.quality ?? null);
  const kind = params.get('kind') || 'all';
  const list = kind === 'all' ? all : all.filter((h) => h.kind === kind);
  const counts = {};
  for (const h of all) counts[h.kind] = (counts[h.kind] || 0) + 1;
  const tabs = [['all', 'Everything', all.length], ...Object.entries(HIGHLIGHT_KINDS).map(([k, label]) => [k, label, counts[k] || 0])]
    .map(([k, label, n]) => `<a class="btn ${k === kind ? 'primary' : ''}" href="#/highlights?kind=${k}">${label} <span class="muted">${n}</span></a>`).join(' ');
  return `<h1>Highlights</h1>
    <p class="muted">Moments worth a short, found automatically.</p>
    <div class="row">${tabs}</div>
    ${table(list, [
      { label: 'Footage', value: (h) => h.footage?.offset ?? -1, html: (h) => play(h) },
      { label: 'What', value: (h) => HIGHLIGHT_KINDS[h.kind], html: (h) => `<span class="chip">${esc(HIGHLIGHT_KINDS[h.kind])}</span>` },
      { label: 'Moment', value: (h) => h.label },
      { label: 'Where', value: (h) => h.zone ?? '' },
      { label: 'Character', value: (h) => h.char ?? '' },
      { label: 'When', value: (h) => h.t, html: (h) => `<span class="muted">${esc(when(h.t))}</span>` },
    ], { sort: 5, desc: true, search: (h) => `${h.label} ${h.zone} ${h.char} ${h.kind}`, empty: 'Nothing yet.' })}`;
};

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
  return `<h1>Search</h1>
    <p class="muted">${q ? `${hits.length}${hits.length === 200 ? '+' : ''} result${hits.length === 1 ? '' : 's'} for <b>${esc(q)}</b>. Searches names, quest and book text, dialogue, item tooltips (flavor text too), vendor stock and zones.` : 'Type in the search box at the top.'}</p>
    ${[...groups.entries()].map(([type, list]) => `<h2>${esc(type)}s <span class="muted small">${list.length}</span></h2><ul class="results">${list.map((h) => `<li>${h.type === 'Item' ? itemLink(Number(h.href.split('/').pop()), h.title) : `<a href="${h.href}">${esc(h.title)}</a>`} <span class="muted small">${esc(h.sub)}</span></li>`).join('')}</ul>`).join('')}`;
};

function schemaNotice() {
  return `<div class="notice">Your database needs the version 2 update for items, routes and screenshots. Copy the setup file again from <a href="https://github.com/adelrio3/streamer-app/blob/claude/wow-lore-youtube-concept-311j74/supabase/schema.sql" target="_blank" rel="noopener">supabase/schema.sql</a> (the two-squares <b>Copy raw file</b> button), paste it into <a href="https://supabase.com/dashboard/project/_/sql/new" target="_blank" rel="noopener">Supabase › SQL Editor › New query</a> and click <b>Run</b>. Then reload this page.</div>`;
}

pages.texts = async () => {
  const c = await codex();
  if (!c.books.length) return '<h1>Texts</h1><p class="muted">Books, plaques and letters you read in game appear here, page by page.</p>';
  return `<h1>Texts</h1>${c.books.map((b) => `<div class="panel"><div class="row spread"><h3>${esc(b.title)}</h3><div class="row"><span class="muted small">${esc(b.zone ?? '')}</span>${play(firstFootage(b.moments))}</div></div>
    ${b.pages.map((p, i) => `${b.pages.length > 1 ? `<div class="muted small">Page ${i + 1}</div>` : ''}${lore(p)}`).join('')}</div>`).join('')}`;
};

pages.zones = async () => {
  const c = await codex();
  const quests = new Map(c.quests.map((q) => [q.key, q]));
  return `<h1>Zones</h1>
    ${table(c.zones, [
      { label: 'Zone', value: (z) => z.name, html: (z) => `<a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` },
      { label: 'Quests done', value: (z) => z.quests.filter((k) => quests.get(k)?.status === 'done').length, num: true },
      { label: 'Quests seen', value: (z) => z.quests.length, num: true },
      { label: 'Kills', value: (z) => z.kills, num: true },
      { label: 'Subzones', value: (z) => z.subzones.length, num: true },
      { label: 'First visit', value: (z) => z.first.t, html: (z) => play(z.first) },
    ], { search: (z) => `${z.name} ${z.subzones.join(' ')}`, sort: 5 })}`;
};

pages.zone = async (name) => {
  const c = await codex();
  const z = c.zones.find((x) => x.name === name);
  if (!z) return '<p>Not found.</p>';
  const quests = z.quests.map((k) => c.quests.find((q) => q.key === k)).filter(Boolean);
  const creatures = c.creatures.filter((k) => k.zones.includes(name));
  const marks = c.marks.filter((m) => m.z === name);
  return `<p><a href="#/zones">← Zones</a></p><h1>${esc(name)}</h1>
    <p class="muted">${esc(z.subzones.join(' · '))}</p>
    <h2>Quests (${quests.filter((q) => q.status === 'done').length}/${quests.length} done)</h2>
    ${table(quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title)}</a>` },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { sort: 2 })}
    <h2>Creatures</h2>
    <p>${creatures.map((k) => `<a href="#/npc/${enc(k.key)}">${esc(k.name)}</a> <span class="muted">${k.kills}</span>`).join(' · ') || '<span class="muted">None</span>'}</p>
    ${marks.length ? `<h2>Marks</h2><table><tbody>${marks.map((m) => `<tr><td>${play(m)}</td><td>${esc(MARK_NAMES[m.kind])}</td><td>${esc(m.note ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
};

pages.marks = async () => {
  const c = await codex();
  return `<h1>Marks</h1>
    <p class="muted">Moments you flagged in game with a Chronicler key binding or <code>/chron mark</code>.</p>
    ${table(c.marks.slice().reverse(), [
      { label: 'Footage', value: (m) => m.t, html: (m) => play(m) },
      { label: 'Kind', value: (m) => MARK_NAMES[m.kind] ?? m.kind },
      { label: 'Note', value: (m) => m.note ?? '' },
      { label: 'Where', value: (m) => (m.sz ? `${m.z}: ${m.sz}` : m.z ?? '') },
      { label: 'When', value: (m) => m.t, html: (m) => esc(when(m.t)) },
    ], { search: (m) => `${m.kind} ${m.note} ${m.z} ${m.sz}`, sort: 4, desc: true, empty: 'No marks yet.' })}`;
};

pages.sessions = async () => {
  const list = state.sessions.map((s) => ({
    id: s.id, char: s.char, build: s.build, flavor: s.flavor, machine: s.machine, events: s.events.length,
    first: s.events[0]?.t ?? s.started, last: s.events.at(-1)?.t ?? s.started,
    zones: [...new Set(s.events.map((e) => e.z).filter(Boolean))],
  }));
  return `<h1>Sessions</h1>
    <p class="muted">One per WoW login or /reload, uploaded by your gaming PC.</p>
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
  return `<h1>Recordings</h1>
    <p class="muted">Reported by the app on your recording computer. Videos stay on that computer; only their times are shared.</p>
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
  return `<h1>This computer</h1>
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
    <div class="panel"><h3>Account</h3><p class="small">Logged in as <b>${esc(state.user.email)}</b>. Clock: ${m.offset == null ? 'measuring…' : `${(m.offset / 1000).toFixed(3)}s from the server (±${Math.round((m.rtt ?? 0) / 2)} ms)`}.</p><button data-act="logout">Log out</button></div>`;
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
  main.innerHTML = `<div class="panel" style="max-width:420px;margin:40px auto">
    <h1>Chronicler</h1>
    <p class="muted">Log in with the same account on your gaming PC and your recording computer. Use the same email address as your Supabase account: Supabase's built-in mailer only sends to addresses on your Supabase team.</p>
    ${message ? `<div class="notice">${message}</div>` : ''}
    <form id="login">
      <label><span>Email</span><input type="email" name="email" required autocomplete="username" style="width:100%"></label>
      <label><span>Password</span><input type="password" name="password" required minlength="6" autocomplete="current-password" style="width:100%"></label>
      <div class="row"><button class="primary" type="submit" name="mode" value="in">Log in</button><button type="submit" name="mode" value="up">Create account</button></div>
    </form></div>`;
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
    const alias = { npc: 'bestiary', item: 'items', character: 'characters', quest: 'quests', zone: 'zones', recording: 'recordings', session: 'sessions' }[page] ?? page;
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
  main.innerHTML = '<p class="muted">Loading your chronicle…</p>';
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

window.addEventListener('hashchange', () => route());
document.getElementById('search')?.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = document.getElementById('searchBox').value.trim();
  if (q) location.hash = `#/search?q=${enc(q)}`;
});
boot();
