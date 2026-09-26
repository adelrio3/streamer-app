// Chronicler web app. Plain modules, no build step. Data lives in Supabase;
// each computer does its part in the background (see lib/machine.js).

import { CloudStore } from './lib/cloud.js';
import { Machine } from './lib/machine.js';
import { buildCodex } from './lib/codex.js';
import { describe, category } from './lib/describe.js';
import { clockModel, resolveRecordings, buildTimelines, eventMs } from './lib/timeline.js';
import { toSRT, toCSV, toChapters, toKillsCSV, toFCPXML, lifetimeKillsBefore, stem } from './lib/exports.js';
import { foldersSupported } from './lib/folders.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('status');

const CATS = ['quest', 'lore', 'combat', 'loot', 'mark', 'travel', 'progress'];
const CAT_NAMES = { quest: 'Quests', lore: 'Lore', combat: 'Combat', loot: 'Loot', mark: 'Marks', travel: 'Travel', progress: 'Progress' };
const MARK_NAMES = { lore: 'Lore beat', shot: 'Beautiful shot', funny: 'Funny', redo: 'Redo', mark: 'Mark' };
const WOWHEAD = { classic: 'https://www.wowhead.com/classic', tbc: 'https://www.wowhead.com/tbc', wrath: 'https://www.wowhead.com/wotlk', cata: 'https://www.wowhead.com/cata', mop: 'https://www.wowhead.com/mop-classic' };

// sessions: from the addon; rows: recording rows; clock: clock samples.
const state = { client: null, store: null, user: null, machine: null, sessions: [], rows: [], clock: [], settings: {}, cache: null };
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
    state.cache = { clock, recordings, timelines, where, codex };
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
      ${card(t.kills, 'creatures slain', '#/creatures')}
      ${card(t.npcs, 'NPCs met', '#/npcs')}
      ${card(t.items, 'distinct items', '#/items')}
      ${card(t.books, 'books & plaques', '#/texts')}
      ${card(t.marks, 'marked moments', '#/marks')}
    </div>
    <h2>Characters</h2>
    ${c.characters.length ? `<div class="cards">${c.characters.map((ch) => `<div class="card"><div class="num">${esc(ch.name ?? '?')}</div>
      <div class="lbl">Level ${ch.level} ${esc(ch.race ?? '')} ${esc(ch.class ?? '')} · ${esc(ch.realm ?? '')}</div>
      <div class="lbl">${ch.sessions} sessions · ${duration(ch.playSeconds)} logged</div></div>`).join('')}</div>` : '<p class="muted">No sessions yet. With the app open on your gaming PC, log in to WoW and then log out or type /reload.</p>'}
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

pages.creatures = async () => {
  const c = await codex();
  return `<h1>Creatures</h1>
    <p class="muted">Everything you have killed or helped kill. The kill counter export on each recording uses the same numbers.</p>
    ${table(c.creatures, [
      { label: 'Creature', value: (k) => k.name, html: (k) => `<a href="#/creature/${enc(k.key)}">${esc(k.name)}</a>` },
      { label: 'Kills', value: (k) => k.kills, num: true },
      { label: 'Zones', value: (k) => k.zones.join(', ') },
      { label: 'First kill', value: (k) => k.moments[0]?.t ?? 0, html: (k) => play(k.moments[0]) },
      { label: '', html: (k) => wowhead('npc', k.npcId) },
    ], { search: (k) => `${k.name} ${k.zones.join(' ')}`, sort: 1, desc: true, empty: 'No kills logged yet.' })}`;
};

pages.creature = async (key) => {
  const c = await codex();
  const k = c.creatures.find((x) => x.key === key);
  if (!k) return '<p>Not found.</p>';
  return `<p><a href="#/creatures">← Creatures</a></p>
    <div class="row spread"><h1>${esc(k.name)}</h1>${wowhead('npc', k.npcId)}</div>
    <p class="muted">${k.kills} kills · ${esc(k.zones.join(', '))}${k.npcId ? ` · NPC ID ${k.npcId}` : ''}</p>
    ${table(k.moments.map((m, i) => ({ ...m, n: i + 1 })), [
      { label: '#', value: (m) => m.n, num: true },
      { label: 'Footage', value: (m) => m.t, html: (m) => play(m) },
      { label: 'When', value: (m) => m.t, html: (m) => esc(when(m.t)) },
    ], { search: () => '', sort: 0 })}`;
};

pages.npcs = async () => {
  const c = await codex();
  return `<h1>NPCs</h1>
    <p class="muted">Everyone who spoke to you, yelled near you, or handed you a quest.</p>
    ${table(c.npcs, [
      { label: 'Name', value: (n) => n.name, html: (n) => `<a href="#/npc/${enc(n.key)}">${esc(n.name)}</a>` },
      { label: 'Lines', value: (n) => n.lines.length, num: true },
      { label: 'Quests', value: (n) => n.quests.length, num: true },
      { label: 'Zones', value: (n) => n.zones.join(', ') },
    ], { search: (n) => `${n.name} ${n.lines.map((l) => l.text).join(' ')}`, empty: 'No NPCs yet.' })}`;
};

pages.npc = async (key) => {
  const c = await codex();
  const n = c.npcs.find((x) => x.key === key);
  if (!n) return '<p>Not found.</p>';
  const quests = n.quests.map((qk) => c.quests.find((q) => q.key === qk)).filter(Boolean);
  return `<p><a href="#/npcs">← NPCs</a></p>
    <div class="row spread"><h1>${esc(n.name)}</h1>${wowhead(n.kind === 'GameObject' ? 'object' : 'npc', n.npcId)}</div>
    <p class="muted">${esc(n.zones.join(', '))}</p>
    ${quests.length ? `<h2>Quests</h2><ul>${quests.map((q) => `<li><a href="#/quest/${enc(q.key)}">${esc(q.title)}</a> <span class="chip ${q.status}">${q.status}</span></li>`).join('')}</ul>` : ''}
    ${n.lines.length ? `<h2>Dialogue</h2>${n.lines.map((l) => `<div class="row"><span class="chip">${esc(l.kind)}</span>${play(firstFootage(l.moments))}${l.moments.length > 1 ? `<span class="muted small">heard ${l.moments.length}×</span>` : ''}</div>${lore(l.text)}`).join('')}` : ''}`;
};

pages.items = async () => {
  const c = await codex();
  return `<h1>Items</h1>
    <p class="muted">Looted, received from quests or vendors, and crafted.</p>
    ${table(c.items, [
      { label: 'Item', value: (i) => i.name, html: (i) => `<span class="q${i.quality ?? 1}">${esc(i.name ?? `Item ${i.id}`)}</span>` },
      { label: 'Type', value: (i) => [i.type, i.subType].filter(Boolean).join(' · ') },
      { label: 'iLvl', value: (i) => i.ilvl ?? 0, html: (i) => i.ilvl ?? '', num: true },
      { label: 'Count', value: (i) => i.count, num: true },
      { label: 'How', value: (i) => Object.keys(i.sources).join(', ') },
      { label: 'First', value: (i) => i.moments[0]?.t ?? 0, html: (i) => play(firstFootage(i.moments)) },
      { label: '', html: (i) => wowhead('item', i.id) },
    ], { search: (i) => `${i.name} ${i.type} ${i.subType}`, sort: 5, empty: 'No items yet.' })}`;
};

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
    <p>${creatures.map((k) => `<a href="#/creature/${enc(k.key)}">${esc(k.name)}</a> <span class="muted">${k.kills}</span>`).join(' · ') || '<span class="muted">None</span>'}</p>
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
  const list = derived().recordings.map(recSummary);
  return `<h1>Recordings</h1>
    <p class="muted">Reported by the app on your recording computer. Videos stay on that computer; only their times are shared.</p>
    ${table(list, [
      { label: 'Recording', value: (r) => r.start, html: (r) => `<a href="#/recording/${r.id}">${esc(r.name)}</a>` },
      { label: 'Length', value: (r) => r.duration, html: (r) => duration(r.duration), num: true },
      { label: 'Events', value: (r) => r.events, num: true },
      { label: 'Quests', value: (r) => r.counts.quest ?? 0, num: true },
      { label: 'Kills', value: (r) => r.counts.combat ?? 0, num: true },
      { label: 'Marks', value: (r) => r.counts.mark ?? 0, num: true },
      { label: 'Zones', value: (r) => r.zones.join(', ') },
      { label: 'Timing', value: (r) => r.source, html: (r) => `<span class="chip">${esc(r.source)}</span>` },
    ], { search: (r) => `${r.name} ${r.zones.join(' ')}`, sort: 0, desc: true, empty: 'No recordings yet. Open this app on your recording computer with OBS running.' })}`;
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
    <div class="row spread"><h1>${esc(r.name)}</h1><span class="muted">${esc(new Date(r.start).toLocaleString())} · ${duration(r.duration)}</span></div>
    <div class="player">
      <div>
        <video id="video" controls preload="metadata"></video>
        <p class="muted small" id="videoNote"></p>
        ${syncPanel(r)}
        <div class="panel">
          <h3>Export for editing</h3>
          <div class="filters" id="exportCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" checked><span class="cat cat-${c}"></span>${CAT_NAMES[c]} <span class="muted">${r.counts[c] ?? 0}</span></label>`).join('')}</div>
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
        <div class="filters" id="tlCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" ${c === 'travel' ? '' : 'checked'}><span class="cat cat-${c}"></span>${CAT_NAMES[c]}</label>`).join('')}</div>
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
      const cats = ['xml', 'srt', 'csv'].includes(fmt) && checked.length < CATS.length ? new Set(checked) : null;
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
      <div class="panel"><h3>In game</h3><p class="small">Key bindings: Options › Keybindings › AddOns › Chronicler. Bind <b>Sync flash</b> and the marks you want. Press Sync right after starting a recording.</p></div>` : ''}
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
    a.classList.toggle('active', target === page || target === `${page}s`);
  }
  const render = state.machine.config.fresh && page !== 'setup' ? pages.setup : pages[page] ?? pages[''];
  const y = window.scrollY;
  try {
    main.innerHTML = await render(rest.map(decodeURIComponent).join('/'), params);
  } catch (err) {
    main.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
  window.scrollTo(0, keepScroll ? y : 0);
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
  Object.assign(state, { sessions: all.sessions, rows: all.recordings, clock: all.clock, settings: all.settings });
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
boot();
