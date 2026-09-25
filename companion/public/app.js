// Chronicler companion UI. Plain modules, no build step.

const main = document.getElementById('main');
const statusEl = document.getElementById('status');

const CATS = ['quest', 'lore', 'combat', 'loot', 'mark', 'travel', 'progress'];
const CAT_NAMES = { quest: 'Quests', lore: 'Lore', combat: 'Combat', loot: 'Loot', mark: 'Marks', travel: 'Travel', progress: 'Progress' };
const MARK_NAMES = { lore: 'Lore beat', shot: 'Beautiful shot', funny: 'Funny', redo: 'Redo', mark: 'Mark' };
const WOWHEAD = { classic: 'https://www.wowhead.com/classic', tbc: 'https://www.wowhead.com/tbc', wrath: 'https://www.wowhead.com/wotlk', cata: 'https://www.wowhead.com/cata', mop: 'https://www.wowhead.com/mop-classic' };

let status = null;
let codexCache = null;

// Helpers -----------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

async function api(path, opts) {
  const res = await fetch(`/api/${path}`, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function codex(force = false) {
  if (!codexCache || force) codexCache = await api('codex');
  return codexCache;
}

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
  const base = WOWHEAD[status?.latestExpansion] || 'https://www.wowhead.com';
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

async function refreshStatus() {
  try {
    status = await api('status');
  } catch {
    statusEl.innerHTML = '<span class="pill"><span class="dot bad"></span>companion offline</span>';
    return;
  }
  const obs = status.obs;
  const obsPill = !status.config.obs.enabled
    ? '<span class="pill" title="Enable in Setup for exact recording times"><span class="dot"></span>OBS off</span>'
    : obs.state === 'connected'
      ? `<span class="pill"><span class="dot ${obs.recording ? 'live' : 'ok'}"></span>OBS ${obs.recording ? 'recording' : 'connected'}</span>`
      : `<span class="pill" title="${esc(obs.error || '')}"><span class="dot bad"></span>OBS ${esc(obs.state)}</span>`;
  const last = status.lastIngest ? new Date(status.lastIngest.at).toLocaleTimeString() : 'never';
  statusEl.innerHTML = `${obsPill}<span class="pill" title="Last ingest ${esc(last)}">${status.events.toLocaleString()} events</span><button id="ingest" title="Read the addon's SavedVariables now">Ingest</button>`;
  document.getElementById('ingest').onclick = async () => {
    const r = await api('ingest', { method: 'POST' });
    const added = r.files.reduce((n, f) => n + (f.added || 0) + (f.updated || 0), 0);
    codexCache = null;
    await refreshStatus();
    route();
    toast(r.files.length ? `Ingested ${r.files.length} file(s), ${added} new or updated session(s).` : 'No SavedVariables found. Check Setup.');
  };
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
  const c = await codex(true);
  const t = c.totals;
  const needsSetup = !status.config.wowPaths.length || !status.config.recordingsDir;
  const recentMarks = c.marks.slice(-8).reverse();
  return `
    ${needsSetup ? `<div class="notice">Start on the <a href="#/setup">Setup</a> page: point the companion at your WoW folder and your OBS recordings folder.</div>` : ''}
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
      <div class="lbl">${ch.sessions} sessions · ${duration(ch.playSeconds)} logged</div></div>`).join('')}</div>` : '<p class="muted">No sessions ingested yet. Log in with the addon installed, then log out or /reload.</p>'}
    <h2>Latest marks</h2>
    ${recentMarks.length ? `<table><tbody>${recentMarks.map((m) => `<tr><td>${play(m)}</td><td>${esc(MARK_NAMES[m.kind] ?? m.kind)}</td><td>${esc(m.note ?? '')}</td><td class="muted">${esc(m.sz ? `${m.z}: ${m.sz}` : m.z ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Press a Chronicler key binding in game to mark a moment.</p>'}`;
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
  const list = await api('sessions');
  return `<h1>Sessions</h1>
    <p class="muted">One per login or /reload.</p>
    ${table(list, [
      { label: 'Started', value: (s) => s.first ?? s.started, html: (s) => `<a href="#/session/${enc(s.id)}">${esc(when(s.first ?? s.started))}</a>` },
      { label: 'Character', value: (s) => `${s.char?.name ?? ''} (${s.char?.class ?? ''})` },
      { label: 'Length', value: (s) => (s.last ?? 0) - (s.first ?? 0), html: (s) => duration((s.last ?? 0) - (s.first ?? 0)), num: true },
      { label: 'Events', value: (s) => s.events, num: true },
      { label: 'Zones', value: (s) => s.zones.join(', ') },
      { label: 'Client', value: (s) => `${s.build?.version ?? ''} ${s.flavor ?? ''}` },
    ], { search: (s) => `${s.char?.name} ${s.zones.join(' ')}`, sort: 0, desc: true, empty: 'No sessions ingested yet.' })}`;
};

pages.session = async (id) => {
  const s = await api(`sessions/${enc(id)}`);
  return `<p><a href="#/sessions">← Sessions</a></p>
    <h1>${esc(s.char?.name ?? '')} · ${esc(when(s.events[0]?.t ?? s.started))}</h1>
    <p class="muted">${s.events.length} events · ${s.events.filter((e) => e.footage).length} on video</p>
    ${eventTable(s.events)}`;
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

pages.recordings = async () => {
  const list = await api('recordings');
  const dir = status.config.recordingsDir;
  return `<div class="row spread"><h1>Recordings</h1><button id="exportAll">Write all exports</button></div>
    <p class="muted">${dir ? `From <code>${esc(dir)}</code>.` : 'Set your OBS recordings folder in <a href="#/setup">Setup</a>.'} Times come from OBS when it was connected, otherwise from the file name.</p>
    ${table(list, [
      { label: 'Recording', value: (r) => r.start, html: (r) => `<a href="#/recording/${r.id}">${esc(r.name)}</a>` },
      { label: 'Length', value: (r) => r.duration, html: (r) => duration(r.duration), num: true },
      { label: 'Events', value: (r) => r.events, num: true },
      { label: 'Quests', value: (r) => r.counts.quest ?? 0, num: true },
      { label: 'Kills', value: (r) => r.counts.combat ?? 0, num: true },
      { label: 'Marks', value: (r) => r.counts.mark ?? 0, num: true },
      { label: 'Zones', value: (r) => r.zones.join(', ') },
      { label: 'Timing', value: (r) => r.source, html: (r) => `<span class="chip">${esc(r.source)}</span>` },
    ], { search: (r) => `${r.name} ${r.zones.join(' ')}`, sort: 0, desc: true, empty: 'No recordings found.' })}`;
};

pages.recording = async (id, params) => {
  const r = await api(`recordings/${enc(id)}`);
  const start = Number(params.get('t') || 0);
  setTimeout(() => wirePlayer(r, start));
  const exportLink = (fmt, label) => `<a class="btn" data-fmt="${fmt}" href="/api/recordings/${r.id}/export/${fmt}">${label}</a>`;
  return `<p><a href="#/recordings">← Recordings</a></p>
    <div class="row spread"><h1>${esc(r.name)}</h1><span class="muted">${esc(new Date(r.start).toLocaleString())} · ${duration(r.duration)}</span></div>
    <div class="player">
      <div>
        <video id="video" controls preload="metadata" src="/media/${r.id}"></video>
        <p class="muted small" id="videoNote"></p>
        <div class="panel">
          <h3>Export for editing</h3>
          <div class="filters" id="exportCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" checked><span class="cat cat-${c}"></span>${CAT_NAMES[c]} <span class="muted">${r.counts[c] ?? 0}</span></label>`).join('')}</div>
          <div class="row">
            ${exportLink('xml', 'Premiere markers (.xml)')}
            ${exportLink('srt', 'Captions (.srt)')}
            ${exportLink('csv', 'Events (.csv)')}
            ${exportLink('kills', 'Kill counter (.csv)')}
            ${exportLink('chapters', 'YouTube chapters')}
          </div>
          <p class="muted small">Premiere: File › Import the .xml to get a sequence of this recording with a marker per event. Or drop the .srt on the timeline as a caption track. The category checkboxes apply to markers, captions and events.</p>
        </div>
      </div>
      <div>
        <div class="filters" id="tlCats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" ${c === 'travel' ? '' : 'checked'}><span class="cat cat-${c}"></span>${CAT_NAMES[c]}</label>`).join('')}</div>
        <div class="timeline" id="timeline"></div>
      </div>
    </div>`;
};

function wirePlayer(r, start) {
  const video = document.getElementById('video');
  const tl = document.getElementById('timeline');
  if (!video || !tl) return;
  video.addEventListener('loadedmetadata', () => { if (start) video.currentTime = start; }, { once: true });
  video.addEventListener('error', () => {
    document.getElementById('videoNote').textContent = 'Your browser cannot play this file. MKV often fails: set OBS to record Hybrid MP4, or use File › Remux Recordings. Timestamps and exports still work.';
  });
  const shownCats = () => new Set([...document.querySelectorAll('#tlCats input:checked')].map((i) => i.value));
  const draw = () => {
    const cats = shownCats();
    tl.innerHTML = r.events.map((e, i) => (cats.has(e.cat)
      ? `<div class="ev" data-i="${i}" data-o="${e.offset}"><span class="tc">${tc(e.offset)}</span><span><span class="cat cat-${e.cat}"></span>${esc(e.label)}</span></div>`
      : '')).join('') || '<p class="muted" style="padding:10px">No events in this recording.</p>';
  };
  draw();
  document.getElementById('tlCats').addEventListener('change', draw);
  tl.addEventListener('click', (ev) => {
    const row = ev.target.closest('.ev');
    if (row) { video.currentTime = Number(row.dataset.o); video.play().catch(() => {}); }
  });
  let lastNow = null;
  video.addEventListener('timeupdate', () => {
    const rows = [...tl.querySelectorAll('.ev')];
    let cur = null;
    for (const row of rows) { if (Number(row.dataset.o) <= video.currentTime + 0.25) cur = row; else break; }
    if (cur !== lastNow) {
      lastNow?.classList.remove('now');
      cur?.classList.add('now');
      cur?.scrollIntoView({ block: 'nearest' });
      lastNow = cur;
    }
  });
  const updateLinks = () => {
    const cats = [...document.querySelectorAll('#exportCats input:checked')].map((i) => i.value);
    for (const a of document.querySelectorAll('[data-fmt]')) {
      const base = `/api/recordings/${r.id}/export/${a.dataset.fmt}`;
      a.href = ['xml', 'srt', 'csv'].includes(a.dataset.fmt) && cats.length < CATS.length ? `${base}?only=${cats.join(',')}` : base;
    }
  };
  document.getElementById('exportCats').addEventListener('change', updateLinks);
}

pages.setup = async () => {
  const cfg = status.config;
  const sv = status.savedVariables;
  const ingest = status.lastIngest;
  setTimeout(wireSetup);
  return `<h1>Setup</h1>
    <div class="panel">
      <h3>1. Install the addon</h3>
      <ol class="steps">
        <li>Copy the <code>addon/Chronicler</code> folder from this project into <code>World of Warcraft\\_classic_era_\\Interface\\AddOns\\</code> (or <code>_anniversary_</code>, <code>_classic_</code>, <code>_retail_</code>).</li>
        <li>In game, open Key Bindings › AddOns › Chronicler and bind the mark keys (lore beat, beautiful shot, funny, redo).</li>
        <li><code>/chron</code> shows what has been logged. Data reaches this app when you log out or <code>/reload</code>.</li>
      </ol>
    </div>
    <form id="setup" class="panel">
      <h3>2. Folders</h3>
      <label><span>World of Warcraft folder(s), one per line. The root folder works; every flavor inside is scanned.</span>
        <textarea name="wowPaths" placeholder="C:\\Program Files (x86)\\World of Warcraft">${esc(cfg.wowPaths.join('\n'))}</textarea></label>
      <p class="small">${sv.length ? `Found: ${sv.map((f) => `<code>${esc(f.file)}</code>`).join('<br>')}` : '<span class="muted">No Chronicler SavedVariables found yet. They appear after your first logout or /reload with the addon enabled.</span>'}</p>
      ${ingest?.files?.some((f) => f.error) ? `<div class="notice error">${ingest.files.filter((f) => f.error).map((f) => esc(`${f.file}: ${f.error}`)).join('<br>')}</div>` : ''}
      <label><span>OBS recordings folder (Settings › Output › Recording Path)</span>
        <input type="text" name="recordingsDir" value="${esc(cfg.recordingsDir)}" placeholder="C:\\Users\\you\\Videos" style="width:100%"></label>
      <div class="grid2">
        <label><span>OBS filename format (Settings › Advanced › Recording)</span><input type="text" name="filenamePattern" value="${esc(cfg.filenamePattern)}"></label>
        <label><span>Clock correction, seconds (if markers land early or late)</span><input type="number" step="0.1" name="clockOffset" value="${cfg.clockOffset}"></label>
      </div>
      <h3>3. Video</h3>
      <div class="grid2">
        <label><span>Recording frame rate</span><input type="number" step="0.001" name="fps" value="${cfg.fps}"></label>
        <label><span>Width</span><input type="number" name="width" value="${cfg.width}"></label>
        <label><span>Height</span><input type="number" name="height" value="${cfg.height}"></label>
        <label><span>Caption length, seconds</span><input type="number" step="0.5" name="cueSeconds" value="${cfg.cueSeconds}"></label>
      </div>
      <h3>4. OBS connection (optional)</h3>
      <p class="muted small">In OBS: Tools › WebSocket Server Settings › Enable. With this on, the companion logs the exact start and stop of every recording, so custom file names and split files line up perfectly.</p>
      <label class="check"><input type="checkbox" name="obs.enabled" ${cfg.obs.enabled ? 'checked' : ''}><span>Connect to OBS</span></label>
      <div class="grid2">
        <label><span>Host</span><input type="text" name="obs.host" value="${esc(cfg.obs.host)}"></label>
        <label><span>Port</span><input type="number" name="obs.port" value="${cfg.obs.port}"></label>
        <label><span>Password</span><input type="password" name="obs.password" value="${esc(cfg.obs.password)}" autocomplete="off"></label>
      </div>
      <p class="small">${status.obs.error ? `<span style="color:var(--red)">${esc(status.obs.error)}</span>` : ''}</p>
      <button class="primary" type="submit">Save</button>
    </form>`;
};

function wireSetup() {
  const form = document.getElementById('setup');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const body = {
      wowPaths: f.get('wowPaths'), recordingsDir: f.get('recordingsDir').trim(), filenamePattern: f.get('filenamePattern'),
      clockOffset: f.get('clockOffset'), fps: f.get('fps'), width: f.get('width'), height: f.get('height'), cueSeconds: f.get('cueSeconds'),
      obs: { enabled: f.get('obs.enabled') === 'on', host: f.get('obs.host'), port: f.get('obs.port'), password: f.get('obs.password') },
    };
    await api('config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    codexCache = null;
    await refreshStatus();
    toast('Saved.');
    route();
  });
}

// Router --------------------------------------------------------------------

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = hash.split('?');
  const [page, ...rest] = pathPart.split('/');
  const params = new URLSearchParams(query);
  for (const a of document.querySelectorAll('#nav a')) {
    const target = a.getAttribute('href').slice(2);
    a.classList.toggle('active', target === page || (target === `${page}s`));
  }
  const render = pages[page] ?? pages[''];
  if (!status) await refreshStatus();
  try {
    main.innerHTML = await render(rest.map(decodeURIComponent).join('/'), params);
  } catch (err) {
    main.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
refreshStatus().then(route);
setInterval(async () => {
  const before = status?.events;
  await refreshStatus();
  // New data arrived (the addon wrote SavedVariables): refresh the view.
  if (before !== undefined && status?.events !== before) { codexCache = null; if (!location.hash.startsWith('#/recording/')) route(); }
}, 10000);
