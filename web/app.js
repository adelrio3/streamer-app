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
import { buildMaps, routesFor, cluster, LAYERS, mapImageCandidates, heatCells, questTrail, nearestServices, toGeoJSON, CLASSIC_ZONE_IDS, cachedMapImage, memoMapImage } from './lib/maps.js';
import { looseEnds } from './lib/coverage.js';
import { indexDB, questState, fits, waitingOn, zoneCoverage, allZones, unfoundGivers, zoneRares, rarePins, progressSets, givers, enders, objectives, searchEntries, raceNames, classNames, STATES, STATE_ORDER, RANK_NAMES, FACTIONS, itemClassName, ITEM_CLASS_ORDER, ZONE_GROUPS, completionTree, npcsByZone, npcTotals, requirementText } from './lib/questdb.js';
import { pastLoot, dropsBetween } from './lib/live.js';
import { planOverlays, drawStill, toOverlayXML, packReadme, iconName, iconUrl, CORNERS } from './lib/overlaypack.js';
import { makeZip } from './lib/zip.js';
import { storylines, storylineOutline } from './lib/story.js';
import { journalEntries, narrativeText } from './lib/narrative.js';
import { tales, tellTale, taleText } from './lib/tales.js';
import { findShorts, toShortXML, shortsCSV } from './lib/shorts.js';
import { assembleEpisode, toEpisodeXML, episodeChapters } from './lib/episode.js';
import { planReplay, drawReplayFrame, easeProgress } from './lib/replay.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('status');

const CATS = ['quest', 'lore', 'combat', 'loot', 'mark', 'voice', 'travel', 'progress', 'world', 'economy', 'character', 'social'];
const CAT_NAMES = { quest: 'Quests', lore: 'Lore', combat: 'Combat', loot: 'Loot', mark: 'Marks', voice: 'Narration', travel: 'Travel', progress: 'Progress', world: 'NPCs', economy: 'Vendors & gold', character: 'Character', social: 'Social' };
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
  // The Classic quest database, loaded the first time a page needs it.
  db: undefined, dbLoading: null, spawns: null, coverageWho: null,
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
    const goneSessions = new Set(state.settings.deletedSessions || []);
    const kept = goneSessions.size ? state.sessions.filter((sess) => !goneSessions.has(sess.id)) : state.sessions;
    const sessions = gone.size ? kept.map((sess) => ({ ...sess, events: sess.events.filter((e) => e.e !== 'mark' || !gone.has(markKey(sess.id, e))) })) : kept;
    const timelines = buildTimelines(sessions, recordings, clock, state.voice || []);
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

// Quest database ------------------------------------------------------------
// web/data/classic/*.json (every Classic quest, from Questie), fetched once
// the first time a page needs it. null when the files are missing.

// A data file, past a stale copy: a miss or an error is retried straight
// from the server, since the browser may have kept a 404 from before the
// file was deployed.
async function fetchData(path) {
  let res = await fetch(path);
  if (!res.ok) res = await fetch(path, { cache: 'reload' });
  if (!res.ok) throw new Error(`${path.split('/').pop()}: ${res.status}`);
  return res.json();
}

async function questDB() {
  if (state.db) return state.db;
  if (state.db === null && Date.now() - (state.dbFailedAt || 0) < 30000) return null; // try again in a moment, not on every call
  state.dbLoading ??= (async () => {
    try {
      const names = ['quests', 'npcs', 'objects', 'items', 'zones'];
      const parts = await Promise.all(names.map((n) => fetchData(`data/classic/${n}.json`)));
      state.db = indexDB({ quests: parts[0].quests, npcs: parts[1].npcs, objects: parts[2].objects, items: parts[3].items, zones: parts[4].zones });
      state.dbError = null;
      if (state.cache) state.cache.index = null;
    } catch (err) {
      console.warn('Quest database not available:', err.message);
      state.db = null;
      state.dbError = err.message;
      state.dbFailedAt = Date.now();
      toast(`The quest database did not load (${err.message}). Reload the page; it is retried automatically.`);
    }
    state.dbLoading = null;
    return state.db;
  })();
  return state.dbLoading;
}

// Spawn points (a bigger file), only for maps.
async function spawnTable() {
  if (!state.spawns) {
    try { state.spawns = (await fetchData('data/classic/spawns.json')).spawns; } catch { state.spawns = {}; }
  }
  return state.spawns;
}

// Which character the quest database is read for: the one chosen in a
// "For …" menu, else the one played most recently. 'all' means everyone.
function coverageWho() {
  const d = derived();
  const chars = d.characters.slice().sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0));
  const wanted = state.coverageWho || 'all';
  const c = wanted === 'all' ? null : chars.find((x) => x.key === wanted) ?? null;
  const who = c ? { raceToken: c.info.raceToken, classToken: c.info.classToken, faction: c.info.faction } : null;
  const { done, active } = progressSets(d.codex.quests, c ? c.key : null);
  return { key: c ? c.key : 'all', char: c, chars, ctx: { who, level: c?.level || 0, done, active } };
}

function whoSelect(cov) {
  setTimeout(() => document.getElementById('covWho')?.addEventListener('change', (ev) => { state.coverageWho = ev.target.value; route({ keepScroll: true }); }));
  const options = [['all', 'everyone'], ...cov.chars.map((c) => [c.key, `${c.name} (${[c.info.race, c.info.class].filter(Boolean).join(' ')}, level ${c.level})`])];
  return `<select id="covWho" class="inline">${options.map(([k, label]) => `<option value="${esc(k)}" ${k === cov.key ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}

const stateChip = (st) => `<span class="chip st-${st}">${esc(STATES[st] ?? st)}</span>`;

function giverLinks(db, q) {
  return givers(db, q).map((g) => (g.kind === 'npc' ? `<a href="#/npc/n${g.id}">${esc(g.name)}</a>` : g.kind === 'object' ? `${esc(g.name)} <span class="muted small">(object)</span>` : `${itemLink(g.id, g.name)} <span class="muted small">(item)</span>`)).join(', ');
}

// Why a quest is not ready: the level, the quests before it, its faction or class.
function whyNot(db, q, st, ctx) {
  if (st === 'later') return waitingOn(db, q, ctx).join(' · ');
  if (st === 'other') return [raceNames(q.ra), classNames(q.cl)].filter(Boolean).join(' · ');
  if (st === 'excluded') return 'replaced by a quest already done or taken';
  return '';
}

function coverageColumns(db, ctx, { zone = false } = {}) {
  return [
    { label: 'Status', value: (r) => STATE_ORDER.indexOf(r.state), html: (r) => stateChip(r.state) },
    { label: 'Quest', value: (r) => r.q.n, html: (r) => `<a href="#/quest/q${r.q.id}">${esc(r.q.n)}</a>${r.q.rep ? ' <span class="chip">repeatable</span>' : ''}` },
    ...(zone ? [{ label: 'Zone', value: (r) => db.zoneName(r.q.zone), html: (r) => (r.q.zone ? `<a href="#/zone/${enc(db.zoneName(r.q.zone))}">${esc(db.zoneName(r.q.zone))}</a>` : '') }] : []),
    { label: 'Lvl', value: (r) => r.q.l || 0, num: true },
    { label: 'Req', value: (r) => r.q.r || 0, num: true },
    { label: 'From', value: (r) => givers(db, r.q).map((g) => g.name).join(', '), html: (r) => giverLinks(db, r.q) },
    { label: 'Category', value: (r) => (r.q.sort ? db.zoneName(r.q.sort) : ''), html: (r) => (r.q.sort ? `<span class="muted">${esc(db.zoneName(r.q.sort))}</span>` : '') },
    { label: 'Waiting on', value: (r) => whyNot(db, r.q, r.state, ctx), html: (r) => `<span class="muted small">${esc(whyNot(db, r.q, r.state, ctx))}</span>` },
  ];
}

// Every quest of a zone from the database, with where the character stands,
// the quest givers not yet met, and the zone's rares.
async function coverageSection(zoneName) {
  const db = await questDB();
  const zoneId = db?.zoneId(zoneName);
  if (!zoneId) return '';
  const cov = coverageWho();
  const c = zoneCoverage(db, zoneId, cov.ctx);
  const codexQ = await codex();
  const found = new Set(codexQ.quests.map((q) => q.qid).filter(Boolean));
  const rows = c.rows.filter((r) => found.has(r.q.id));
  const mapId = db.zones[zoneId]?.m;
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  return `<h2 id="coverage">Quests here <span class="chip ${c.total && c.done === c.total ? 'done' : 'active'}">${c.done} of ${c.total}</span></h2>
    <p class="muted">The quests you have found in ${esc(zoneName)}, against everything the zone holds. For ${whoSelect(cov)}</p>
    <div class="cov"><div class="bar"><div style="width:${pct}%"></div></div><b>${pct}%</b></div>
    ${mapId ? `<p><a class="btn" href="#/map/${mapId}">Open the map</a></p>` : ''}
    ${table(rows, coverageColumns(db, cov.ctx), { search: (r) => `${r.q.n} ${r.q.o ?? ''} ${STATES[r.state]} ${givers(db, r.q).map((g) => g.name).join(' ')}`, sort: 0, limit: 300, empty: 'No quests found here yet.' })}`;
}

// A zone you have not been to: the database's side only.
async function dbZonePage(name) {
  const db = await questDB();
  const zoneId = db?.zoneId(name);
  if (!zoneId) return '<p>Not found.</p>';
  const zone = db.zones[zoneId];
  return `${crumb('#/zones', 'Zones')}
    ${pageHead('Zone', esc(zone.n), `You have not been here yet. ${(db.questsByZone.get(zoneId) || []).filter((q) => !q.hidden).length.toLocaleString()} quests wait here.`, zone.m ? `<div class="row"><a class="btn" href="#/map/${zone.m}">Open map</a></div>` : '')}`;
}

// Pins from the database for a zone map. Nothing: the wiki shows only what
// has been discovered, and a quest giver or rare you have not found is not.
async function dbMapPins(db, areaId) {
  return [];
  // eslint-disable-next-line no-unreachable
  if (!db || !areaId) return [];
  const spawns = await spawnTable();
  const { world } = derived();
  const cov = coverageWho();
  const c = zoneCoverage(db, areaId, cov.ctx);
  const seen = new Set(world.npcs.map((n) => n.npcId).filter(Boolean));
  const killed = new Set(world.creatures.filter((n) => n.kills > 0).map((n) => n.npcId).filter(Boolean));
  return [...unfoundGivers(db, spawns, c, { seen }), ...rarePins(zoneRares(db, spawns, areaId, { killed }))];
}

function dbQuestFacts(db, q, cov) {
  const st = questState(q, cov.ctx);
  return facts([
    q.zone ? `<a href="#/zone/${enc(db.zoneName(q.zone))}">${esc(db.zoneName(q.zone))}</a>` : '', q.sort ? esc(db.zoneName(q.sort)) : '',
    q.l ? `level ${q.l}` : '', q.r ? `needs level ${q.r}` : '', raceNames(q.ra) ? esc(raceNames(q.ra)) : 'both factions', classNames(q.cl) ? esc(classNames(q.cl)) : '',
    q.rep ? 'repeatable' : '', st === 'later' ? `waiting on ${esc(waitingOn(db, q, cov.ctx).join(', '))}` : '', `ID ${q.id}`,
  ]);
}

// Givers, turn-in, objectives, chain and rewards of a quest, from the database.
async function dbQuestBody(db, q, cov, { map = true, text = true } = {}) {
  const link = (id) => { const x = db.quests.get(id); if (!x) return `quest ${id}`; const st = questState(x, cov.ctx); return `<a href="#/quest/q${id}">${esc(x.n)}</a> ${st === 'other' ? reqChip(x, cov) : st === 'excluded' ? '' : stateChip(st)}`; };
  const who = (list) => list.map((g) => (g.kind === 'npc' ? `<a href="#/npc/n${g.id}">${esc(g.name)}</a>${g.sub ? ` <span class="muted small">&lt;${esc(g.sub)}&gt;</span>` : ''}${g.zone ? ` <span class="muted small">in ${esc(db.zoneName(g.zone))}</span>` : ''}` : g.kind === 'object' ? `${esc(g.name)} <span class="muted small">(object${g.zone ? ` in ${esc(db.zoneName(g.zone))}` : ''})</span>` : `${itemLink(g.id, g.name)} <span class="muted small">(item)</span>`)).join('<br>');
  const gv = givers(db, q);
  const en = enders(db, q);
  const obs = objectives(db, q);
  const before = [...(q.pre || []).map((id) => [id, q.pre.length > 1 ? 'one of' : '']), ...(q.preAll || []).map((id) => [id, ''])];
  const prev = (db.previous.get(q.id) || []).map((x) => x.id);
  const unlocks = (db.unlocks.get(q.id) || []).map((x) => x.id);
  let mapHtml = '';
  if (map) {
    const spawns = await spawnTable();
    const zone = q.zone ? db.zones[q.zone] : null;
    // Only what has been discovered: people met, creatures hunted, objects opened.
    const { world } = derived();
    const met = new Set(); const opened = new Set(); const hunted = new Set();
    for (const n of world.npcs) for (const id of n.ids || (n.npcId ? [n.npcId] : [])) met.add(id);
    for (const n of world.creatures) if (n.kills > 0) for (const id of n.ids || (n.npcId ? [n.npcId] : [])) hunted.add(id);
    for (const n of world.objects) if (n.loots > 0 && n.objectId) opened.add(n.objectId);
    const known = (g) => (g.kind === 'npc' ? met.has(g.id) : g.kind === 'object' ? opened.has(g.id) : false);
    const pins = [];
    for (const g of gv) if (known(g)) for (const [x, y] of (spawns[`${g.kind[0]}${g.id}`]?.[q.zone] || []).slice(0, 6)) pins.push({ x, y, layer: 'unfound', label: `${g.name} gives ${q.n}`, key: `g${g.id}`, href: g.kind === 'npc' ? `#/npc/n${g.id}` : '#' });
    for (const g of en) if (known(g)) for (const [x, y] of (spawns[`${g.kind[0]}${g.id}`]?.[q.zone] || []).slice(0, 6)) pins.push({ x, y, layer: 'person', label: `${g.name} takes ${q.n} back`, key: `e${g.id}`, href: g.kind === 'npc' ? `#/npc/n${g.id}` : '#' });
    for (const o of obs) if (o.kind === 'kill' && (o.ids || [o.id]).some((id) => hunted.has(id))) for (const [x, y] of (spawns[`n${o.id}`]?.[q.zone] || []).slice(0, 24)) pins.push({ x, y, layer: 'creature', label: o.name, key: `k${o.id}`, href: `#/npc/n${o.id}` });
    if (zone?.m && pins.length) {
      setTimeout(() => wireMap('dbQuestMap', zone.m, pins, { routes: false }));
      mapHtml = `<h3>Where</h3><div class="filters" id="mapLayers"><label><input type="checkbox" value="unfound" checked><span class="cat" style="background:${LAYERS.unfound.color}"></span>Quest giver</label><label><input type="checkbox" value="person" checked><span class="cat" style="background:${LAYERS.person.color}"></span>Turn in</label><label><input type="checkbox" value="creature" checked><span class="cat" style="background:${LAYERS.creature.color}"></span>Targets</label></div><div class="map-wrap"><div class="map" id="dbQuestMap"></div><div class="map-info panel" id="mapInfo"><p class="muted">Click a pin.</p></div></div>`;
    }
  }
  return `<div class="grid3">
      ${gv.length ? `<div class="panel"><h3>Given by</h3>${who(gv)}</div>` : ''}
      ${en.length ? `<div class="panel"><h3>Turn in to</h3>${who(en)}</div>` : ''}
      ${q.rr?.length ? `<div class="panel"><h3>Reputation</h3>${q.rr.map(([f, v]) => `${esc(FACTIONS[f] ?? `faction ${f}`)} ${v > 0 ? '+' : ''}${v}`).join('<br>')}</div>` : ''}
    </div>
    ${text && q.o ? `<h3>Objectives</h3>${lore(q.o)}` : ''}
    ${obs.length ? `<ul>${obs.map((o) => `<li>${o.kind === 'kill' ? `Kill <a href="#/npc/n${o.id}">${esc(o.name)}</a>` : o.kind === 'item' ? itemLink(o.id, o.name) : esc(o.name)}${o.text && o.text !== o.name ? ` <span class="muted small">${esc(o.text)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${mapHtml}
    ${before.length || prev.length || q.next || unlocks.length || q.ex?.length || q.bcs?.length ? `<div class="grid3">
      ${before.length || prev.length ? `<div class="panel"><h3>Before this</h3>${[...prev.map((id) => `${link(id)} <span class="muted small">earlier in the chain</span>`), ...before.map(([id, note]) => `${link(id)}${note ? ` <span class="muted small">${note}</span>` : ''}`)].join('<br>')}</div>` : ''}
      ${q.next || unlocks.length ? `<div class="panel"><h3>After this</h3>${[...(q.next ? [`${link(q.next)} <span class="muted small">next in the chain</span>`] : []), ...unlocks.filter((id) => id !== q.next).map((id) => link(id))].join('<br>')}</div>` : ''}
      ${q.ex?.length || q.bcs?.length ? `<div class="panel"><h3>Instead of</h3>${[...(q.ex || []).map((id) => `${link(id)} <span class="muted small">one or the other</span>`), ...(q.bcs || []).map((id) => `${link(id)} <span class="muted small">a breadcrumb to this</span>`)].join('<br>')}</div>` : ''}
    </div>` : ''}`;
}

// A quest you have not logged yet.
async function dbQuestPage(key) {
  const db = await questDB();
  const id = /^q\d+$/.test(key) ? Number(key.slice(1)) : 0;
  const q = db?.quests.get(id);
  if (!q) return '<p>Quest not found.</p>';
  const zone = db.zoneName(q.zone ?? q.z);
  return `${crumb('#/quests', 'Quests')}
    ${pageHead('Quest', esc(q.n), 'Not found yet. The wiki fills in once you have read it.', '')}
    ${facts([zone ? esc(zone) : '', q.l ? `level ${q.l}` : ''])}`;
}

// Under a logged quest: what the database adds (chain, prerequisites, givers).
async function dbQuestPanel(qid) {
  const db = qid ? await questDB() : null;
  const q = db?.quests.get(qid);
  if (!q) return '';
  const cov = coverageWho();
  return `<h2>In the quest database</h2>${dbQuestFacts(db, q, cov)}${await dbQuestBody(db, q, cov, { map: false })}`;
}

function dbNpcQuests(db, n, cov, tag = 'h2') {
  const list = (title, ids) => (ids?.length ? `<${tag}>${title}</${tag}><ul>${ids.map((id) => { const q = db.quests.get(id); return q && !q.hidden ? `<li><a href="#/quest/q${id}">${esc(q.n)}</a> <span class="muted small">level ${q.l}</span> ${stateChip(questState(q, cov.ctx))}</li>` : ''; }).join('')}</ul>` : '');
  return list('Gives', n.qs) + list('Takes back', n.qe);
}

// An NPC you have not met yet.
async function dbNpcPage(key) {
  const db = await questDB();
  const id = /^n\d+$/.test(key) ? Number(key.slice(1)) : 0;
  const n = db?.npc(id);
  if (!n) return '<p>Not found.</p>';
  const zone = db.zones[n.z];
  const rare = n.rank === 2 || n.rank === 4;
  return `${crumb(rare ? '#/bestiary' : '#/people', rare ? 'Bestiary' : 'People')}
    ${pageHead('NPC', esc(n.n), 'Not met yet. The wiki fills in once you have.', '')}
    ${facts([zone ? `<a href="#/locations?zone=${zone.n ? enc(zone.n) : ''}">${esc(zone.n)}</a>` : ''])}`;
}

async function dbNpcSection(npcId) {
  const db = npcId ? await questDB() : null;
  const n = db?.npc(npcId);
  if (!n || (!n.qs && !n.qe)) return '';
  const c = await codex();
  const found = new Set(c.quests.map((q) => q.qid).filter(Boolean));
  const only = (ids) => (ids || []).filter((id) => found.has(id));
  const m = { ...n, qs: only(n.qs), qe: only(n.qe) };
  if (!m.qs.length && !m.qe.length) return '';
  return `<h2>Quests</h2>${dbNpcQuests(db, m, coverageWho(), 'h3')}`;
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
    // Rows only animate the first time the table appears after navigation.
    requestAnimationFrame(() => el.classList.add('settled'));
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
    return `<div id="${id}" class="tbl"><div class="toolbar"><input type="search" placeholder="Search…"><span class="muted small count"></span><span style="margin-left:auto" class="row"><span class="muted small">Sort</span><select class="sorter"></select><button class="ghost dir" title="Reverse order">⇅</button></span></div>
      <div class="cardgrid"></div><p><button class="more" hidden>Show more</button></p></div>`;
  }
  return `<div id="${id}" class="tbl"><div class="toolbar"><input type="search" placeholder="Search…"><span class="muted small count"></span></div>
    <div class="scroll"><table><thead></thead><tbody></tbody></table></div><p><button class="more" hidden>Show more</button></p></div>`;
}

// Status bar ----------------------------------------------------------------

function renderStatus() {
  const m = state.machine;
  if (!m) { statusEl.innerHTML = ''; return; }
  // Footage tools need the recordings, which only the recording computer has.
  for (const a of document.querySelectorAll('#nav a[data-needs]')) a.hidden = !m.config[a.dataset.needs];
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
  setTimeout(startFeedTimer);
  const [manifest, db] = await Promise.all([fetch('addon/manifest.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null), questDB()]);
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
    m.liveEnabled?.() ? ['Live link', m.live.status === 'ok' ? `<span class="dot live"></span> reading the chat log · <a href="#/live">overlay</a>` : m.live.status === 'no-log' ? '<a href="#/live">no chat log yet</a>' : `<a href="#/live">${esc(m.live.status)}</a>`] : null,
    (state.settings.addonErrors || []).length ? ['Addon errors', `<a href="#/setup#errors">${(state.settings.addonErrors || []).reduce((n, e) => n + (e.n || 1), 0)} caught · copy the dump</a>`] : null,
    ['Database', state.schema2 ? '<span class="dot ok"></span> up to date' : '<a href="#/setup">needs update</a>'],
  ].filter(Boolean);
  return `
    ${needsSetup ? `<div class="notice">This computer (<b>${esc(m.name)}</b>) isn't fully set up yet. <a href="#/setup">Open This computer</a> to finish.</div>` : ''}
    ${pageHead('Chronicle', 'Overview', '')}
    ${progressCharts()}
    <div class="cards">
      ${card(t.quests, 'quests completed', '#/quests')}
      ${db ? card(progressSets(c.quests).done.size, `of ${db.countable.toLocaleString()} Classic quests done`, '#/quests?show=db') : ''}
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
        ${liveFeed()}
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
// Four small charts, last five weeks: playtime, gold, level and quests turned in.
function progressCharts() {
  const days = 35;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOf = (sec) => Math.floor((today.getTime() - new Date(sec * 1000).setHours(0, 0, 0, 0)) / 86400000);
  const play = new Array(days).fill(0);
  const quests = new Array(days).fill(0);
  const gold = [];
  const levels = [];
  for (const s of state.sessions) {
    if (s.events.length > 1) {
      const d = dayOf(s.events[0].t);
      if (d >= 0 && d < days) play[days - 1 - d] += s.events.at(-1).t - s.events[0].t;
    }
    if (s.char?.level) levels.push({ t: s.started ?? s.events[0]?.t, v: s.char.level, who: s.char.name });
    if (s.char?.money != null) gold.push({ t: s.started ?? s.events[0]?.t, v: s.char.money });
    for (const e of s.events) {
      if (e.e === 'quest_turnin') { const d = dayOf(e.t); if (d >= 0 && d < days) quests[days - 1 - d]++; }
      else if (e.e === 'level') levels.push({ t: e.t, v: e.level, who: s.char?.name });
      else if (e.e === 'money' && e.total != null) gold.push({ t: e.t, v: e.total });
      else if (e.e === 'bags' && e.money != null) gold.push({ t: e.t, v: e.money });
    }
  }
  if (!play.some(Boolean) && !levels.length) return '';
  const since = today.getTime() / 1000 - (days - 1) * 86400;
  const recent = (list) => list.filter((p) => p.t >= since).sort((a, b) => a.t - b.t);
  const fmtDay = (i) => new Date(today.getTime() - (days - 1 - i) * 86400000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hours = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`);
  return `<div class="charts">
    ${miniBars(play, { title: 'Playtime', total: hours(play.reduce((a, b) => a + b, 0)), color: 'var(--gold)', label: (v, i) => `${fmtDay(i)}: ${hours(v)}` })}
    ${miniLine(recent(gold).map((p) => ({ x: p.t, y: p.v })), { title: 'Gold', total: gold.length ? money(gold.sort((a, b) => a.t - b.t).at(-1).v) : '', color: 'var(--cat-economy)', label: (p) => `${when(p.x)}: ${money(p.y)}`, since, until: today.getTime() / 1000 + 86400 })}
    ${miniLine(recent(levels).map((p) => ({ x: p.t, y: p.v })), { title: 'Level', total: levels.length ? `level ${Math.max(...levels.map((p) => p.v))}` : '', color: 'var(--cat-character)', step: true, label: (p) => `${when(p.x)}: level ${p.y}`, since, until: today.getTime() / 1000 + 86400 })}
    ${miniBars(quests, { title: 'Quests turned in', total: `${quests.reduce((a, b) => a + b, 0)}`, color: 'var(--cat-quest)', label: (v, i) => `${fmtDay(i)}: ${v} quest${v === 1 ? '' : 's'}` })}
  </div>`;
}

function miniBars(values, { title, total, color, label }) {
  const W = 300; const H = 64; const gap = 1.5;
  const bw = (W - gap * (values.length - 1)) / values.length;
  const max = Math.max(1, ...values);
  const bars = values.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * (H - 6)) : 1.5;
    return `<g class="bar" style="--i:${i}"><title>${esc(label(v, i))}</title><rect x="${(i * (bw + gap)).toFixed(1)}" y="${(H - 2 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${v ? color : 'var(--line-2)'}"/><rect x="${(i * (bw + gap)).toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}" fill="transparent"/></g>`;
  }).join('');
  return `<div class="panel chart"><div class="row spread"><h3>${esc(title)}</h3><span class="muted small">${esc(total)}</span></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)} per day">${bars}</svg><div class="row spread muted small"><span>5 weeks ago</span><span>today</span></div></div>`;
}

function miniLine(points, { title, total, color, label, step = false, since, until }) {
  const W = 300; const H = 64;
  if (!points.length) return `<div class="panel chart"><div class="row spread"><h3>${esc(title)}</h3><span class="muted small">${esc(total)}</span></div><p class="muted small" style="margin:18px 0 0">Nothing in the last five weeks.</p></div>`;
  const lo = Math.min(...points.map((p) => p.y)); const hi = Math.max(...points.map((p) => p.y));
  const x = (t) => (((t - since) / (until - since)) * (W - 4) + 2);
  const y = (v) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 10));
  let d = '';
  points.forEach((p, i) => {
    const px = x(p.x).toFixed(1); const py = y(p.y).toFixed(1);
    if (i === 0) d += `M${px} ${py}`;
    else if (step) d += `H${px} V${py}`;
    else d += `L${px} ${py}`;
  });
  d += `H${(W - 2).toFixed(1)}`;
  const dots = points.filter((_, i) => i === points.length - 1 || points.length <= 40).map((p) => `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="2.5" fill="${color}"><title>${esc(label(p))}</title></circle>`).join('');
  return `<div class="panel chart"><div class="row spread"><h3>${esc(title)}</h3><span class="muted small">${esc(total)}</span></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)} over time"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${dots}</svg><div class="row spread muted small"><span>5 weeks ago</span><span>today</span></div></div>`;
}

// What the game is doing right now, from the live link (the same events the
// overlay shows), newest first. Refreshed every few seconds while on screen.
function liveFeed() {
  const row = state.live;
  const snap = row?.state;
  const m = state.machine;
  const events = (snap?.events || []).slice().reverse().slice(0, 25);
  const age = row?.updated_at ? Date.now() + (m.offset ?? 0) - Date.parse(row.updated_at) : null;
  const live = age != null && age < 90000;
  return `<div class="panel feed-live" id="liveFeed"><div class="row spread"><h3><span class="dot ${live ? 'live' : ''}"></span> Live</h3><span class="muted small">${snap ? `${esc(snap.machine ?? 'gaming PC')}${snap.lastEventAt ? ` · last event ${esc(when(snap.lastEventAt / 1000))}` : ''}` : 'not connected'}</span></div>
    <div class="feed">${events.length ? events.map((e) => `<div class="row"><span class="when">${esc(new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span><span>${liveLine(e)}</span></div>`).join('') : `<p class="muted small">${snap ? 'Nothing yet this session. Play, and it shows up here as it happens.' : 'Open Chronicler on the gaming PC with addon 0.4.6 to see the game live.'}</p>`}</div>
  </div>`;
}

function liveLine(e) {
  switch (e.kind) {
    case 'loot': return `${itemLink(e.id, e.name, e.q, { count: e.n })}${e.source ? ` <span class="muted">from ${esc(e.source)}</span>` : ''}`;
    case 'kill': return `Killed <b>${esc(e.name ?? '?')}</b>`;
    case 'death': return `<span style="color:var(--red)">Died${e.killer ? ` to ${esc(e.killer)}` : ''}</span>`;
    case 'level': return `<b>Level ${e.level}</b>`;
    case 'quest': return e.action === 'progress' ? esc(e.text ?? '') : `${{ accept: 'Accepted', turnin: 'Turned in', complete: 'Ready to turn in', abandon: 'Abandoned' }[e.action] ?? e.action} <b>${esc(e.title ?? '')}</b>`;
    case 'zone': return `Entered <b>${esc(e.zone ?? '')}</b>${e.sub ? ` · ${esc(e.sub)}` : ''}`;
    case 'rare': return `<span style="color:var(--purple)">Rare spotted: <b>${esc(e.name ?? '')}</b></span>`;
    case 'money': return `Looted ${money(e.delta || 0)}`;
    case 'xp': return `<span class="muted">+${e.amount ?? 0} XP</span>`;
    case 'skill': return `<span class="muted">${esc(e.text ?? '')}</span>`;
    case 'explore': return `Discovered <b>${esc(e.area ?? '')}</b>`;
    case 'mark': return `Marked: ${esc(e.markKind ?? '')}${e.note ? ` · ${esc(e.note)}` : ''}`;
    case 'screenshot': return `<span class="muted">Screenshot (${esc(e.reason ?? '')})</span>`;
    case 'test': return '<span style="color:var(--cyan)">Test line from the game: the live link works</span>';
    default: return esc(e.kind);
  }
}

function startFeedTimer() {
  clearInterval(state.feedTimer);
  state.feedTimer = setInterval(async () => {
    if (!/^#\/?$/.test(location.hash)) { clearInterval(state.feedTimer); return; }
    const m = state.machine;
    if (!(m.liveEnabled?.() && m.wow.state === 'ok')) { try { const row = await state.store.loadLive(); if (row) state.live = row; } catch { /* offline */ } }
    const el = document.getElementById('liveFeed');
    if (el) el.outerHTML = liveFeed();
  }, 5000);
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

// Stat cards on screen, by label: { 'quests completed': 12, ... }
function statSnapshot(root) {
  const out = new Map();
  for (const el of root.querySelectorAll('.card .num[data-n]')) {
    const label = el.parentElement.querySelector('.lbl')?.textContent;
    if (label) out.set(label, Number(el.dataset.n));
  }
  return out;
}

// After a silent refresh, numbers that changed get a brief gold shine.
function shineChanged(root, before) {
  if (!before) return;
  for (const el of root.querySelectorAll('.card .num[data-n]')) {
    const label = el.parentElement.querySelector('.lbl')?.textContent;
    if (label && before.has(label) && before.get(label) !== Number(el.dataset.n)) {
      el.parentElement.classList.add('shine');
      setTimeout(() => el.parentElement.classList.remove('shine'), 1600);
    }
  }
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

pages.quests = async (_, params) => {
  const c = await codex();
  const db = await questDB();
  const show = params.get('show') || (db ? 'zones' : 'logged');
  const notes = db ? dataNotes() : [];
  if (show === 'zones' && db) return questZonesPage(db, params);
  if (show === 'notes') return `${crumb('#/quests', 'Quests')}${pageHead('World', 'Notes', 'Where what the game showed you differs from the database. The wiki keeps the first-hand version and tags it; the database version is kept here.')}
    ${table(notes, [
      { label: 'Entry', value: (n) => n.name, html: (n) => `<a href="${n.kind === 'quest' ? `#/quest/${enc(n.key)}` : `#/npc/${enc(n.key)}`}">${esc(n.name)}</a> <span class="chip">${n.kind} ${n.field}</span>` },
      { label: 'In game', value: (n) => n.ours, html: (n) => esc(n.ours) },
      { label: 'Database', value: (n) => n.theirs, html: (n) => `<span class="muted">${esc(n.theirs)}</span>` },
    ], { search: (n) => `${n.name} ${n.ours} ${n.theirs}`, empty: 'Nothing differs so far.' })}`;
  return `${db ? crumb('#/quests', 'Quests') : ''}${pageHead('World', 'Logged quests', 'Every quest you have been offered, accepted or turned in, with the text exactly as you read it.')}
    ${table(c.quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}" class="${q.status === 'done' ? '' : 'dim'}">${esc(q.title ?? `Quest ${q.qid}`)}</a>` },
      { label: 'Zone', value: (q) => q.zone },
      { label: 'Giver', value: (q) => q.giver?.name ?? '' },
      { label: 'By', value: (q) => (q.characters || []).map((k) => k.split('-')[0]).join(', ') },
      { label: 'Lvl', value: (q) => q.level ?? 0, html: (q) => q.level ?? '', num: true },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { search: (q) => `${q.title} ${q.zone} ${q.giver?.name} ${q.text}`, sort: 5, empty: 'No quests logged yet.' })}`;
};

// The menu: continents, then class, profession and the special categories,
// each with its progress; the page for a zone or category lists the quests
// you found there.
const QUEST_GROUPS = [['Class', 'class'], ['Profession', 'profession'], ['Epic', 'Epic'], ['Legendary', 'Legendary'], ["Ahn'Qiraj War", "Ahn'Qiraj War"], ['Invasion', 'Invasion']];
async function questZonesPage(db, params) {
  const c = await codex();
  const cov = coverageWho();
  const tree = completionTree(db, cov.ctx);
  const groups = ZONE_GROUPS.map((g) => tree.groups.find((x) => x.name === g)).filter(Boolean);
  for (const g of groups) g.zones.sort((a, b) => (a.minLevel ?? 99) - (b.minLevel ?? 99) || a.name.localeCompare(b.name));
  const sortRow = (st) => ({ zoneId: st.id, name: st.name, done: st.done, total: st.total, counts: st.counts, sort: true });
  for (const [label, kind] of QUEST_GROUPS) {
    const rows = tree.sorts.filter((st) => (kind === 'class' || kind === 'profession' ? st.kind === kind : st.name === kind)).map(sortRow).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) continue;
    groups.push({ name: label, zones: rows, done: rows.reduce((n, r) => n + r.done, 0), total: rows.reduce((n, r) => n + r.total, 0), active: 0, single: rows.length === 1 });
  }
  // "9 classes", "12 professions"; the war chapters are one each and say nothing.
  const groupNoun = (g) => (g.name === 'Class' ? `${g.zones.length} classes` : g.name === 'Profession' ? `${g.zones.length} professions` : g.zones[0]?.sort ? '' : `${g.zones.length} zones`);
  const continent = groups.find((g) => g.name === params.get('continent')) || groups[0];
  const zone = continent?.zones.find((z) => String(z.zoneId) === params.get('zone')) || (continent?.single ? continent.zones[0] : null);
  const logged = (z) => (z.sort ? c.quests.filter((q) => q.qid && db.quests.get(q.qid)?.sort === z.zoneId) : c.quests.filter((q) => q.zone && q.zone.toLowerCase() === z.name.toLowerCase()))
    .sort((a, b) => (a.status === 'done' ? 0 : 1) - (b.status === 'done' ? 0 : 1) || String(a.title).localeCompare(String(b.title)));
  const dbq = (q) => (q.qid ? db.quests.get(q.qid) : null);
  const detail = (cont, z) => {
    if (!z) {
      return `<div class="rpg-title"><div><span class="kicker">${cont.zones[0]?.sort ? 'Category' : 'Continent'}</span><h2>${esc(cont.name)}</h2></div>${rpgRing(cont.done, cont.total)}</div>
        <div class="rpg-stats">
          ${rpgStat('Quests done', cont.done, cont.total)}
          ${rpgStat(cont.zones[0]?.sort ? 'Started' : 'Zones started', cont.zones.filter((x) => x.done).length, cont.zones.length)}
        </div>
        <p class="muted small">Pick one for the quests you have done there and how much is left.</p>`;
    }
    const mine = logged(z);
    return `<div class="rpg-title"><div><span class="kicker">${esc(cont.name)}${z.minLevel ? ` · level ${z.minLevel}${z.maxLevel !== z.minLevel ? `–${z.maxLevel}` : ''}` : ''}</span><h2>${esc(z.name)}</h2></div>${rpgRing(z.done, z.total)}</div>
      <div class="rpg-stats">
        ${rpgStat('Done', z.done, z.total)}
        ${rpgStat('In the log', z.counts?.active ?? 0, null)}
        ${rpgStat('Found so far', mine.length, null)}
      </div>
      ${mine.length ? table(mine, [
        { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}" class="${q.status === 'done' ? '' : 'dim'}">${esc(q.title ?? `Quest ${q.qid}`)}</a>${reqChip(dbq(q), cov)}${firstHandChip('quest', q.key)}` },
        { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
        { label: 'Lvl', value: (q) => q.level ?? dbq(q)?.l ?? 0, html: (q) => q.level ?? dbq(q)?.l ?? '', num: true },
        { label: 'Given by', value: (q) => q.giver?.name ?? '', html: (q) => (q.giver ? `<a href="#/npc/${enc(q.giver.npcId ? `n${q.giver.npcId}` : `s${q.giver.name}`)}">${esc(q.giver.name)}</a>` : '') },
        { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
      ], { sort: 1, limit: 300 }) : '<p class="muted small">No quests found here yet.</p>'}
      ${z.sort ? '' : `<div class="row" style="margin-top:10px"><a class="btn ghost" href="#/locations?continent=${enc(cont.name)}&zone=${z.zoneId}">The place</a></div>`}`;
  };
  const notes = dataNotes();
  return `${pageHead('World', 'Quests', 'Every quest in Classic by continent and zone, and by class, profession and the special chapters of the war, with how much of each you have done. The quests you have not found yet count against you, so 100% means all of it.', `<p class="muted" style="margin:0">For ${whoSelect(cov)}</p>`)}
    ${rpgMenu({
      base: '#/quests', groups, continent, zone,
      ring: (x) => ({ done: x.done, total: x.total, sub: x.zones ? `${x.done.toLocaleString()} / ${x.total.toLocaleString()} quests${x.zones.length > 1 ? ` · ${groupNoun(x)}` : ''}` : undefined }),
      listLabel: (g) => (g.zones[0]?.sort ? (g.zones.length > 1 ? groupNoun(g) : '') : `${g.zones.length} zones · by level`),
      bars: (z) => [{ done: z.done, total: z.total, title: 'Quests done' }],
      dim: (z) => !z.done && !(z.counts?.active),
      detail,
      footer: `<div class="muted small">All of Classic</div><div class="cov"><div class="bar"><div style="width:${pctOf(tree.done, tree.total)}%"></div></div><b>${pctOf(tree.done, tree.total)}%</b></div><div class="muted small">${tree.done.toLocaleString()} of ${tree.total.toLocaleString()} quests.</div><div class="row small" style="margin-top:8px"><a href="#/quests?show=logged">Logged <span class="muted">${c.quests.length}</span></a>${notes.length ? `<a href="#/quests?show=notes">Notes <span class="muted">${notes.length}</span></a>` : ''}</div>`,
    })}`;
}

function sortCoverageFor(db, sortId, ctx) {
  const rows = (db.questsBySort.get(sortId) || []).filter((q) => !q.hidden).map((q) => ({ q, state: questState(q, ctx) }));
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  const countable = rows.filter((r) => !r.q.rep && r.state !== 'other' && r.state !== 'excluded');
  return { rows, counts, total: countable.length, done: countable.filter((r) => r.state === 'done').length };
}

// Every quest in the game, with where the character stands on each.
function dbQuestsPage(db, params, tabs) {
  const cov = coverageWho();
  const filter = params.get('state') || 'all';
  const sortId = Number(params.get('sort')) || 0;
  const rows = [...db.quests.values()].filter((q) => !q.hidden && (!sortId || q.sort === sortId)).map((q) => ({ q, state: questState(q, cov.ctx) }));
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  const shown = filter === 'all' ? rows : rows.filter((r) => r.state === filter);
  setTimeout(() => document.getElementById('stateFilter')?.addEventListener('change', (ev) => { location.hash = `#/quests?show=db&state=${ev.target.value}`; }));
  return `${pageHead('Chronicle', 'Quests', 'Every quest in Classic from the quest database, including the ones you have not found yet, with where you stand on each.')}
    ${tabs}
    <p class="muted">For ${whoSelect(cov)} show <select id="stateFilter" class="inline">${[['all', `everything (${rows.length})`], ...STATE_ORDER.filter((st) => counts[st]).map((st) => [st, `${STATES[st]} (${counts[st]})`])].map(([k, l]) => `<option value="${k}" ${k === filter ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></p>
    ${table(shown, coverageColumns(db, cov.ctx, { zone: true }), { search: (r) => `${r.q.n} ${db.zoneName(r.q.zone)} ${r.q.o ?? ''} ${STATES[r.state]} ${givers(db, r.q).map((g) => g.name).join(' ')}`, sort: 0, limit: 300, empty: 'No quests in this state.' })}`;
}

pages.quest = async (key) => {
  const c = await codex();
  const q = c.quests.find((x) => x.key === key);
  if (!q) return dbQuestPage(key);
  const db = await questDB();
  const dq = q.qid && db ? db.quests.get(q.qid) : null;
  const cov = coverageWho();
  const moments = [
    ...q.offered.map((m) => ['Offered', m]), ...q.accepted.map((m) => ['Accepted', m]),
    ...q.turnedIn.map((m) => ['Turned in', m]), ...q.abandoned.map((m) => ['Abandoned', m]),
  ].sort((a, b) => a[1].t - b[1].t);
  const req = reqChip(dq, cov);
  const zoneName = dq ? db.zoneName(dq.zone ?? dq.z) : q.zone;
  const gv = dq ? givers(db, dq) : [];
  const en = dq ? enders(db, dq) : [];
  const who = (g) => (g.kind === 'npc' ? `<a href="#/npc/n${g.id}">${esc(g.name)}</a>` : esc(g.name));
  return `${crumb('#/quests', 'Quests')}
    ${pageHead('Quest', esc(q.title ?? dq?.n ?? `Quest ${q.qid}`), '', `<div class="row"><span class="chip ${q.status}">${q.status}</span>${req}${firstHandChip('quest', q.key)}${wowhead('quest', q.qid)}</div>`)}
    ${facts([zoneName ? `<a href="#/locations">${esc(zoneName)}</a>` : '', dq?.l ? `level ${dq.l}` : q.level ? `level ${q.level}` : '', gv.length ? `from ${gv.map(who).join(', ')}` : q.giver ? `from <a href="#/npc/${enc(q.giver.npcId ? `n${q.giver.npcId}` : `s${q.giver.name}`)}">${esc(q.giver.name)}</a>` : '', en.length && (en.length !== gv.length || en.some((e, i) => e.id !== gv[i]?.id)) ? `turn in to ${en.map(who).join(', ')}` : '', q.qid ? `ID ${q.qid}` : ''])}
    ${q.text ? `<h3>Description</h3>${lore(q.text)}` : ''}
    ${q.objectives ? `<h3>Objectives</h3>${lore(q.objectives)}` : dq?.o ? `<h3>Objectives</h3>${lore(dq.o)}` : ''}
    ${q.progress ? `<h3>Progress</h3>${lore(q.progress)}` : ''}
    ${q.reward ? `<h3>Completion</h3>${lore(q.reward)}` : ''}
    ${noteFor('quest', q.key).length ? `<details class="panel"><summary>The database says otherwise</summary>${noteFor('quest', q.key).map((n) => `<p class="small"><b>${esc(n.field)}</b>: ${esc(n.theirs)}</p>`).join('')}</details>` : ''}
    ${dq ? await dbQuestBody(db, dq, cov, { map: true, text: false }) : ''}
    <h2>Your history</h2>
    <div class="panel"><table><tbody>${moments.map(([what, m]) => `<tr><td>${esc(what)}</td><td>${play(m)}</td><td class="muted">${esc(when(m.t))}</td><td class="muted">${esc((m.sz || m.z) ?? '')}</td></tr>`).join('')}</tbody></table>
    <p class="muted small" style="margin:8px 0 0">${(q.characters || []).length ? `By ${esc(q.characters.map((k) => k.split('-')[0]).join(', '))}. ` : ''}Your route while this quest was in the log is in the <a href="#/journal">Journal</a>.</p></div>`;
};

// Bestiary: things you can fight -------------------------------------------

// Completion browsing: every list is "what you have done" against "what
// exists in Classic", drilled down category by category.
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const covBar = (a, b) => `<div class="cov small"><div class="bar"><div style="width:${pctOf(a, b)}%"></div></div><b>${pctOf(a, b)}%</b></div>`;
function completionColumns(label, href, extra = []) {
  return [
    { label, value: (r) => r.name, html: (r) => `<a href="${href(r)}">${esc(r.name)}</a>${r.sub ? ` <span class="muted small">${esc(r.sub)}</span>` : ''}` },
    { label: 'Done', value: (r) => pctOf(r.done, r.total), html: (r) => covBar(r.done, r.total), num: true },
    { label: 'Count', value: (r) => r.done, html: (r) => `${r.done.toLocaleString()} / ${r.total.toLocaleString()}`, num: true },
    ...extra,
  ];
}
function completionHero(done, total, lead, sub = '') {
  return `<div class="hero-pct"><div class="big">${pctOf(done, total)}<span>%</span></div><div><div class="lead">${lead}</div><div class="cov"><div class="bar"><div style="width:${pctOf(done, total)}%"></div></div></div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
}

const NPC_FLAGS = { 1: 'talks', 2: 'quest giver', 4: 'vendor', 8: 'flight master', 16: 'trainer', 32: 'spirit healer', 128: 'innkeeper', 256: 'banker', 4096: 'auctioneer', 8192: 'stable master', 16384: 'repair' };
const flagChips = (fl) => Object.entries(NPC_FLAGS).filter(([bit]) => fl & bit).map(([, name]) => `<span class="chip">${name}</span>`).join(' ');

const CREATURE_TYPES = ['Beast', 'Humanoid', 'Undead', 'Demon', 'Elemental', 'Dragonkin', 'Giant', 'Mechanical', 'Aberration', 'Critter', 'Totem', 'Not specified'];
const CREATURE_BLURB = {
  Beast: 'Wolves, boars, spiders, raptors: the wild things of every zone, and what hunters tame.',
  Humanoid: 'Kobolds, gnolls, defias, trolls, ogres: they talk, they carry coin, and they drop cloth.',
  Undead: 'Zombies, skeletons and ghouls raised by the Scourge and the Cult of the Damned.',
  Demon: "Imps, felguards and the Burning Legion's servants, called through portals and warlocks.",
  Elemental: 'Earth, fire, water and air given form, bound or wild.',
  Critter: 'Rabbits, squirrels, deer and frogs: the harmless life you can still, regrettably, kill.',
};

pages.bestiary = async (_, params) => {
  const { world } = derived();
  const db = await questDB();
  const type = params.get('type') || 'all';
  const show = params.get('show') || 'all';
  const zone = params.get('zone') || '';
  const kindOf = (n) => n.ctype || 'Not specified';
  const filters = {
    all: () => true, hunted: (n) => n.kills > 0, unhunted: (n) => n.kills === 0,
    rare: (n) => n.rare || n.ranks.some((r) => r.includes('rare') || r === 'worldboss'), elite: (n) => n.ranks.includes('elite') || n.ranks.includes('rareelite'),
    killers: (n) => n.killedYou > 0,
  };
  const order = (t) => (CREATURE_TYPES.indexOf(t) + 1 || 99);
  const types = [...new Set(world.creatures.map(kindOf))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const ofType = (t) => (t === 'all' ? world.creatures : world.creatures.filter((n) => kindOf(n) === t));
  const hunted = (arr) => arr.filter((n) => n.kills > 0).length;
  let list = ofType(type).filter(filters[show] ?? filters.all);
  if (zone) list = list.filter((n) => n.zones.includes(zone));
  const zones = [...new Set(world.creatures.flatMap((n) => n.zones))].sort();
  const link = (t = type, sh = show, z = zone) => `#/bestiary?type=${enc(t)}&show=${sh}${z ? `&zone=${enc(z)}` : ''}`;
  const total = db ? npcTotals(db).creatures : 0;
  setTimeout(() => {
    document.getElementById('zoneSel')?.addEventListener('change', (ev) => { location.hash = link(type, show, ev.target.value); });
    document.getElementById('showSel')?.addEventListener('change', (ev) => { location.hash = link(type, ev.target.value, zone); });
  });
  return `${pageHead('World', 'Bestiary', 'Every creature you have met, by kind. A name stays grey until you have hunted one. Drop rates come from your own loot windows.')}
    <p class="muted small">${hunted(world.creatures).toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} monsters hunted · ${world.creatures.length.toLocaleString()} met · ${hunted(world.creatures.filter(filters.rare))} rares hunted.</p>
    ${tabsHtml([['all', 'All kinds', `${hunted(world.creatures)}/${world.creatures.length}`], ...types.map((t) => [t, t, `${hunted(ofType(t))}/${ofType(t).length}`])], type, '#/bestiary?type=')}
    <div class="row spread" style="margin-bottom:10px">
      <span class="muted small">${CREATURE_BLURB[type] ? esc(CREATURE_BLURB[type]) : ''}</span>
      <span class="row">
        <select id="showSel">${[['all', 'Everything'], ['hunted', 'Hunted'], ['unhunted', 'Not yet hunted'], ['rare', 'Rares'], ['elite', 'Elites'], ['killers', 'Killed you']].map(([k, l]) => `<option value="${k}" ${k === show ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="zoneSel"><option value="">All zones</option>${zones.map((z) => `<option ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
      </span>
    </div>
    ${table(list, [
      { label: 'Creature', value: (n) => (n.kills > 0 ? 1 : 0), html: (n) => `${wikiName(`#/npc/${enc(n.key)}`, n.name, n.kills > 0)}${n.rare ? ' <span class="chip active">rare</span>' : ''}${n.killedYou ? ` <span class="chip bad" title="Killed you ${n.killedYou} time${n.killedYou === 1 ? '' : 's'}">killed you</span>` : ''}` },
      { label: 'Level', value: (n) => n.minLevel ?? 0, html: (n) => `${levelText(n)} ${rankChips(n.ranks.filter((r) => r !== 'rare' || !n.rare))}` },
      { label: 'Kind', value: (n) => [n.ctype, n.family].filter(Boolean).join(' · ') },
      { label: 'Hunted', value: (n) => n.kills, num: true },
      { label: 'Drops', value: (n) => n.drops.length, html: (n) => n.drops.slice(0, 3).map((d) => itemLink(d.id, d.name)).join(' ') + (n.drops.length > 3 ? ` <span class="muted">+${n.drops.length - 3}</span>` : ''), num: true },
      { label: 'Zones', value: (n) => n.zones.join(', ') },
      { label: 'First met', value: (n) => n.first?.t ?? 0, html: (n) => (n.first ? play(n.first) : '') },
    ], { search: (n) => `${n.name} ${n.ctype} ${n.family} ${n.zones.join(' ')} ${n.ranks.join(' ')} ${n.drops.map((d) => d.name).join(' ')}`, sort: 0, desc: true, empty: 'No creatures of this kind yet. They appear as you fight, target and loot.' })}`;
};

// People: everyone you deal with rather than fight ----------------------------

pages.vendors = (_, params) => pages.people(_, new URLSearchParams('show=vendor'));

// Met, or simply ambient? Someone you can deal with (a quest, a shop,
// training, a flight, a talk) stays grey until you have; someone with
// nothing to say and nothing to sell (the database gives them no flags
// and no quests, or the log only ever heard them speak) is met on sight.
function peopleStatus(n) {
  if (n.met) return 'met';
  const db = state.db;
  const ids = n.ids || (n.npcId ? [n.npcId] : []);
  const entries = db ? ids.map((id) => db.npc(id)).filter(Boolean) : [];
  const interactable = entries.length ? entries.some((e) => (e.fl || 0) & (1 | 2 | 4 | 8 | 16 | 128 | 256 | 4096 | 8192 | 16384) || e.qs?.length || e.qe?.length) : !n.roles.every((r) => r === 'other' || r === 'talker');
  return interactable ? 'seen' : 'ambient';
}

pages.people = async (_, params) => {
  const { world } = derived();
  const db = await questDB();
  const role = params.get('role') || 'all';
  const zone = params.get('zone') || '';
  const status = params.get('status') || 'all';
  const zones = [...new Set(world.people.flatMap((n) => n.zones))].sort();
  const met = (arr) => arr.filter((n) => peopleStatus(n) !== 'seen').length;
  const ROLES = [['quest', 'Quest givers'], ['vendor', 'Vendors'], ['trainer', 'Trainers'], ['taxi', 'Flight masters'], ['innkeeper', 'Innkeepers'], ['banker', 'Bankers'], ['talker', 'Speak'], ['other', 'Townsfolk']];
  const ofRole = (r) => (r === 'all' ? world.people : world.people.filter((n) => n.roles.includes(r)));
  let list = ofRole(role);
  if (zone) list = list.filter((n) => n.zones.includes(zone));
  if (status === 'met') list = list.filter((n) => peopleStatus(n) === 'met');
  else if (status === 'notyet') list = list.filter((n) => peopleStatus(n) === 'seen');
  const total = db ? npcTotals(db).people : 0;
  const link = (r = role, z = zone, st = status) => `#/people?role=${enc(r)}${z ? `&zone=${enc(z)}` : ''}${st !== 'all' ? `&status=${st}` : ''}`;
  setTimeout(() => {
    document.getElementById('zoneSel')?.addEventListener('change', (ev) => { location.hash = link(role, ev.target.value, status); });
    document.getElementById('statusSel')?.addEventListener('change', (ev) => { location.hash = link(role, zone, ev.target.value); });
  });
  return `${pageHead('World', 'People', 'Everyone you have come across, by what they do for you. A name stays grey until you take a quest, buy, train, fly or talk with them.')}
    <p class="muted small">${met(world.people).toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} people met · ${world.people.length.toLocaleString()} come across.</p>
    ${tabsHtml([['all', 'Everyone', `${met(world.people)}/${world.people.length}`], ...ROLES.filter(([k]) => ofRole(k).length).map(([k, l]) => [k, l, `${met(ofRole(k))}/${ofRole(k).length}`])], role, '#/people?role=')}
    <div class="row spread" style="margin-bottom:10px"><span></span><span class="row">
      <select id="statusSel">${[['all', 'Everyone'], ['met', 'Met'], ['notyet', 'Not yet met']].map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="zoneSel"><option value="">All zones</option>${zones.map((z) => `<option ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
    </span></div>
    ${table(list, [
      { label: 'Name', value: (n) => (peopleStatus(n) !== 'seen' ? 1 : 0), html: (n) => `${wikiName(`#/npc/${enc(n.key)}`, n.name, peopleStatus(n) !== 'seen')}${n.titles[0] ? ` <span class="muted small">&lt;${esc(n.titles.join('> <'))}&gt;</span>` : ''}` },
      { label: 'Does', value: (n) => n.roles.join(' '), html: (n) => n.roles.filter((r) => r !== 'other').map((r) => `<span class="chip">${esc(ROLE_NAMES[r] ?? r)}</span>`).join(' ') },
      { label: 'Zones', value: (n) => n.zones.join(', ') },
      { label: 'Quests', value: (n) => n.quests.size, num: true },
      { label: 'First met', value: (n) => n.first?.t ?? 0, html: (n) => (n.first ? play(n.first) : '') },
    ], { search: (n) => `${n.name} ${n.titles.join(' ')} ${n.zones.join(' ')} ${n.roles.join(' ')}`, sort: 0, desc: true, empty: 'Nobody yet. People appear as you talk, trade, train and travel.' })}`;
};

pages.npc = async (key) => {
  const { world, codex } = derived();
  const n = world.byNpc.get(key);
  if (!n) return dbNpcPage(key);
  const quests = [...n.quests].map((qk) => codex.quests.find((q) => q.key === qk)).filter(Boolean);
  const kicker = n.object ? 'Object' : n.attackable ? 'Creature' : n.roles.filter((r) => r !== 'other' && r !== 'talker').map((r) => ROLE_NAMES[r]).join(' · ') || 'Person';
  const back = n.object ? ['#/items?show=objects', 'Herbs, ore & chests'] : n.attackable ? ['#/bestiary', 'Bestiary'] : ['#/people', 'People'];
  const ambient = !n.object && !n.attackable && peopleStatus(n) === 'ambient';
  const firstHand = firstHandChip('npc', n.key);
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  const byMap = new Map();
  for (const sp of n.spots) { if (!byMap.has(sp.m)) byMap.set(sp.m, []); byMap.get(sp.m).push(sp); }
  const mapId = [...byMap.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const onMap = n.spots.filter((sp) => sp.m === mapId);
  if (mapId) setTimeout(() => wireMap('npcMap', mapId, onMap.map((sp) => ({ ...sp, layer: n.object ? 'object' : n.attackable ? 'creature' : 'person', label: n.name, sub2: sp.kind, key: n.key })), { routes: false, heat: n.attackable ? { density: heatCells(onMap, 3) } : {} }));
  return `${crumb(back[0], back[1])}
    ${pageHead(kicker, `${esc(n.name)}${n.titles[0] ? ` <span class="muted" style="font-size:.55em;font-family:var(--sans);font-weight:400">&lt;${esc(n.titles.join('> <'))}&gt;</span>` : ''}`, '', `<div class="row">${firstHand}${wowhead(n.object ? 'object' : 'npc', n.npcId)}</div>`)}
    ${facts([levelText(n) && `Level ${levelText(n)}`, rankChips(n.ranks), [n.ctype, n.family].filter(Boolean).join(' · '), n.react ? REACTION[n.react] : '', esc(n.faction ?? ''), n.hp ? `${n.hp.toLocaleString()} health` : '', esc(n.zones.join(', ')), n.npcId ? `ID ${n.npcId}` : '', n.objectId ? `object ${n.objectId}` : '', n.unnamed ? '<span class="muted">name not caught: addon 0.4.0 names what you open, so open it once more</span>' : ''])}
    <div class="cards">
      ${card(n.sightings, 'encounters', '#/bestiary')}${n.attackable || n.kills ? card(n.kills, 'killed', '#/bestiary?show=killed') : ''}${n.loots ? card(n.loots, 'looted', '#/items') : ''}${n.killedYou ? card(n.killedYou, 'times it killed you', '#/highlights?kind=death') : ''}${n.quests.size ? card(n.quests.size, 'quests', '#/quests') : ''}
    </div>
    <div class="row">${n.first ? `First met ${play(n.first)}` : ''} ${n.firstKill ? `First kill ${play(n.firstKill)}` : ''}</div>
    ${ambient ? '<p class="muted small">Ambient: this one has nothing to say and nothing to sell, so coming across them counts as meeting them.</p>' : ''}
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
    ${await dbNpcSection(n.npcId)}
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

// Every item in Classic, for the completion journal: id -> [name, class, subclass, item level, required level].
async function itemTable() {
  if (state.itemdb !== undefined) return state.itemdb;
  try {
    const data = (await fetchData('data/classic/itemdb.json')).items;
    state.itemdb = new Map(Object.entries(data).map(([id, v]) => [Number(id), v]));
  } catch { state.itemdb = null; }
  return state.itemdb;
}

// Projectiles, quest items and the odds and ends are one kind here.
const MISC_KINDS = ['Miscellaneous', 'Projectile', 'Quest'];
const MISC_SUBS = { Projectiles: 'Projectile', 'Quest items': 'Quest' };
function itemKind({ type, sub }) {
  if (type === 'Projectile') return { type: 'Miscellaneous', sub: 'Projectiles' };
  if (type === 'Quest') return { type: 'Miscellaneous', sub: 'Quest items' };
  return { type: type || 'Other', sub: sub || 'General' };
}
const ITEM_ICONS = { Weapon: '⚔', Armor: '⛨', Consumable: '⚗', Projectile: '➶', Quest: '❖', Miscellaneous: '✦', 'Trade Goods': '⚒', Recipe: '✎', Container: '▣', Reagent: '❀', Quiver: '⌇', Key: '⚿', Gem: '◆', Money: '◎', Unknown: '?' };

pages.items = async (_, params) => {
  const { world } = derived();
  const show = params.get('show') || 'all';
  const db = await questDB();
  if (show === 'objects' || show === 'gathering') {
    const total = db ? Object.keys(db.objects || {}).length : 0;
    return `${pageHead('World', 'Gathering', 'Everything you gathered or opened, and what came out of it: herbs, ore, chests, and anything else you can pick from (a cactus, a crate).', '<div class="row"><a class="btn ghost" href="#/items">Items</a></div>')}
      <p class="muted small">${world.objects.filter((n) => n.loots > 0).length}${total ? ` of ${total.toLocaleString()}` : ''} objects opened.</p>
      ${table(world.objects, [
        { label: 'Object', value: (n) => n.name, html: (n) => `${wikiName(`#/npc/${enc(n.key)}`, n.name, n.loots > 0)}${n.unnamed && n.drops.length ? ` <span class="muted small">gives ${esc(n.drops[0].name)}</span>` : ''}` },
        { label: 'Gave', value: (n) => n.drops.length, html: (n) => n.drops.slice(0, 4).map((d) => itemLink(d.id, d.name)).join(' ') + (n.drops.length > 4 ? ` <span class="muted">+${n.drops.length - 4}</span>` : ''), num: true },
        { label: 'Zones', value: (n) => n.zones.join(', ') },
        { label: 'First', value: (n) => n.first?.t ?? n.spots[0]?.t ?? 0, html: (n) => (n.first ? play(n.first) : n.spots[0] ? play(n.spots[0]) : '') },
      ], { sort: 1, desc: true, empty: 'Nothing gathered yet. Herbs, ore, chests and the like appear here after you open them.' })}`;
  }
  const itemdb = await itemTable();
  // Every item in Classic by kind and type (the totals), indexed once.
  if (itemdb && !state.itemIndex) {
    const classes = new Map();
    for (const [id, v] of itemdb) {
      const { type, sub } = itemClassName(v[1], v[2]);
      const c = classes.get(type) || { name: type, subs: new Map(), ids: [] };
      c.ids.push(id);
      const sName = sub || 'General';
      const sc = c.subs.get(sName) || { name: sName, ids: [] };
      sc.ids.push(id);
      c.subs.set(sName, sc);
      classes.set(type, c);
    }
    state.itemIndex = classes;
  }
  // The items you have come across, sorted into the same kinds and types.
  const kindOf = (it) => { const v = itemdb?.get(it.id); if (v) return itemKind(itemClassName(v[1], v[2])); return itemKind({ type: it.info?.type || 'Other', sub: it.info?.sub || 'General' }); };
  const mine = new Map();
  for (const it of world.items) {
    const { type, sub } = kindOf(it);
    const k = mine.get(type) || { name: type, subs: new Map(), items: [] };
    k.items.push(it);
    const t = k.subs.get(sub) || { name: sub, items: [] };
    t.items.push(it);
    k.subs.set(sub, t);
    mine.set(type, k);
  }
  // Totals in Classic for a kind or a type, with the merged Miscellaneous kind
  // summed from the classes the game keeps apart.
  const totalOf = (type, sub) => {
    const idx = state.itemIndex;
    if (!idx) return 0;
    if (type !== 'Miscellaneous') return (sub ? idx.get(type)?.subs.get(sub)?.ids.length : idx.get(type)?.ids.length) ?? 0;
    if (!sub) return MISC_KINDS.reduce((n, t) => n + (idx.get(t)?.ids.length ?? 0), 0);
    const back = MISC_SUBS[sub];
    return (back ? idx.get(back)?.ids.length : idx.get('Miscellaneous')?.subs.get(sub)?.ids.length) ?? 0;
  };
  const obtained = (arr) => arr.filter((i) => i.obtained).length;
  const order = (t) => (ITEM_CLASS_ORDER.indexOf(t) + 1 || 90);
  const cls = params.get('cls') || '';
  const sub = params.get('sub') || '';
  const link = (c, sb) => `#/items${c ? `?cls=${enc(c)}` : ''}${sb ? `&sub=${enc(sb)}` : ''}`;
  const itemCell = (r) => `<span class="item ${r.obtained ? '' : 'dim-item'}">${itemLink(r.id, r.name, r.quality)}</span>`;
  const sources = (r) => [...r.droppedBy.slice(0, 2).map((d) => esc(d.name)), ...r.soldBy.slice(0, 1).map((v) => `${esc(v.name)} (vendor)`), ...r.rewardFrom.slice(0, 1).map((q) => `${esc(q.title ?? q.name ?? 'quest')} (quest)`)].join(', ');
  if (cls) {
    const k = mine.get(cls);
    if (!k) return `${crumb('#/items', 'All items')}<p>Nothing of this kind yet.</p>`;
    const subs = [...k.subs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const chosen = sub && k.subs.get(sub) ? k.subs.get(sub) : null;
    const rows = chosen ? chosen.items : k.items;
    const total = chosen ? totalOf(cls, chosen.name) : totalOf(cls);
    const tabs = tabsHtml([['', `All ${cls.toLowerCase()}`, `${obtained(k.items)}/${k.items.length}`], ...subs.map((t) => [t.name, t.name, `${obtained(t.items)}/${t.items.length}`])], chosen ? chosen.name : '', `#/items?cls=${enc(cls)}&sub=`);
    return `${crumb('#/items', 'All items')}
      ${pageHead('World', `<span class="kind-ico">${ITEM_ICONS[cls] ?? '✦'}</span> ${esc(chosen ? chosen.name : cls)}`, `${esc(cls)}${chosen ? ` › ${esc(chosen.name)}` : ''}: ${obtained(rows).toLocaleString()} obtained${total ? ` of ${total.toLocaleString()} in Classic` : ''}, ${rows.length.toLocaleString()} come across. A name stays grey until one is yours.`)}
      ${total ? covBar(obtained(rows), total) : ''}
      ${tabs}
      ${table(rows, [
        { label: 'Item', value: (r) => (r.obtained ? 1 : 0), html: itemCell },
        ...(chosen ? [] : [{ label: 'Type', value: (r) => kindOf(r).sub, html: (r) => `<a href="${link(cls, kindOf(r).sub)}">${esc(kindOf(r).sub)}</a>` }]),
        { label: 'Quality', value: (r) => r.quality ?? -1, html: (r) => esc(qualityName(r.quality) ?? ''), num: true },
        { label: 'iLvl', value: (r) => r.info?.ilvl || 0, html: (r) => r.info?.ilvl || '', num: true },
        { label: 'Req', value: (r) => r.info?.req || 0, html: (r) => r.info?.req || '', num: true },
        { label: 'Sources', value: (r) => r.droppedBy.length + r.soldBy.length + r.rewardFrom.length, html: sources, num: true },
      ], { search: (r) => `${r.name} ${kindOf(r).sub} ${(r.info?.tip || []).join(' ')}`, sort: 0, desc: true, limit: 400, empty: 'Nothing of this kind yet.' })}`;
  }
  const kinds = [...mine.values()].map((k) => ({ name: k.name, done: obtained(k.items), total: totalOf(k.name) || k.items.length, seen: k.items.length, types: k.subs.size })).sort((a, b) => order(a.name) - order(b.name));
  const recent = world.items.filter((i) => i.moments.length).map((i) => ({ i, t: Math.min(...i.moments.map((m) => m.t)) })).sort((a, b) => b.t - a.t).slice(0, 12);
  const allObtained = obtained(world.items);
  return `${pageHead('World', 'Items', 'Every item you have come across, by kind, against everything in Classic. Obtained means it was yours at some point: looted, bought, handed over, made, worn or carried. A name stays grey until then.', `<div class="row"><a class="btn ghost" href="#/items?show=gathering">Gathering <span class="muted">${world.objects.length}</span></a></div>`)}
    ${state.schema2 ? '' : schemaNotice()}
    <p class="muted small">${allObtained.toLocaleString()}${itemdb ? ` of ${itemdb.size.toLocaleString()}` : ''} items obtained · ${world.items.length.toLocaleString()} come across.</p>
    <div class="kinds">${kinds.map((k, i) => `<a class="kind" href="${link(k.name)}" style="--i:${i}"><span class="pring" style="--p:${pctOf(k.done, k.total)};--s:56px"><span>${pctOf(k.done, k.total)}<i>%</i></span></span><span class="kind-ico">${ITEM_ICONS[k.name] ?? '✦'}</span><b>${esc(k.name)}</b><small>${k.done.toLocaleString()} of ${k.total.toLocaleString()}</small><small class="muted">${k.seen} come across · ${k.types} type${k.types === 1 ? '' : 's'}</small></a>`).join('')}</div>
    ${kinds.length ? '' : '<p class="muted">No items yet. They appear as you loot, buy, receive and wear them.</p>'}
    ${recent.length ? `<h2>New in the compendium</h2><p class="muted small">The latest items to enter the wiki, whoever found them.</p><div class="recent">${recent.map(({ i, t }) => `<div class="recent-item ${i.obtained ? '' : 'dim-item'}">${itemLink(i.id, i.name, i.quality, { size: 'medium' })}<small class="muted">${esc(kindOf(i).type)} · ${esc(when(t))}</small></div>`).join('')}</div>` : ''}`;
};

// An item you have not come across yet, from the item database.
async function dbItemPage(id) {
  const itemdb = await itemTable();
  const v = itemdb?.get(Number(id));
  if (!v) return '<p>Item not found.</p>';
  const { type, sub } = itemKind(itemClassName(v[1], v[2]));
  return `${crumb(`#/items?cls=${enc(type)}&sub=${enc(sub)}`, `${type} › ${sub}`)}
    ${pageHead('Item', esc(v[0]), 'You have not come across this one yet. From the item database:', `<div class="row"><span class="chip">not yet</span>${wowhead('item', Number(id))}</div>`)}
    ${facts([esc(type), sub ? esc(sub) : '', v[3] ? `item level ${v[3]}` : '', v[4] ? `requires level ${v[4]}` : '', `ID ${Number(id)}`])}`;
}

pages.item = async (id) => {
  const { world, codex } = derived();
  const it = world.byItem.get(Number(id));
  if (!it) return dbItemPage(id);
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
    <div class="cards">${card(it.looted, 'looted', '#/items')}${it.bought ? card(it.bought, 'bought', '#/items') : ''}${it.created ? card(it.created, 'crafted', '#/items') : ''}${it.received ? card(it.received, 'received', '#/items') : ''}</div>
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
  return `${pageHead('Chronicle', 'Characters', '')}
    <div class="cards">${characters.map(charCard).join('') || '<p class="muted">No characters yet.</p>'}</div>`;
};

pages.character = async (key, params = new URLSearchParams()) => {
  const tab = params.get('tab') || 'dashboard';
  const c = derived().characters.find((x) => x.key === key);
  if (!c) return '<p>Character not found.</p>';
  setTimeout(() => document.getElementById('delChar')?.addEventListener('click', async () => {
    if ((document.getElementById('delCharName')?.value ?? '').trim().toLowerCase() !== c.name.toLowerCase()) { toast(`Type ${c.name} to confirm.`); return; }
    if (!window.confirm(`Delete ${c.name} and ${c.sessions.length} session${c.sessions.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try { await deleteCharacter(c); toast(`${c.name} deleted.`); location.hash = '#/characters'; } catch (err) { toast(err.message); }
  }));
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
        <p class="kicker">${i.sex ? `${i.sex === 'male' ? 'Male' : 'Female'} ` : ''}${esc(i.race ?? '')} ${esc(i.class ?? '')}${i.faction ? ` · ${esc(i.faction)}` : ''}</p>
        <h1>${esc(c.name)} <span class="muted" style="font-size:.5em;font-family:var(--sans);font-weight:400">${esc(c.realm ?? '')}</span></h1>
        ${facts([i.guild ? `&lt;${esc(i.guild)}&gt;` : '', i.bind ? `Hearth: ${esc(i.bind)}` : '', moneyNow != null ? money(moneyNow) : '', i.xpMax ? `${Math.round(xpPct * 100)}% into level ${c.level}` : ''])}
      </div>
    </header>
    ${tabsHtml([['dashboard', 'Dashboard'], ['progress', 'Progress'], ['places', 'Places'], ['journal', 'Journal']], tab, `#/character/${enc(c.key)}?tab=`)}
    ${tab === 'dashboard' ? await characterDashboard(c) : tab === 'journal' ? await characterJournal(c) : tab === 'places' ? characterPlaces(c) : `<div class="cards">
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
    ], { sort: 0, desc: true, empty: 'No footage of this character yet.' })}
    <div class="panel danger"><h3>Delete ${esc(c.name)}</h3>
      <p class="small">Removes this character's ${c.sessions.length} session${c.sessions.length === 1 ? '' : 's'} and their routes from the chronicle, on every computer. Recordings and screenshots stay. The addon's own log on the gaming PC is not changed, and these sessions will not be uploaded again. Type the character's name to confirm.</p>
      <div class="row"><input type="text" id="delCharName" placeholder="${esc(c.name)}" autocomplete="off"><button id="delChar" class="danger">Delete character</button></div>
    </div>`}`;
};

// The Journal: short entries in the character's own story, one per outing,
// plus one when a storyline or a zone is finished.
async function characterJournal(c) {
  const d = derived();
  const db = await questDB();
  const sessions = d.sessions.filter((sess) => c.sessions.includes(sess.id));
  let out;
  try { out = journalEntries({ character: c, sessions, world: d.world, codex: d.codex, db, moment: d.moment }); } catch (err) { console.warn('journal', err); out = { entries: [] }; }
  setTimeout(() => document.getElementById('journalDl')?.addEventListener('click', () => download(`${c.name.toLowerCase()}-journal.md`, 'text/markdown', narrativeText(out))));
  if (!out.entries.length) return '<p class="muted">Nothing written yet. The journal fills in as the story unfolds.</p>';
  return `<div class="journal">
    ${out.entries.slice().reverse().map((e, i) => `<article class="entry entry-${e.kind}" style="--i:${Math.min(i, 12)}">
      <div class="row spread"><h3>${esc(e.title)}</h3><span class="muted small">${esc(when(e.t))}${e.footage ? ` ${play(e)}` : ''}</span></div>
      ${(e.paragraphs || [e.text]).map((p) => `<p>${esc(p)}</p>`).join('')}
    </article>`).join('')}
    <p><button class="ghost small" id="journalDl">Journal as Markdown</button></p>
  </div>`;
}

// The dashboard: where the character stands right now.
async function characterDashboard(c) {
  const d = derived();
  const db = await questDB();
  const i = c.info;
  const who = { raceToken: i.raceToken, classToken: i.classToken, faction: i.faction };
  const { done, active } = progressSets(d.codex.quests, c.key);
  const ctx = { who, level: c.level || 0, done, active };
  const tree = db ? completionTree(db, ctx) : null;
  const lines = db ? storylines(db, ctx).filter((st) => st.done && st.done < st.total).sort((a, b) => pctOf(b.done, b.total) - pctOf(a.done, a.total)).slice(0, 5) : [];
  const finished = db ? storylines(db, ctx).filter((st) => st.total && st.done === st.total).length : 0;
  const mySessions = d.sessions.filter((sess) => c.sessions.includes(sess.id));
  let lastZone = null; let lastSub = null; let lastT = 0;
  for (const sess of mySessions) for (const e of sess.events) if (e.z && e.t >= lastT) { lastZone = e.z; lastSub = e.sz ?? null; lastT = e.t; }
  const activeQuests = d.codex.quests.filter((q) => q.status === 'active' && (q.characters || []).includes(c.key)).slice(0, 8);
  const zoneRow = tree && lastZone ? tree.groups.flatMap((g) => g.zones).find((z) => z.name.toLowerCase() === lastZone.toLowerCase()) : null;
  const moneyNow = c.money.at(-1)?.total ?? i.money;
  const recent = journeyRows(c).sort((a, b) => b.t - a.t).slice(0, 6);
  return `<div class="dash">
    <div class="dash-grid">
      <div class="panel"><h3>Right now</h3>
        ${facts([lastZone ? `In <b>${esc(lastZone)}</b>${lastSub ? `, ${esc(lastSub)}` : ''}` : '', lastT ? `last seen ${esc(when(lastT))}` : '', moneyNow != null ? money(moneyNow) : '', i.bind ? `hearth at ${esc(i.bind)}` : ''])}
        ${zoneRow ? `<div class="muted small" style="margin-top:6px">${esc(zoneRow.name)}: ${zoneRow.done} of ${zoneRow.total} quests done</div>${covBar(zoneRow.done, zoneRow.total)}` : ''}
      </div>
      <div class="panel"><h3>Standing</h3>
        <div class="cards tight">${card(c.questsDone, 'quests done', `#/quests`)}${card(finished, 'storylines finished', '#/storylines')}${card(c.kills, 'hunts', '#/bestiary')}${card(c.deaths.length, 'deaths', '#/highlights?kind=death')}${card(c.zones.length, 'zones', `#/character/${enc(c.key)}?tab=places`)}${card(Math.round(c.playSeconds / 3600), 'hours', '#/sessions')}</div>
        ${tree ? `<div class="muted small">All of Classic: ${tree.done.toLocaleString()} of ${tree.total.toLocaleString()} quests</div>${covBar(tree.done, tree.total)}` : ''}
      </div>
      <div class="panel"><h3>In the log <span class="muted">${activeQuests.length}</span></h3>
        ${activeQuests.length ? `<p class="wiki-names">${activeQuests.map((q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title ?? `Quest ${q.qid}`)}</a>${q.zone ? ` <span class="muted small">${esc(q.zone)}</span>` : ''}`).join(' · ')}</p>` : '<p class="muted small">Nothing in the log.</p>'}
      </div>
      <div class="panel"><h3>Threads in hand</h3>
        ${lines.length ? lines.map((st) => `<div class="row spread small"><a href="#/storyline/${st.id}">${esc(st.name)}</a><span class="muted">${st.done} / ${st.total}</span></div>${covBar(st.done, st.total)}`).join('') : '<p class="muted small">No storyline in progress.</p>'}
      </div>
    </div>
    <h2>Lately</h2>
    ${table(recent, [
      { label: 'When', value: (r) => r.t, html: (r) => `<span class="muted">${esc(when(r.t))}</span>` },
      { label: 'Milestone', value: (r) => r.label, html: (r) => r.html },
      { label: 'Footage', value: (r) => r.footage?.offset ?? -1, html: (r) => play(r) },
    ], { sort: 0, desc: true, empty: 'Nothing yet.' })}
  </div>`;
}

// Places: where this character has been, with the maps explored and loose ends.
function characterPlaces(c) {
  const d = derived();
  const codexZones = new Map(d.codex.zones.map((z) => [z.name, z]));
  return `${table(c.zones, [
      { label: 'Zone', value: (z) => z.name, html: (z) => `<a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` },
      { label: 'First visit', value: (z) => z.t, html: (z) => play(z) },
      { label: 'Areas', value: (z) => codexZones.get(z.name)?.discovered?.length ?? 0, num: true },
      { label: 'Loose ends', value: (z) => looseEnds(z.name, d.codex, d.world).total, html: (z) => { const n = looseEnds(z.name, d.codex, d.world).total; return n ? `<a class="chip active" href="#/zone/${enc(z.name)}#loose">${n}</a>` : '<span class="chip done">clear</span>'; }, num: true },
    ], { sort: 1, empty: 'No zones yet.' })}
    ${exploredMaps()}`;
}

async function deleteCharacter(c) {
  const ids = c.sessions.slice();
  await state.store.deleteSessions(ids);
  state.settings = { ...state.settings, deletedSessions: [...new Set([...(state.settings.deletedSessions || []), ...ids])] };
  await state.store.saveSettings(state.settings);
  state.sessions = state.sessions.filter((s) => !ids.includes(s.id));
  state.tracks = null;
  invalidate();
}

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

// The RPG menu used by Locations and Quests: continents down the left, the
// chosen continent's zones in the middle, the chosen thing on the right.
// The page is the point: with a zone chosen the navigator folds to a rail,
// and clicking around re-renders only what changed (zones under a
// continent, or the page for a zone), never the whole menu.
// groups: [{ name, zones: [{ zoneId, name, minLevel, maxLevel, ... }] }].
// ring(g|z) -> { done, total, sub? }; bars(z) -> [{ done, total, cls, title }];
// dim(z) -> true for a zone you have not been to; detail(continent, zone) ->
// the page's HTML; after(continent, zone) runs once it is in the document.
function rpgMenu(spec) {
  const { base, groups, footer = '' } = spec;
  const ring = (done, total, size = 44) => `<span class="pring" style="--p:${pctOf(done, total)};--s:${size}px"><span>${pctOf(done, total)}<i>%</i></span></span>`;
  const levelText = (z) => (z.minLevel ? `${z.minLevel}${z.maxLevel && z.maxLevel !== z.minLevel ? `–${z.maxLevel}` : ''}` : '');
  const link = (c, z) => `${base}?continent=${enc(c)}${z ? `&zone=${z}` : ''}`;
  const left = () => `${groups.map((g) => { const r = spec.ring(g); return `<a class="rpg-item ${g === spec.continent ? 'active' : ''}" href="${link(g.name)}" data-continent="${esc(g.name)}" title="${esc(g.name)}">${ring(r.done, r.total, 40)}<span class="rpg-text"><b>${esc(g.name)}</b><small>${r.sub ?? `${r.done.toLocaleString()} / ${r.total.toLocaleString()}`}</small></span></a>`; }).join('')}
    ${footer ? `<div class="rpg-foot">${footer}</div>` : ''}`;
  const listLabel = (g) => (spec.listLabel ? spec.listLabel(g) : `${g.zones.length} zones · by level`);
  const middle = () => (spec.continent ? `<div class="rpg-head"><span class="kicker">${esc(spec.continent.name)}</span>${listLabel(spec.continent) ? `<span class="muted small">${esc(listLabel(spec.continent))}</span>` : ''}</div>
    ${spec.continent.zones.map((z) => { const r = spec.ring(z); return `<a class="rpg-row ${z === spec.zone ? 'active' : ''} ${spec.dim?.(z) ? 'dim' : ''}" href="${link(spec.continent.name, z.zoneId)}" data-zone="${z.zoneId}">
      <span class="rpg-lvl">${levelText(z) || '·'}</span>
      <span class="rpg-name"><b>${esc(z.name)}</b><span class="rpg-bars">${spec.bars(z).map((b) => `<span class="bar ${b.cls ?? ''}" title="${esc(b.title ?? '')}"><span style="width:${pctOf(b.done, b.total)}%"></span></span>`).join('')}</span></span>
      <span class="rpg-pct"><span>${pctOf(r.done, r.total)}<i>%</i></span></span>
    </a>`; }).join('')}` : '');
  const detail = () => spec.detail(spec.continent, spec.zone);
  setTimeout(() => {
    const root = document.querySelector('.rpg');
    if (!root) return;
    const listEl = root.querySelector('.rpg-list');
    const detailEl = root.querySelector('.rpg-detail');
    const enter = (el) => { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); [...el.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14))); };
    const show = () => { detailEl.innerHTML = detail(); enter(detailEl); root.classList.toggle('rpg--zone', Boolean(spec.zone)); spec.after?.(spec.continent, spec.zone); };
    root.addEventListener('click', (ev) => {
      const item = ev.target.closest('.rpg-item');
      const row = ev.target.closest('.rpg-row');
      if (!item && !row) return;
      ev.preventDefault();
      if (item) {
        const g = groups.find((x) => x.name === item.dataset.continent);
        if (!g) return;
        spec.continent = g; spec.zone = null;
        for (const el of root.querySelectorAll('.rpg-item')) el.classList.toggle('active', el === item);
        listEl.innerHTML = middle(); enter(listEl);
      } else {
        spec.zone = spec.continent.zones.find((z) => String(z.zoneId) === row.dataset.zone) || null;
        for (const el of root.querySelectorAll('.rpg-row')) el.classList.toggle('active', el === row);
      }
      history.pushState(null, '', item ? item.getAttribute('href') : row.getAttribute('href'));
      show();
      if (spec.zone && window.innerWidth < 1100) detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    spec.after?.(spec.continent, spec.zone);
  });
  return `<div class="rpg ${spec.zone ? 'rpg--zone' : ''}"><div class="rpg-menu" role="navigation" aria-label="Continents">${left()}</div><div class="rpg-list" aria-label="Zones">${middle()}</div><section class="rpg-detail">${detail()}</section></div>`;
}
// A quest's requirement as a chip, only when it matters: the selected
// character does not fit it, or nobody is selected and it is narrower than
// a whole faction.
function reqChip(q, cov) {
  if (!q) return '';
  const text = requirementText(q);
  if (!text) return '';
  const who = cov?.ctx?.who;
  if (who ? fits(q, who) : (text === 'Alliance' || text === 'Horde')) return '';
  return ` <span class="chip req">${esc(text)}</span>`;
}
const rpgRing = (done, total, size = 72) => `<span class="pring" style="--p:${pctOf(done, total)};--s:${size}px"><span>${pctOf(done, total)}<i>%</i></span></span>`;
const rpgStat = (label, done, total, href = '') => `<${href ? `a href="${href}"` : 'div'} class="rpg-stat"><span class="muted small">${label}</span><b>${done.toLocaleString()}${total != null ? ` <span class="muted">/ ${total.toLocaleString()}</span>` : ''}</b>${total != null ? `<span class="bar"><span style="width:${pctOf(done, total)}%"></span></span>` : ''}</${href ? 'a' : 'div'}>`;
// A name in the wiki: normal once done (killed, met, obtained), gray until then.
const wikiName = (href, name, done, count = 0) => `<a href="${href}" class="${done ? '' : 'dim'}">${esc(name)}</a>${count > 1 ? ` <span class="count">×${count}</span>` : ''}`;

pages.locations = async (_, params) => {
  const db = await questDB();
  if (!db) return `${pageHead('World', 'Locations', 'Every place you have been. The quest database is not available, so there is nothing to show yet.')}`;
  const spawns = await spawnTable();
  const { maps, codex: c, world, sessions } = derived();
  const cov = coverageWho();
  const known = (z) => new Set([...(z?.subzones || []), ...(z?.discovered || [])]);
  const codexZone = (name) => c.zones.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  const discovery = (name) => { const z = codexZone(name); return z ? { discovered: z.discovered?.length || 0, known: known(z).size, areas: z.discovered || [] } : null; };
  const tree = completionTree(db, cov.ctx, discovery);
  const groups = ZONE_GROUPS.map((g) => tree.groups.find((x) => x.name === g)).filter(Boolean);
  for (const g of groups) { g.zones.sort((a, b) => (a.minLevel ?? 99) - (b.minLevel ?? 99) || a.name.localeCompare(b.name)); g.visited = g.zones.filter((z) => codexZone(z.name)).length; }
  const continent = groups.find((g) => g.name === params.get('continent')) || groups[0];
  const zone = continent?.zones.find((z) => String(z.zoneId) === params.get('zone')) || null;
  const byZone = npcsByZone(db);
  const visitedAll = groups.reduce((n, g) => n + g.visited, 0);
  const zonesAll = groups.reduce((n, g) => n + g.zones.length, 0);
  const stories = storylines(db, cov.ctx);
  const experienced = new Set(c.quests.map((q) => q.qid).filter(Boolean));
  const mapIdFor = (z) => maps.find((m) => m.zone?.toLowerCase() === z.name.toLowerCase())?.id ?? z.mapId ?? null;
  // Verified pins: where the database places the people you have met, the
  // creatures you have hunted and the objects you have opened in this zone.
  // A few spawn points each, every one a link to its page.
  const pinsFor = (z) => {
    const out = [];
    const add = (n, layer, pts, max) => { for (const [x, y] of pts.slice(0, max)) out.push({ x, y, layer, label: n.name, key: n.key, href: `#/npc/${enc(n.key)}` }); };
    for (const n of world.people) if (n.zones.includes(z.name) && peopleStatus(n) !== 'seen') for (const id of n.ids || (n.npcId ? [n.npcId] : [])) add(n, n.quests.size ? 'quest' : 'person', spawns[`n${id}`]?.[z.zoneId] || [], 4);
    for (const n of world.creatures) if (n.zones.includes(z.name) && n.kills > 0) for (const id of n.ids || (n.npcId ? [n.npcId] : [])) add(n, 'creature', spawns[`n${id}`]?.[z.zoneId] || [], 6);
    for (const n of world.objects) if (n.zones.includes(z.name) && n.loots > 0 && n.objectId) add(n, 'object', spawns[`o${n.objectId}`]?.[z.zoneId] || [], 6);
    return out;
  };
  const detail = (cont, z) => {
    if (!z) {
      return `<div class="rpg-title"><div><span class="kicker">Continent</span><h2>${esc(cont.name)}</h2></div>${rpgRing(cont.visited, cont.zones.length)}</div>
        <div class="rpg-stats">
          ${rpgStat('Zones visited', cont.visited, cont.zones.length)}
          ${rpgStat('Areas discovered', cont.discovered, cont.known)}
          ${rpgStat('Quests done', cont.done, cont.total, `#/quests?continent=${enc(cont.name)}`)}
        </div>
        <p class="muted small">Pick a zone for its page: the map, its areas, quests, people and creatures as you found them.</p>`;
    }
    const cz = codexZone(z.name);
    const d = discovery(z.name);
    const mapId = mapIdFor(z);
    const people = world.people.filter((n) => n.zones.includes(z.name)).sort((a, b) => a.name.localeCompare(b.name));
    const creatures = world.creatures.filter((n) => n.zones.includes(z.name)).sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name));
    const objects = world.objects.filter((n) => n.zones.includes(z.name));
    const dbPeople = byZone.get(z.zoneId)?.people.length ?? 0;
    const dbCreatures = byZone.get(z.zoneId)?.creatures.length ?? 0;
    const dbQuests = (db.questsByZone.get(z.zoneId) || []).filter((q) => !q.hidden).length;
    const quests = (cz ? [...cz.quests] : []).map((k) => c.quests.find((q) => q.key === k)).filter(Boolean).sort((a, b) => (a.status === 'done' ? 0 : 1) - (b.status === 'done' ? 0 : 1) || String(a.title).localeCompare(String(b.title)));
    const list = (title, items, more = '') => (items.length ? `<div class="wiki-sec"><h3>${title} <span class="muted">${items.length}</span>${more}</h3><p class="wiki-names">${items.join(' · ')}</p></div>` : '');
    if (!cz) {
      return `<div class="rpg-title"><div><span class="kicker">${esc(cont.name)}${z.minLevel ? ` · level ${z.minLevel}${z.maxLevel !== z.minLevel ? `–${z.maxLevel}` : ''}` : ''}</span><h2>${esc(z.name)}</h2></div>${rpgRing(0, 0)}</div>
        ${mapId ? `<div class="map wiki-map" id="locMap"></div>` : ''}
        <p class="muted">Not visited yet. ${dbQuests.toLocaleString()} quests, ${dbPeople.toLocaleString()} people and ${dbCreatures.toLocaleString()} creatures are waiting here.</p>`;
    }
    // What happened here, from every character's log.
    const here = { deaths: 0, rares: [], items: new Map(), first: null, last: null, events: 0, chars: new Set(), levels: 0, gold: 0 };
    for (const sess of sessions) for (const e of sess.events) {
      if (e.z !== z.name) continue;
      here.events++;
      if (sess.char?.name) here.chars.add(sess.char.name);
      if (e.e === 'death') here.deaths++;
      if (e.e === 'level') here.levels++;
      if (e.e === 'money' && e.delta > 0) here.gold += e.delta;
      if (e.e === 'loot' && e.id && (e.q ?? 1) >= 2) here.items.set(e.id, { id: e.id, name: e.name, q: e.q ?? world.byItem.get(e.id)?.quality ?? 1 });
      if (!here.first || e.t < here.first) here.first = e.t;
      if (!here.last || e.t > here.last) here.last = e.t;
    }
    const rares = creatures.filter((n) => n.rare);
    const roles = [['vendor', 'Vendors'], ['trainer', 'Trainers'], ['taxi', 'Flight master'], ['innkeeper', 'Innkeeper'], ['banker', 'Bank']].map(([r, l]) => [l, people.filter((n) => n.roles.includes(r) && n.met)]).filter(([, arr]) => arr.length);
    const storiesHere = stories.filter((st) => st.zones.includes(z.name) && st.quests.some((r) => experienced.has(r.q.id)));
    const kinds = new Map();
    for (const n of creatures) { const k = n.ctype || 'Other'; kinds.set(k, (kinds.get(k) || 0) + 1); }
    const factions = new Map();
    for (const n of people) { const f = n.faction || ''; if (f) factions.set(f, (factions.get(f) || 0) + 1); }
    const marks = c.marks.filter((m) => m.z === z.name);
    const texts = c.books.filter((b) => b.zone === z.name).length;
    const overheard = world.npcs.filter((n) => n.zones.includes(z.name)).reduce((n, x) => n + x.lines.length, 0);
    return `<div class="rpg-title"><div><span class="kicker">${esc(cont.name)}${z.minLevel ? ` · level ${z.minLevel}${z.maxLevel !== z.minLevel ? `–${z.maxLevel}` : ''}` : ''}</span><h2>${esc(z.name)}</h2>
        <div class="muted small">${here.first ? `First set foot ${esc(when(here.first))}` : ''}${here.chars.size ? ` · ${[...here.chars].map(esc).join(', ')}` : ''}</div></div>${rpgRing(d?.discovered ?? 0, d?.known ?? 0)}</div>
      ${mapId ? `<div class="map wiki-map" id="locMap"></div>` : ''}
      <div class="rpg-stats four">
        ${rpgStat('Areas discovered', d.discovered, d.known, mapId ? `#/map/${mapId}` : '')}
        ${rpgStat('Quests done', z.done, z.total, `#/quests?continent=${enc(cont.name)}&zone=${z.zoneId}`)}
        ${rpgStat('People met', people.filter((n) => peopleStatus(n) !== 'seen').length, dbPeople, `#/people?zone=${enc(z.name)}`)}
        ${rpgStat('Monsters hunted', creatures.filter((n) => n.kills > 0).length, dbCreatures, `#/bestiary?zone=${enc(z.name)}`)}
      </div>
      <div class="wiki-kv">
        ${here.levels ? `<div><small>Levels gained here</small><b>${here.levels}</b></div>` : ''}
        ${here.deaths ? `<div><small>Deaths here</small><b>${here.deaths}</b></div>` : ''}
        ${rares.length ? `<div><small>Rares met</small><b>${rares.filter((n) => n.kills > 0).length} / ${rares.length}</b></div>` : ''}
        ${here.gold ? `<div><small>Gold earned here</small><b>${money(here.gold)}</b></div>` : ''}
        ${kinds.size ? `<div><small>Kinds of creature</small><b>${kinds.size}</b></div>` : ''}
        ${factions.size ? `<div><small>Factions</small><b>${[...factions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => esc(f)).join(', ')}</b></div>` : ''}
        ${texts || overheard ? `<div><small>Words heard</small><b>${overheard} overheard${texts ? `, ${texts} book${texts === 1 ? '' : 's'}` : ''}</b></div>` : ''}
        ${marks.length ? `<div><small>Marks</small><b>${marks.length}</b></div>` : ''}
      </div>
      <div class="wiki-cols">
        ${list('Areas', (d.areas || []).map((a) => `<span class="chip done">${esc(a)}</span>`).concat([...new Set(cz.subzones || [])].filter((x) => !(d.areas || []).includes(x)).map((a) => `<span class="chip">${esc(a)}</span>`)))}
        ${list('Storylines here', storiesHere.map((st) => `<a href="#/storyline/${st.id}">${esc(st.name)}</a> <span class="muted small">${pctOf(st.done, st.total)}%</span>`))}
        ${list('Quests', quests.map((q) => `<a href="#/quest/${enc(q.key)}" class="${q.status === 'done' ? '' : 'dim'}">${esc(q.title ?? `Quest ${q.qid}`)}</a>`), z.total ? ` <span class="muted small">of ${z.total} here</span>` : '')}
        ${roles.map(([l, arr]) => list(l, arr.map((n) => wikiName(`#/npc/${enc(n.key)}`, n.name, true)))).join('')}
        ${list('People', people.filter((n) => !roles.some(([, arr]) => arr.includes(n))).map((n) => wikiName(`#/npc/${enc(n.key)}`, n.name, peopleStatus(n) !== 'seen')))}
        ${list('Rares', rares.map((n) => wikiName(`#/npc/${enc(n.key)}`, n.name, n.kills > 0)))}
        ${list('Creatures', creatures.filter((n) => !n.rare).map((n) => wikiName(`#/npc/${enc(n.key)}`, n.name, n.kills > 0)))}
        ${list('Gathered here', objects.map((n) => wikiName(`#/npc/${enc(n.key)}`, n.name, n.loots > 0)))}
        ${list('Notable finds', [...here.items.values()].sort((a, b) => b.q - a.q).slice(0, 24).map((it) => itemLink(it.id, it.name, it.q)))}
      </div>
      <div class="row" style="margin-top:14px">${mapId ? `<a class="btn" href="#/map/${mapId}">Full map</a>` : ''}</div>`;
  };
  const after = (cont, z) => {
    if (!z) return;
    const mapId = mapIdFor(z);
    if (mapId) wireMap('locMap', mapId, pinsFor(z), { routes: false, hidden: new Set(['density', 'time', 'unfound', 'rares']) });
  };
  return `${pageHead('World', 'Locations', 'Every place in Classic as you have found it: the map, the areas you discovered, the quests, people and creatures you met there. Grey means not yet.', `<p class="muted" style="margin:0">For ${whoSelect(cov)}</p>`)}
    ${rpgMenu({
      base: '#/locations', groups, continent, zone,
      ring: (x) => (x.zones ? { done: x.visited, total: x.zones.length, sub: `${x.visited} of ${x.zones.length} zones visited` } : { done: x.discovered, total: x.known }),
      bars: (z) => [{ done: z.discovered, total: z.known, cls: 'disc', title: 'Areas discovered' }, { done: z.done, total: z.total, title: 'Quests done' }],
      dim: (z) => !codexZone(z.name),
      detail, after,
      footer: `<div class="muted small">All of Classic</div><div class="cov"><div class="bar"><div style="width:${pctOf(visitedAll, zonesAll)}%"></div></div><b>${pctOf(visitedAll, zonesAll)}%</b></div><div class="muted small">${visitedAll} of ${zonesAll} zones visited.</div>`,
    })}`;
};

// The maps you have set foot on (your journal, not the world).
function exploredMaps() {
  const { maps, codex } = derived();
  const known = (z) => new Set([...(z?.subzones || []), ...(z?.discovered || [])]);
  const discovery = (name) => { const z = codex.zones.find((x) => x.name === name); return z ? { discovered: z.discovered?.length || 0, known: known(z).size } : null; };
  return `<h2>Maps you have explored</h2>
    ${table(maps, [
      { label: 'Map', value: (m) => m.zone ?? `Map ${m.id}`, html: (m) => `<a href="#/map/${m.id}">${esc(m.zone ?? `Map ${m.id}`)}</a> <span class="muted small">${m.id}</span>` },
      { label: 'Discovered', value: (m) => { const d = discovery(m.zone); return d ? pctOf(d.discovered, d.known) : 0; }, html: (m) => { const d = discovery(m.zone); return d ? covBar(d.discovered, d.known) : ''; }, num: true },
      { label: 'Areas', value: (m) => m.subzones.join(', ') },
      { label: 'Pins', value: (m) => m.markers.length, num: true },
      { label: 'Quests', value: (m) => m.counts.quest ?? 0, num: true },
      { label: 'Creatures', value: (m) => m.counts.creature ?? 0, num: true },
      { label: 'First visit', value: (m) => m.first?.t ?? 0, html: (m) => (m.first ? play(m.first) : '') },
    ], { search: (m) => `${m.zone} ${m.subzones.join(' ')}`, sort: 3, desc: true, empty: 'No maps yet. Positions are logged by addon 0.3.0 and later.' })}`;
}

// Zone maps you have not been on, with the database's pins.
async function otherMaps(maps) {
  const db = await questDB();
  if (!db) return '';
  const seen = new Set(maps.map((m) => String(m.id)));
  const rest = Object.entries(CLASSIC_ZONE_IDS).filter(([id]) => !seen.has(id)).map(([id, area]) => ({ id: Number(id), name: db.zoneName(area), quests: (db.questsByZone.get(area) || []).filter((q) => !q.hidden).length })).sort((a, b) => a.name.localeCompare(b.name));
  return `<h2>Other maps</h2><p class="muted">Every Classic zone, with quest givers not found yet and rare spawns from the quest database.</p>
    <p class="chips">${rest.map((z) => `<a class="chip" href="#/map/${z.id}?show=unfound,rares">${esc(z.name)} <span class="muted">${z.quests}</span></a>`).join(' ')}</p>`;
}

// Storylines: quest chains from the database as chapters ----------------------

pages.storylines = async (_, params) => {
  const db = await questDB();
  if (!db) return `${pageHead('World', 'Storylines', 'Quest chains as chapters. The quest database is not available, so there is nothing to show yet.')}`;
  const cov = coverageWho();
  const c = await codex();
  const experienced = new Set(c.quests.map((q) => q.qid).filter(Boolean));
  const every = storylines(db, cov.ctx);
  const started = (st) => st.quests.some((r) => experienced.has(r.q.id));
  const finished = (st) => st.total > 0 && st.done === st.total;
  // Zones as Locations and Quests know them, each with the storylines that begin there.
  const tree = completionTree(db, cov.ctx);
  const byStart = new Map();
  for (const st of every) { const k = st.zoneIds[0] ?? -1; if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(st); }
  const zoneRow = (z, list) => ({ zoneId: z.zoneId, name: z.name, minLevel: z.minLevel, maxLevel: z.maxLevel, all: list, mine: list.filter(started), done: list.reduce((n, st) => n + st.done, 0), total: list.reduce((n, st) => n + st.total, 0) });
  const groups = ZONE_GROUPS.map((g) => tree.groups.find((x) => x.name === g)).filter(Boolean).map((g) => {
    const zones = g.zones.map((z) => zoneRow(z, byStart.get(z.zoneId) || [])).filter((z) => z.all.length).sort((a, b) => (a.minLevel ?? 99) - (b.minLevel ?? 99) || a.name.localeCompare(b.name));
    return { name: g.name, zones, done: zones.reduce((n, z) => n + z.done, 0), total: zones.reduce((n, z) => n + z.total, 0) };
  }).filter((g) => g.zones.length);
  const loose = every.filter((st) => !st.zoneIds.length || !groups.some((g) => g.zones.some((z) => z.zoneId === st.zoneIds[0])));
  if (loose.length) { const z = zoneRow({ zoneId: -1, name: 'Class, profession & events' }, loose); groups.push({ name: 'Elsewhere', zones: [z], done: z.done, total: z.total, single: true }); }
  const continent = groups.find((g) => g.name === params.get('continent')) || groups.find((g) => g.zones.some((z) => z.mine.length)) || groups[0];
  const zone = continent?.zones.find((z) => String(z.zoneId) === params.get('zone')) || (continent?.single ? continent.zones[0] : null);
  const startedAll = every.filter(started);
  const row = (st) => ({ ...st, sub: `${st.zones.join(' → ')}${st.minLevel ? ` · level ${st.minLevel}${st.maxLevel !== st.minLevel ? `–${st.maxLevel}` : ''}` : ''}` });
  const detail = (cont, z) => {
    if (!z) {
      const mine = cont.zones.reduce((n, x) => n + x.mine.length, 0);
      const all = cont.zones.reduce((n, x) => n + x.all.length, 0);
      return `<div class="rpg-title"><div><span class="kicker">${cont.single ? 'Category' : 'Continent'}</span><h2>${esc(cont.name)}</h2></div>${rpgRing(cont.done, cont.total)}</div>
        <div class="rpg-stats">
          ${rpgStat('Storylines started', mine, all)}
          ${rpgStat('Finished', cont.zones.reduce((n, x) => n + x.mine.filter(finished).length, 0), all)}
          ${rpgStat('Chapters done', cont.done, cont.total)}
        </div>
        <p class="muted small">Pick a zone for the storylines that begin there. Only the chains you have set foot in are listed; the rest only count.</p>`;
    }
    return `<div class="rpg-title"><div><span class="kicker">${esc(cont.name)}${z.minLevel ? ` · level ${z.minLevel}${z.maxLevel !== z.minLevel ? `–${z.maxLevel}` : ''}` : ''}</span><h2>${esc(z.name)}</h2></div>${rpgRing(z.done, z.total)}</div>
      <div class="rpg-stats">
        ${rpgStat('Storylines started', z.mine.length, z.all.length)}
        ${rpgStat('Finished', z.mine.filter(finished).length, z.all.length)}
        ${rpgStat('Chapters done', z.done, z.total)}
      </div>
      ${z.mine.length ? table(z.mine.map(row), [
        ...completionColumns('Storyline', (r) => `#/storyline/${r.id}`),
        { label: 'Chapters', value: (r) => r.quests.length, num: true },
        { label: 'Next', value: (r) => r.next?.n ?? '', html: (r) => (r.next ? `<a href="#/quest/q${r.next.id}">${esc(r.next.n)}</a>` : (finished(r) ? '<span class="chip done">finished</span>' : '')) },
      ], { search: (r) => `${r.name} ${r.zones.join(' ')} ${r.quests.map((q) => q.q.n).join(' ')}`, sort: 1, desc: true, limit: 200 }) : `<p class="muted small">None of the ${z.all.length} storylines that begin here have been started yet.</p>`}`;
  };
  return `${pageHead('World', 'Storylines', 'The quest chains you have set foot in, by the zone where each begins: what led to what, across zones. A storyline is the spine of a zone episode; pick one for its outline.', `<p class="muted" style="margin:0">For ${whoSelect(cov)}</p>`)}
    ${rpgMenu({
      base: '#/storylines', groups, continent, zone,
      ring: (x) => ({ done: x.done, total: x.total, sub: x.zones ? `${x.zones.reduce((n, z) => n + z.mine.length, 0)} / ${x.zones.reduce((n, z) => n + z.all.length, 0)} started` : undefined }),
      listLabel: (g) => (g.single ? '' : `${g.zones.length} zones · by level`),
      bars: (z) => [{ done: z.done, total: z.total, title: 'Chapters done' }],
      dim: (z) => !z.mine.length,
      detail,
      footer: `<div class="muted small">All of Classic</div><div class="cov"><div class="bar"><div style="width:${pctOf(startedAll.length, every.length)}%"></div></div><b>${pctOf(startedAll.length, every.length)}%</b></div><div class="muted small">${startedAll.length} of ${every.length} storylines started · ${startedAll.filter(finished).length} finished.</div>`,
    })}`;
};

pages.storyline = async (id) => {
  const db = await questDB();
  if (!db) return '<p>The quest database is not available.</p>';
  const cov = coverageWho();
  const s = storylines(db, cov.ctx).find((x) => String(x.id) === String(id)) || storylines(db, {}).find((x) => String(x.id) === String(id));
  if (!s) return `${crumb('#/storylines', 'Storylines')}<p>No such storyline.</p>`;
  const c = await codex();
  const codexQuests = new Map(c.quests.map((q) => [q.key, q]));
  const giverName = (q) => { const g = givers(db, q)[0]; return g ? `${g.name}${g.zone ? ` · ${esc(db.zoneName(g.zone))}` : ''}` : ''; };
  setTimeout(() => document.getElementById('outlineDl')?.addEventListener('click', () => download(`${s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-outline.md`, 'text/markdown', storylineOutline(s, codexQuests))));
  return `${crumb('#/storylines', 'Storylines')}
    ${pageHead('Storyline', esc(s.name), `${esc(s.zones.join(' → '))}${s.minLevel ? ` · level ${s.minLevel}${s.maxLevel !== s.minLevel ? `–${s.maxLevel}` : ''}` : ''} · ${s.quests.length} chapters.`, `<p class="muted" style="margin:0">For ${whoSelect(cov)}</p>`)}
    ${completionHero(s.done, s.total, `${s.done} of ${s.total} chapters done.`, `${s.quests.filter((r) => codexQuests.has(`q${r.q.id}`)).length} chapters found so far; the rest stay grey until you find them.`)}
    <ol class="chapters">
      ${s.quests.filter((r) => r.state !== 'excluded').map((r, i) => { const cq = codexQuests.get(`q${r.q.id}`); const seen = Boolean(cq); const req = reqChip(r.q, cov); return seen ? `<li class="chapter st-${r.state}">
        <div class="row spread"><span><span class="muted">${i + 1}.</span> <a href="#/quest/q${r.q.id}"><b>${esc(r.q.n)}</b></a> ${r.q.l ? `<span class="muted small">level ${r.q.l}</span>` : ''}</span><span class="tags">${req}${r.state === 'other' ? '' : stateChip(r.state)}</span></div>
        <div class="muted small">${esc(db.zoneName(r.q.zone ?? r.q.z) ?? '')}${giverName(r.q) ? ` · from ${giverName(r.q)}` : ''}</div>
        ${r.q.o ? `<div class="small">${esc(r.q.o)}</div>` : ''}
      </li>` : `<li class="chapter dim"><div class="row spread"><span><span class="muted">${i + 1}.</span> <span class="dim">${esc(r.q.n)}</span> ${r.q.l ? `<span class="muted small">level ${r.q.l}</span>` : ''}</span><span class="tags">${req}</span></div></li>`; }).join('')}
    </ol>
    <p class="muted small"><button class="ghost small" id="outlineDl">Outline for writing (Markdown)</button></p>`;
};

// Shorts: the moments worth a vertical, cut ready ----------------------------

pages.shorts = async () => {
  const { world, recordings } = derived();
  const highlights = findHighlights(derived().sessions, derived().moment, (id) => world.byItem.get(id)?.quality ?? null);
  const shorts = findShorts(highlights);
  const byRec = new Map(recordings.map((r) => [r.id, r]));
  setTimeout(() => {
    document.getElementById('shortsCsv')?.addEventListener('click', () => download('shorts.csv', 'text/csv', shortsCSV(shorts, byRec)));
    for (const b of document.querySelectorAll('[data-short]')) b.addEventListener('click', () => { const sh = shorts[Number(b.dataset.short)]; const r = byRec.get(sh.rec); if (r) download(`short-${sh.labels[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xml`, 'application/xml', toShortXML(r, sh)); });
  });
  return `${pageHead('Footage', 'Shorts', 'Moments worth a vertical short, cut from the highlights with room before and after: deaths, close calls, rares, great loot, level-ups and your marks. Each one exports as a 9:16 Premiere sequence showing the centre of the frame.', `<div class="row"><button class="ghost" id="shortsCsv" ${shorts.length ? '' : 'disabled'}>All shorts (CSV)</button></div>`)}
    ${table(shorts.map((sh, i) => ({ ...sh, i })), [
      { label: 'Score', value: (sh) => sh.score, html: (sh) => `<b>${Math.round(sh.score)}</b>`, num: true },
      { label: 'Moment', value: (sh) => sh.labels.join(' / '), html: (sh) => `${sh.kinds.map((k) => `<span class="chip">${esc(HIGHLIGHT_KINDS[k] ?? k)}</span>`).join(' ')} ${esc(sh.labels.join(' / '))}` },
      { label: 'Recording', value: (sh) => byRec.get(sh.rec)?.name ?? sh.rec, html: (sh) => `<a class="btn play" href="#/recording/${sh.rec}?t=${sh.in.toFixed(2)}">▶ ${tc(sh.in)} – ${tc(sh.out)}</a>` },
      { label: 'Seconds', value: (sh) => sh.duration, html: (sh) => sh.duration.toFixed(0), num: true },
      { label: 'Where', value: (sh) => [sh.zone, sh.char].filter(Boolean).join(' · ') },
      { label: '', value: () => '', html: (sh) => `<button class="ghost small" data-short="${sh.i}">Premiere 9:16</button>` },
    ], { sort: 0, desc: true, search: (sh) => `${sh.labels.join(' ')} ${sh.zone} ${sh.char} ${sh.kinds.join(' ')}`, empty: 'No shorts yet. They appear once highlights land on recorded footage.' })}`;
};

// Episodes: everything recorded in one zone, as one sequence --------------------

pages.episodes = async (_, params) => {
  if (!state.tracks) { try { state.tracks = state.schema2 ? await state.store.loadTracks() : new Map(); } catch { state.tracks = new Map(); } }
  const { recordings, clock, maps } = derived();
  const zones = [...new Map(maps.filter((m) => m.zone).map((m) => [m.zone, m])).values()].map((m) => m.zone).sort();
  const zone = params.get('zone') || zones[0] || '';
  const mapIds = maps.filter((m) => m.zone === zone).map((m) => m.id);
  const toMs = (s, t) => eventMs(s, { t }, clock);
  const markers = [];
  for (const s of derived().sessions) for (const e of s.events) {
    if (e.e !== 'quest_turnin' || (e.z && e.z !== zone)) continue;
    const mo = derived().moment(s, e);
    if (mo.footage) markers.push({ rec: mo.footage.rec, offset: mo.footage.offset, label: `Quest complete: ${e.title ?? e.qid}`, comment: [e.z, e.sz].filter(Boolean).join(' · ') });
  }
  const ep = zone ? assembleEpisode({ mapIds, sessions: derived().sessions, tracks: state.tracks, recordings, toMs, markers }) : { clips: [], markers: [], duration: 0 };
  const byRec = new Map(recordings.map((r) => [r.id, r]));
  setTimeout(() => {
    document.getElementById('epZone')?.addEventListener('change', (ev) => { location.hash = `#/episodes?zone=${enc(ev.target.value)}`; });
    document.getElementById('epXml')?.addEventListener('click', () => download(`episode-${zone.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xml`, 'application/xml', toEpisodeXML(zone, ep, recordings)));
    document.getElementById('epChapters')?.addEventListener('click', () => download(`episode-${zone.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-chapters.txt`, 'text/plain', episodeChapters(ep)));
  });
  return `${pageHead('Footage', 'Episodes', 'A zone episode assembled from every recorded stretch you spent there, in the order you played it, with a marker at each quest turned in. Import the sequence into Premiere and cut from there.', `<div class="row"><label class="row" style="margin:0"><span>Zone</span><select id="epZone">${zones.map((z) => `<option ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label><button id="epXml" ${ep.clips.length ? '' : 'disabled'}>Premiere sequence</button><button class="ghost" id="epChapters" ${ep.clips.length ? '' : 'disabled'}>Chapters</button></div>`)}
    ${zone ? `<div class="cards">${card(ep.clips.length, 'stretches', '#/footage')}${card(Math.round(ep.duration / 60), 'minutes', '#/footage')}${card(ep.markers.length, 'quests turned in', '#/quests')}</div>` : '<p class="muted">No zone recorded yet. Episodes need recordings and the route the addon logs.</p>'}
    ${table(ep.clips, [
      { label: 'Recording', value: (c) => c.recName, html: (c) => `<a class="btn play" href="#/recording/${c.rec}?t=${c.in.toFixed(2)}">▶ ${tc(c.in)} – ${tc(c.out)}</a> <span class="muted small">${esc(c.recName)}</span>` },
      { label: 'In the episode', value: (c) => c.start, html: (c) => tc(c.start), num: true },
      { label: 'Seconds', value: (c) => c.duration, html: (c) => c.duration.toFixed(0), num: true },
      { label: 'Character', value: (c) => c.char ?? '' },
    ], { empty: 'Nothing recorded in this zone yet.' })}
    ${ep.markers.length ? `<h2>Chapters</h2><pre class="small">${esc(episodeChapters(ep))}</pre>` : ''}`;
};

pages.map = async (id, params) => {
  const { maps } = derived();
  const db = await questDB();
  const areaId = CLASSIC_ZONE_IDS[id] ?? null;
  let m = maps.find((x) => String(x.id) === String(id));
  if (!m) {
    // A map you have not been on: the database's pins only.
    if (!db || !areaId) return '<p>Map not found.</p>';
    m = { id: Number(id), zone: db.zoneName(areaId), subzones: [], markers: [], counts: {}, events: 0, first: null, last: null };
  }
  if (!state.tracks && state.schema2) {
    try { state.tracks = await state.store.loadTracks(); } catch { state.tracks = new Map(); }
  }
  // Layers: what you last chose (remembered on this computer), plus whatever
  // the page that sent you here asks to show. Fresh: quests and your route.
  const shown = new Set(savedLayers() ?? MAP_DEFAULT_LAYERS);
  for (const k of (params.get('show') || '').split(',').filter(Boolean)) shown.add(k);
  for (const k of (params.get('hide') || '').split(',').filter(Boolean)) shown.delete(k);
  const hidden = new Set(Object.keys(LAYERS).filter((k) => !shown.has(k)));
  const dbPins = await dbMapPins(db, areaId);
  const markers = [...m.markers, ...dbPins];
  const counts = { ...m.counts };
  for (const p of dbPins) counts[p.layer] = (counts[p.layer] || 0) + 1;
  const timePoints = routesFor(m.id, derived().sessions, state.tracks).flatMap((r) => r.points.map(([x, y]) => ({ x, y })));
  const heat = { density: heatCells(m.markers.filter((mk) => mk.layer === 'creature'), 4), time: heatCells(timePoints, 3) };
  const services = derived().world.people;
  setTimeout(() => {
    wireMap('zoneMap', m.id, markers, {
      routes: true, hidden, heat,
      onBackground: (x, y) => {
        const near = nearestServices(services, m.id, x, y);
        const KIND = { repair: 'Repair', vendor: 'Vendor', trainer: 'Trainer', flight: 'Flight master', inn: 'Innkeeper', bank: 'Bank', quests: 'Quests' };
        document.getElementById('mapInfo').innerHTML = `<h3>Nearest to ${coords(x, y)}</h3>
          ${near.length ? near.map((n) => `<div class="row spread near"><span>${npcLink(n.key, n.name)}<br><span class="muted small">${n.kinds.map((k) => KIND[k]).join(' · ')}</span></span><span class="muted small" style="text-align:right">${n.dist.toFixed(1)}% ${n.bearing}<br>${coords(n.x, n.y)}</span></div>`).join('') : '<p class="muted small">No vendors, trainers, innkeepers or flight masters met on this map yet.</p>'}
          <p class="muted small" style="margin-top:8px">Click a pin for its moments, or anywhere else for what is nearby.</p>`;
      },
    });
    const layerBox = document.getElementById('mapLayers');
    const setAll = (on, only = null) => {
      for (const cb of layerBox.querySelectorAll('input[type=checkbox]')) {
        const want = only ? only.includes(cb.value) : on;
        if (cb.checked !== want) { cb.checked = want; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    };
    layerBox?.addEventListener('change', () => saveLayers([...layerBox.querySelectorAll('input:checked')].map((cb) => cb.value)));
    document.getElementById('layersAll')?.addEventListener('click', () => setAll(true));
    document.getElementById('layersNone')?.addEventListener('click', () => setAll(false));
    document.getElementById('layersDefault')?.addEventListener('click', () => setAll(false, MAP_DEFAULT_LAYERS));
    document.getElementById('geojson')?.addEventListener('click', () => {
      const routes = routesFor(m.id, derived().sessions, state.tracks);
      download(`${(m.zone ?? `map-${m.id}`).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.geojson`, 'application/geo+json', JSON.stringify(toGeoJSON({ name: m.zone ?? `Map ${m.id}`, mapId: m.id, zone: m.zone, markers: cluster(markers), routes }), null, 1));
    });
  });
  const layers = Object.entries(LAYERS).filter(([k, l]) => k === 'route' || l.heat ? true : counts[k]);
  return `${crumb('#/locations', 'Locations')}
    ${pageHead('Map', esc(m.zone ?? `Map ${m.id}`), esc(m.subzones.join(' · ')), `<div class="row">${m.zone ? `<a class="btn ghost" href="#/zone/${enc(m.zone)}">Zone page</a>` : ''}<label class="btn ghost" style="margin:0"><input type="file" id="mapUpload" accept="image/*" hidden><span>Use my own map image</span></label><button class="ghost" id="geojson" title="Every pin and route as GeoJSON">Download GeoJSON</button><span class="muted small">Take a screenshot of the in-game map (M), crop it to the map itself, and choose it here. Until then the map comes from Wowhead.</span></div>`)}
    <div class="filters" id="mapLayers">${layers.map(([k, l]) => `<label><input type="checkbox" value="${k}" ${hidden.has(k) ? '' : 'checked'}><span class="cat" style="background:${l.color}"></span>${l.name}${counts[k] ? ` <span class="muted">${counts[k]}</span>` : ''}</label>`).join('')}<span class="row" style="margin-left:auto"><button class="ghost small" id="layersDefault" title="Quests and your route">Default</button><button class="ghost small" id="layersAll">All</button><button class="ghost small" id="layersNone">None</button></span></div>
    <div class="map-wrap"><div class="map" id="zoneMap"></div><div class="map-info panel" id="mapInfo"><p class="muted">Click a pin for its moments, or anywhere else on the map for the nearest repair, innkeeper, trainer and flight master.${dbPins.length ? ` Dashed pins are quest givers you have not met; diamonds are rare spawns, both from the quest database.` : ''}</p></div></div>
    ${replayPanel(m)}`;
};

// Route replay: the route walked on this map, drawn in over a few seconds,
// recorded to a WebM (quick B-roll) or a PNG sequence (for Premiere).
function replayPanel(m) {
  const routes = routesFor(m.id, derived().sessions, state.tracks);
  if (!routes.length) return '';
  setTimeout(() => wireReplay(m, routes));
  return `<div class="panel replay" id="replayPanel">
    <div class="row spread"><h3 style="margin:0">Route replay <span class="muted small">${routes.length} stretch${routes.length === 1 ? '' : 'es'} of your route, as B-roll</span></h3>
      <span class="row">
        <label class="row small"><span>Seconds</span><input type="number" id="rpSeconds" value="8" min="3" max="60" step="1" style="width:64px"></label>
        <label class="row small"><span>Size</span><select id="rpSize"><option value="1280x720">1280×720</option><option value="1920x1080" selected>1920×1080</option><option value="1080x1920">1080×1920 (vertical)</option></select></label>
        <label class="row small"><span>FPS</span><select id="rpFps"><option>24</option><option selected>30</option><option>60</option></select></label>
        <button class="ghost small" id="rpPlay">Play</button>
        <button class="small" id="rpWebm">Record WebM</button>
        <button class="ghost small" id="rpPng">PNG sequence</button>
      </span></div>
    <canvas id="rpCanvas" width="1920" height="1080" style="width:100%;height:auto;border-radius:8px;margin-top:10px;background:#000"></canvas>
    <p class="muted small" id="rpNote">The WebM plays in OBS and browsers; Premiere takes the PNG sequence (File › Import, tick "Image Sequence"). The map image must allow cross-origin drawing: your own uploaded map always does.</p>
  </div>`;
}

async function wireReplay(m, routes) {
  const canvas = document.getElementById('rpCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const note = document.getElementById('rpNote');
  const mapImg = document.querySelector('#zoneMap img');
  const settings = () => { const [w, h] = document.getElementById('rpSize').value.split('x').map(Number); return { w, h, seconds: Number(document.getElementById('rpSeconds').value) || 8, fps: Number(document.getElementById('rpFps').value) || 30 }; };
  const image = () => (mapImg && mapImg.complete && mapImg.naturalWidth ? mapImg : null);
  let stop = null;
  const play = (onFrame) => new Promise((resolve) => {
    if (stop) stop();
    const { w, h, seconds, fps } = settings();
    canvas.width = w; canvas.height = h;
    const plan = planReplay(routes, { seconds, fps });
    let frame = 0; let done = false;
    stop = () => { done = true; resolve(); };
    const step = () => {
      if (done) return;
      drawReplayFrame(ctx, { width: w, height: h, image: image(), plan, progress: easeProgress(frame, plan.frames) });
      onFrame?.(frame, plan.frames);
      frame++;
      if (frame >= plan.frames) { done = true; setTimeout(resolve, 300); return; }
      setTimeout(step, 1000 / fps);
    };
    step();
  });
  drawReplayFrame(ctx, { width: canvas.width, height: canvas.height, image: image(), plan: planReplay(routes), progress: 1 });
  mapImg?.addEventListener('load', () => drawReplayFrame(ctx, { width: canvas.width, height: canvas.height, image: image(), plan: planReplay(routes), progress: 1 }));
  const slug = (m.zone ?? `map-${m.id}`).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  document.getElementById('rpPlay')?.addEventListener('click', () => play());
  document.getElementById('rpWebm')?.addEventListener('click', async () => {
    if (!('MediaRecorder' in window)) { toast('This browser cannot record video.'); return; }
    const { fps } = settings();
    const stream = canvas.captureStream(fps);
    const chunks = [];
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12_000_000 }); } catch { rec = new MediaRecorder(stream); }
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    const finished = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start(200);
    note.textContent = 'Recording…';
    await play();
    rec.stop();
    await finished;
    downloadBlob(`${slug}-route.webm`, new Blob(chunks, { type: 'video/webm' }));
    note.textContent = 'Saved. In OBS: Sources › + › Media Source. For Premiere use the PNG sequence.';
  });
  document.getElementById('rpPng')?.addEventListener('click', async () => {
    const { w, h, seconds, fps } = settings();
    if (seconds * fps > 1800) { toast('That is over 1,800 frames. Shorten it or lower the FPS.'); return; }
    canvas.width = w; canvas.height = h;
    const plan = planReplay(routes, { seconds, fps });
    const files = [];
    try {
      for (let i = 0; i < plan.frames; i++) {
        drawReplayFrame(ctx, { width: w, height: h, image: image(), plan, progress: easeProgress(i, plan.frames) });
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not read the canvas'))), 'image/png'));
        files.push({ name: `${slug}-route/${slug}-${String(i + 1).padStart(4, '0')}.png`, data: blob });
        if (i % 10 === 0) note.textContent = `Rendering frame ${i + 1} of ${plan.frames}…`;
      }
      downloadBlob(`${slug}-route-png.zip`, new Blob([await makeZip(files)], { type: 'application/zip' }));
      note.textContent = `${plan.frames} frames at ${fps} fps. Premiere: File › Import, pick the first PNG, tick "Image Sequence".`;
    } catch (err) {
      note.textContent = /security|tainted|insecure/i.test(err.message) ? 'The map image blocks cross-origin drawing. Use "Use my own map image" above, then try again.' : err.message;
    }
  });
}

const MAP_DEFAULT_LAYERS = ['quest', 'route'];
const MAP_LAYERS_KEY = 'chronicler.mapLayers';
function savedLayers() {
  try { const v = JSON.parse(localStorage.getItem(MAP_LAYERS_KEY) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveLayers(list) {
  try { localStorage.setItem(MAP_LAYERS_KEY, JSON.stringify(list)); } catch { /* storage off */ }
}

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
  // Your own uploaded map comes through a temporary link, straight; a
  // Wowhead map is kept locally and reused, so redraws never reload it.
  const first = candidates[0];
  const src = own ? first : memoMapImage(first) || '';
  const pins = cluster(markers);
  const routeLines = Array.isArray(routes) ? routes : routes ? routesFor(mapId, derived().sessions, state.tracks) : [];
  const path = (r) => r.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const heatSvg = Object.entries(heat).map(([layer, cells]) => `<g class="heat layer-${layer}" fill="${LAYERS[layer]?.color ?? '#fff'}">${cells.map((c) => `<ellipse cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" rx="${(2 + 3 * c.w).toFixed(2)}" ry="${(3 + 4.5 * c.w).toFixed(2)}" opacity="${(0.15 + 0.45 * c.w).toFixed(2)}"/>`).join('')}</g>`).join('');
  el.className = `map ${[...hidden].map((h) => `hide-${h}`).join(' ')}`;
  el.innerHTML = `<img src="${src}" alt="" draggable="false" referrerpolicy="no-referrer" crossorigin="anonymous">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">${heatSvg}${routeLines.map((r) => `<path d="${path(r)}" class="route" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <div class="you" hidden></div>
    ${pins.map((p, i) => `<a class="pin layer-${p.layer}" style="left:${p.x}%;top:${p.y}%;--c:${LAYERS[p.layer]?.color ?? '#fff'};--i:${Math.min(i, 60)}" data-i="${i}" href="${p.href ?? '#'}" title="${esc(p.label)}${p.n > 1 ? ` (${p.n})` : ''}"></a>`).join('')}
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
  if (!src) cachedMapImage(first).then((u) => { if (img.isConnected) img.src = u; }).catch(() => { if (img.isConnected) img.src = first; });
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
    const moments = (p.moments || []).filter((mo) => mo.t != null).sort((a, b) => b.t - a.t);
    info.innerHTML = `<h3>${p.href && p.href !== '#' ? `<a href="${p.href}">${esc(p.label)}</a>` : esc(p.label)}</h3>
      <p class="muted small">${esc(LAYERS[p.layer]?.name ?? '')}${p.sub2 ? ` · ${esc(p.sub2)}` : ''}${p.sub ? ` · ${esc(p.sub)}` : ''} · ${coords(p.x, p.y)}${p.n > 1 && moments.length ? ` · ${p.n} times here` : ''}</p>
      ${p.quests ? `<ul class="pin-quests">${p.quests.map((q) => `<li><a href="#/quest/q${q.id}">${esc(q.name)}</a> <span class="muted small">level ${q.level}</span> ${stateChip(q.state)}</li>`).join('')}</ul>` : ''}
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
  const db = await questDB();
  d.index ??= [...buildIndex({ codex: d.codex, world: d.world, characters: d.characters }), ...(db ? searchEntries(db) : [])];
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

// Lore: the heart of it. Every storyline finished becomes a tale told in
// the third person; the ones still being lived wait on the shelf. Texts (books,
// plaques, what was said) sit behind the last tab.
pages.lore = async (kind, params) => {
  if (kind === 'tale') return talePage(params);
  const show = params.get('show') || 'tales';
  const tabs = tabsHtml([['tales', 'Tales'], ['texts', 'Texts']], show, '#/lore?show=');
  if (show === 'texts') return pages.texts(kind, params, tabs);
  const db = await questDB();
  const c = await codex();
  const { world, characters } = derived();
  if (!db) return `${pageHead('Chronicle', 'Lore', 'The quest database is not available, so no tale can be told yet.')}${tabs}`;
  const all = tales({ db, codex: c, world, characters });
  const told = all.filter((t) => t.complete);
  const living = all.filter((t) => !t.complete);
  const cover = (t, i) => `<a class="tale ${t.complete ? 'told' : 'living'}" href="#/lore/tale?id=${enc(t.id)}" style="--i:${Math.min(i, 16)}">
      <span class="tale-ribbon">${t.complete ? 'Told' : 'Being lived'}</span>
      <span class="tale-orn">✦</span>
      <b>${esc(t.title)}</b>
      <small>${esc(t.zones.join(' → '))}${t.level ? ` · level ${t.level}` : ''}</small>
      <small class="muted">${t.total > 1 ? `${t.done} of ${t.total} chapters lived` : 'a single chapter'}</small>
    </a>`;
  const pick = [...storylines(db, {}).slice(0, 400)].sort((a, b) => a.name.localeCompare(b.name));
  setTimeout(() => {
    document.getElementById('pretendSel')?.addEventListener('change', (ev) => { if (ev.target.value) location.hash = `#/lore/tale?id=${enc(ev.target.value)}&pretend=1`; });
    document.getElementById('taleVoice')?.addEventListener('change', async (ev) => {
      state.settings = { ...state.settings, taleVoice: ev.target.value === 'female' ? 'female' : 'male' };
      try { await state.store.saveSettings(state.settings); toast(`The tales now say ${ev.target.value === 'female' ? 'she' : 'he'}.`); } catch (err) { toast(err.message); }
    });
  });
  return `<div class="lore-hero">
      <div class="lore-chest">❖</div>
      <p class="kicker">Chronicle</p>
      <h1>Lore</h1>
      <p class="lore-lead">Every tale that has been lived to its end, kept here like treasure. ${told.length ? `${told.length} told` : 'None told yet'}${living.length ? ` · ${living.length} still being lived` : ''}.</p>
    </div>
    ${tabs}
    ${told.length ? `<h2 class="lore-h">Tales told</h2><div class="shelf">${told.map(cover).join('')}</div>` : ''}
    ${living.length ? `<h2 class="lore-h">Still being lived</h2><div class="shelf">${living.map(cover).join('')}</div>` : ''}
    ${!all.length ? '<p class="muted">The shelf is empty. Finish a storyline and its tale appears here.</p>' : ''}
    <p class="muted small lore-pretend">The tales follow an unnamed adventurer, told of as <select id="taleVoice"><option value="male" ${taleVoice() === 'male' ? 'selected' : ''}>him</option><option value="female" ${taleVoice() === 'female' ? 'selected' : ''}>her</option></select>. A character's own account is the Journal on its page.</p>
    <p class="muted small lore-pretend">Hear a tale as if it were already done: <select id="pretendSel"><option value="">choose a storyline…</option>${pick.map((st) => `<option value="${st.id}">${esc(st.name)} (${esc(st.startZone ?? '')})</option>`).join('')}</select> <span class="muted">or any single quest by id: <a href="#/lore/tale?id=q4402&pretend=1">Galgar's Cactus Apple Surprise</a></span></p>`;
};

// The account's own voice for the tales: the unnamed adventurer is he or she.
const taleVoice = () => (state.settings.taleVoice === 'female' ? 'female' : 'male');

async function talePage(params) {
  const db = await questDB();
  const c = await codex();
  const { world, characters } = derived();
  const id = params.get('id') || '';
  const pretend = params.get('pretend') === '1';
  if (!db) return '<p>The quest database is not available.</p>';
  let tale = tales({ db, codex: c, world, characters }).find((t) => String(t.id) === id);
  if (!tale && pretend) {
    // A tale nobody has started yet: build it from the database alone.
    const qid = /^q\d+$/.test(id) ? Number(id.slice(1)) : null;
    const st = qid ? null : storylines(db, {}).find((x) => String(x.id) === id);
    const q = qid ? db.quests.get(qid) : null;
    if (!st && !q) return `${crumb('#/lore', 'Lore')}<p>No such tale.</p>`;
    tale = st ? { id: st.id, kind: 'storyline', title: st.name, zones: st.zones, level: st.minLevel, chapters: st.quests, done: 0, total: st.total, complete: false, heroes: [] }
      : { id, kind: 'quest', title: q.n, zones: [db.zoneName(q.zone ?? q.z)].filter(Boolean), level: q.l, chapters: [{ q, state: 'ready' }], done: 0, total: 1, complete: false, heroes: [] };
  }
  if (!tale) return `${crumb('#/lore', 'Lore')}<p>No such tale.</p>`;
  const story = tellTale(tale, { db, codex: c, world, pretend: pretend || !tale.complete, defaultSex: taleVoice() });
  setTimeout(() => document.getElementById('taleDl')?.addEventListener('click', () => download(`${tale.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`, 'text/markdown', taleText(story))));
  return `${crumb('#/lore', 'Lore')}
    <article class="storybook">
      <div class="book-orn">✦ ✦ ✦</div>
      <h1>${esc(story.title)}</h1>
      ${story.dedication ? `<p class="dedication">${esc(story.dedication)}${!tale.complete ? ' · told ahead of its time' : ''}</p>` : ''}
      ${story.parts.map((part, i) => `<section class="book-part">
        ${story.parts.length > 1 ? `<h2><span class="chapter-no">${i + 1}</span>${esc(part.heading)}</h2>` : ''}
        ${part.paragraphs.map((pg, j) => `<p class="${i === 0 && j === 0 ? 'dropcap' : ''}">${esc(pg)}</p>`).join('')}
      </section>`).join('<div class="book-orn small">✦</div>')}
      ${story.ending ? `<p class="ending">${esc(story.ending)}</p>` : ''}
      <div class="book-orn">✦ ✦ ✦</div>
      <p class="row" style="justify-content:center"><a class="btn ghost" href="#/storyline/${enc(String(tale.id).replace(/^q/, ''))}">The chapters</a><button class="ghost" id="taleDl">Save the tale</button></p>
    </article>`;
};

// Texts: books, plaques, what was said aloud and in conversation ---------------

pages.texts = async (_, params, tabs = tabsHtml([['tales', 'Tales'], ['texts', 'Texts']], 'texts', '#/lore?show=')) => {
  const c = await codex();
  const { world } = derived();
  const show = params.get('kind') || 'all';
  const zone = params.get('zone') || '';
  const entries = [];
  for (const b of c.books) entries.push({ kind: 'text', title: b.title, zone: b.zone, text: b.pages.join('\n\n'), pages: b.pages, moment: firstFootage(b.moments), heard: b.moments.length });
  for (const n of world.npcs) {
    for (const l of n.lines) entries.push({ kind: l.kind === 'gossip' ? 'gossip' : 'speech', title: n.name, key: n.key, zone: n.zones[0] ?? null, text: l.text, moment: firstFootage(l.moments), heard: l.moments.length, sub: n.titles[0] });
  }
  entries.sort((a, b) => (b.moment?.t ?? 0) - (a.moment?.t ?? 0));
  const zones = [...new Set(entries.map((e) => e.zone).filter(Boolean))].sort();
  let list = show === 'all' ? entries : entries.filter((e) => e.kind === show);
  if (zone) list = list.filter((e) => e.zone === zone);
  const q = (params.get('q') || '').toLowerCase();
  if (q) list = list.filter((e) => `${e.title} ${e.text}`.toLowerCase().includes(q));
  const count = (k) => entries.filter((e) => e.kind === k).length;
  setTimeout(() => {
    const go = () => { const zs = document.getElementById('loreZone')?.value || ''; const qq = document.getElementById('loreQ')?.value || ''; location.hash = `#/lore?show=texts&kind=${show}${zs ? `&zone=${enc(zs)}` : ''}${qq ? `&q=${enc(qq)}` : ''}`; };
    document.getElementById('loreZone')?.addEventListener('change', go);
    document.getElementById('loreQ')?.addEventListener('change', go);
  });
  const KIND = { text: 'Book / plaque', gossip: 'Gossip', speech: 'Said aloud', quest: 'Quest text' };
  return `${pageHead('Chronicle', 'Lore', 'The world in its own words: books and plaques, what people said when you spoke to them, and what was shouted across the zone.')}
    ${tabs}
    <div class="row spread">
      ${tabsHtml([['all', 'Everything', entries.length], ['gossip', 'Conversations', count('gossip')], ['speech', 'Overheard', count('speech')], ['text', 'Books & plaques', count('text')]], show, '#/lore?show=texts&kind=')}
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

pages.zones = () => pages.characters();
pages.journal = () => pages.characters();
async function oldJournalPage() {
  const c = await codex();
  const db = await questDB();
  const quests = new Map(c.quests.map((q) => [q.key, q]));
  const cov = db ? coverageWho() : null;
  const dbZones = db ? allZones(db, cov.ctx) : [];
  const covByName = new Map(dbZones.map((z) => [z.name.toLowerCase(), z]));
  const visited = new Set(c.zones.map((z) => z.name.toLowerCase()));
  const unvisited = dbZones.filter((z) => !visited.has(z.name.toLowerCase()) && z.total);
  const covCell = (z) => (z ? `<div class="cov small"><div class="bar"><div style="width:${z.total ? Math.round((z.done / z.total) * 100) : 0}%"></div></div><b>${z.done}/${z.total}</b></div>` : '');
  return `${pageHead('Chronicle', 'Journal', 'Where you have been and what happened there: your zones, the maps you explored, and the loose ends in each.', db ? `<p class="muted" style="margin:0">Quest counts are for ${whoSelect(cov)}</p>` : '')}
    ${table(c.zones, [
      { label: 'Zone', value: (z) => z.name, html: (z) => `<a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` },
      { label: 'Map', value: (z) => '', html: (z) => derived().maps.filter((m) => m.zone === z.name).map((m) => `<a class="chip" href="#/map/${m.id}">map</a>`).join(' ') },
      ...(db ? [{ label: 'Every quest', value: (z) => covByName.get(z.name.toLowerCase())?.done ?? 0, html: (z) => covCell(covByName.get(z.name.toLowerCase())), num: true }] : []),
      { label: 'Quests done', value: (z) => z.quests.filter((k) => quests.get(k)?.status === 'done').length, num: true },
      { label: 'Quests logged', value: (z) => z.quests.length, num: true },
      { label: 'Kills', value: (z) => z.kills, num: true },
      { label: 'Subzones', value: (z) => z.subzones.length, num: true },
      { label: 'Loose ends', value: (z) => looseEnds(z.name, c, derived().world).total, html: (z) => { const n = looseEnds(z.name, c, derived().world).total; return n ? `<a class="chip active" href="#/zone/${enc(z.name)}#loose">${n}</a>` : '<span class="chip done">clear</span>'; }, num: true },
      { label: 'First visit', value: (z) => z.first.t, html: (z) => play(z.first) },
    ], { search: (z) => `${z.name} ${z.subzones.join(' ')}`, sort: db ? 7 : 6 })}
    ${exploredMaps()}
    ${unvisited.length ? `<h2>Not been there yet</h2>
    <p class="muted">Zones with quests ${cov.char ? esc(cov.char.name) : 'someone'} can do, from the quest database.</p>
    ${table(unvisited, [
      { label: 'Zone', value: (z) => z.name, html: (z) => `<a href="#/zone/${enc(z.name)}">${esc(z.name)}</a>` },
      { label: 'Map', value: (z) => '', html: (z) => (z.mapId ? `<a class="chip" href="#/map/${z.mapId}?show=unfound,rares">map</a>` : '') },
      { label: 'Quests', value: (z) => z.total, num: true },
      { label: 'Ready now', value: (z) => z.counts.ready ?? 0, num: true },
      { label: 'Later', value: (z) => z.counts.later ?? 0, num: true },
      { label: 'Other faction or class', value: (z) => z.counts.other ?? 0, num: true },
    ], { search: (z) => z.name, sort: 3, desc: true })}` : ''}`;
}

pages.zone = async (name) => {
  const c = await codex();
  const z = c.zones.find((x) => x.name === name);
  if (!z) return dbZonePage(name);
  const quests = z.quests.map((k) => c.quests.find((q) => q.key === k)).filter(Boolean);
  const { world, maps } = derived();
  const creatures = world.creatures.filter((k) => k.zones.includes(name));
  const people = world.people.filter((k) => k.zones.includes(name));
  const marks = c.marks.filter((m) => m.z === name);
  const zoneMaps = maps.filter((m) => m.zone === name);
  return `${crumb('#/characters', 'Characters')}
    ${pageHead('Zone', esc(name), esc(z.subzones.join(' · ')), zoneMaps.length ? `<div class="row">${zoneMaps.map((m) => `<a class="btn" href="#/map/${m.id}">Open map${zoneMaps.length > 1 ? ` ${m.id}` : ''}</a>`).join('')}<a class="btn ghost" href="#/lore?show=texts&zone=${enc(name)}">Words from here</a><a class="btn ghost" href="#/bestiary?zone=${enc(name)}">Creatures here</a></div>` : '')}
    <h2>Quests (${quests.filter((q) => q.status === 'done').length}/${quests.length} done)</h2>
    ${table(quests, [
      { label: 'Quest', value: (q) => q.title, html: (q) => `<a href="#/quest/${enc(q.key)}">${esc(q.title)}</a>` },
      { label: 'Status', value: (q) => q.status, html: (q) => `<span class="chip ${q.status}">${q.status}</span>` },
      { label: 'Accepted', value: (q) => q.accepted[0]?.t ?? 0, html: (q) => (q.accepted[0] ? play(q.accepted[0]) : '') },
      { label: 'Turned in', value: (q) => q.turnedIn[0]?.t ?? 0, html: (q) => (q.turnedIn[0] ? play(q.turnedIn[0]) : '') },
    ], { sort: 2 })}
    ${await coverageSection(name)}
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
      ${list('Rares met, not killed', le.rares.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">${n.sightings} encounter${n.sightings === 1 ? '' : 's'}</span>`))}
      ${list('Creatures met, never killed', le.creatures.filter((n) => !le.rares.includes(n)).slice(0, 40).map((n) => `${npcLink(n.key, n.name)} <span class="muted small">${levelText(n) ? `lvl ${levelText(n)} · ` : ''}${n.sightings} encounter${n.sightings === 1 ? '' : 's'}</span>`))}
      ${list('Shops passed, never opened', le.shops.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>`))}
      ${list('Trainers passed, never opened', le.trainers.map((n) => `${npcLink(n.key, n.name)} <span class="muted small">&lt;${esc(n.titles[0])}&gt;</span>`))}
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

// Stream: live overlay and drops ----------------------------------------------

const OVERLAY_WIDGETS = [['toasts', 'Drop toasts'], ['effects', 'Full-screen effects (flashes, particle storms and shakes for epic and legendary drops)'], ['tracker', 'Quest tracker'], ['counters', 'Item counters'], ['kills', 'Kills & streaks'], ['timer', 'Session timer & XP'], ['callouts', 'Callouts (levels, deaths, rares, quests)']];
const OVERLAY_POSITIONS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['ml', 'Middle left'], ['mr', 'Middle right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const DEFAULT_OVERLAY = { show: ['toasts', 'effects', 'tracker', 'counters', 'kills', 'timer', 'callouts'], scale: 1, toasts: 'br', tracker: 'tl', counters: 'tr', kills: 'bl', timer: 'bc', bg: '', theme: 'auto' };
const OVERLAY_RACES = [['Human', 'Human: royal blue and gold'], ['Dwarf', 'Dwarf: bronze and stone'], ['NightElf', 'Night Elf: moonlit violet'], ['Gnome', 'Gnome: pink and clockwork'], ['Orc', 'Orc: blood red and iron'], ['Scourge', 'Undead: plague green'], ['Tauren', 'Tauren: earth and sun'], ['Troll', 'Troll: jungle teal and bone']];
// One window per widget: the size to give the OBS browser source. The toast
// window is roomy on purpose: legendary rays and bursts reach far past the card.
const WIDGET_SIZES = { toasts: [1000, 760], effects: [1920, 1080], tracker: [420, 380], counters: [320, 340], kills: [340, 170], timer: [500, 120], callouts: [1100, 300] };
const LIVE_TESTS = {
  'loot:1': ['Common drop', { kind: 'loot', id: 2589, name: 'Linen Cloth', q: 1, n: 3, source: 'Kobold Vermin', sourceId: 6 }],
  'loot:2': ['Uncommon drop', { kind: 'loot', id: 1121, name: 'Feet of the Lynx', q: 2, n: 1, source: 'Mother Fang', sourceId: 471 }],
  'loot:3': ['Rare drop', { kind: 'loot', id: 2244, name: 'Krol Blade', q: 3, n: 1, source: 'Hogger', sourceId: 448 }],
  'loot:4': ['Epic drop', { kind: 'loot', id: 871, name: 'Flurry Axe', q: 4, n: 1, source: 'Hogger', sourceId: 448 }],
  'loot:5': ['Legendary drop', { kind: 'loot', id: 17182, name: 'Sulfuras, Hand of Ragnaros', q: 5, n: 1, source: 'Ragnaros', sourceId: 11502 }],
  quest: ['New quest', { kind: 'quest', action: 'accept', qid: 176, title: 'Wanted: "Hogger"' }],
  progress: ['Quest progress', { kind: 'quest', action: 'progress', text: 'Riverpaw Gnoll slain: 4/10' }],
  turnin: ['Quest complete', { kind: 'quest', action: 'turnin', qid: 176, title: 'Wanted: "Hogger"', xp: 250, money: 300 }],
  kill: ['Kill', { kind: 'kill', npcId: 448, name: 'Hogger' }],
  level: ['Level up', { kind: 'level', level: 12 }],
  rare: ['Rare spotted', { kind: 'rare', npcId: 471, name: 'Mother Fang', level: 10, rank: 'rareelite' }],
  death: ['Death', { kind: 'death', killer: 'Hogger', killerId: 448 }],
  zone: ['Zone change', { kind: 'zone', zone: 'Westfall', sub: 'Sentinel Hill' }],
};

function overlayConfig() {
  const c = { ...DEFAULT_OVERLAY, ...(state.settings.overlay || {}) };
  c.show = Array.isArray(c.show) ? c.show : DEFAULT_OVERLAY.show;
  return c;
}

function overlayUrl(cfg, token, { demo = false, widget = null } = {}) {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}overlay.html`;
  const p = new URLSearchParams();
  if (demo) p.set('demo', '1'); else if (token) p.set('token', token);
  if (widget) p.set('widget', widget); else p.set('show', cfg.show.join(','));
  if (Number(cfg.scale) !== 1) p.set('scale', String(cfg.scale));
  if (!widget) for (const [k] of OVERLAY_WIDGETS) if (DEFAULT_OVERLAY[k] && cfg[k] && cfg[k] !== DEFAULT_OVERLAY[k]) p.set(k, cfg[k]);
  if (/^[0-9a-f]{6}$/i.test(String(cfg.bg || '').replace('#', ''))) p.set('bg', String(cfg.bg).replace('#', '').toLowerCase());
  if (cfg.theme && cfg.theme !== 'auto') p.set('theme', cfg.theme);
  return `${base}?${p}`;
}

async function liveRow() {
  if (state.live) return state.live;
  try { return await state.store.loadLive(); } catch { return null; }
}

// A test event, shown by the overlay like a real one. From the gaming PC it
// joins the live totals; from anywhere else it is added to the cloud row.
async function liveTestEvent(ev) {
  const m = state.machine;
  if (m.liveEnabled() && m.wow.state === 'ok') { await m.liveTest(ev); return; }
  const row = await liveRow();
  const snap = row?.state ? { ...row.state } : { since: Date.now(), seq: 0, events: [], quests: [], counters: [], kills: 0, deaths: 0, character: {} };
  const seq = (snap.seq || 0) + 1;
  const at = Date.now() + (m.offset ?? 0);
  snap.events = [...(snap.events || []), { seq, at, ...ev }].slice(-40);
  snap.seq = seq;
  snap.at = at;
  const token = state.settings.liveToken || row?.token;
  if (!token) throw new Error('No overlay address yet: open Chronicler on the gaming PC once.');
  await state.store.saveLive(token, m.name, snap);
  state.live = { token, machine: m.name, state: snap, updated_at: new Date(at).toISOString() };
}

pages.live = async () => {
  const m = state.machine;
  const row = await liveRow();
  const snap = row?.state ?? null;
  const token = state.settings.liveToken || row?.token || null;
  const cfg = overlayConfig();
  const age = row?.updated_at ? Date.now() + (m.offset ?? 0) - Date.parse(row.updated_at) : null;
  const here = m.liveEnabled();
  const addon = m.wow.installs?.map((i) => i.addonVersion).filter(Boolean)[0] ?? null;
  const linkStatus = here
    ? { ok: '<span class="dot live"></span> reading the chat log', 'no-log': 'no chat log yet: log in to WoW with addon 0.4.6 or later (it turns chat logging on)', waiting: 'waiting for the WoW folder', off: 'off' }[m.live.status] ?? esc(m.live.status)
    : snap ? (age < 60000 ? `<span class="dot live"></span> ${esc(snap.machine ?? 'the gaming PC')} is feeding it` : `last heard from ${esc(snap.machine ?? 'the gaming PC')} ${esc(when(Date.parse(row.updated_at) / 1000))}`) : 'nothing yet: open Chronicler on the gaming PC while you play';
  const counters = state.settings.liveCounters || [];
  const { world } = derived();
  setTimeout(() => wireLive(cfg, token));
  return `${pageHead('Stream', 'Live overlay', 'What happens in the game, on stream as it happens: drops with icons and effects by rarity, a quest tracker, item counters, kills and streaks, deaths, levels. Add the address below to OBS as a Browser source.', `<div class="row"><span class="chip ${here && m.live.status === 'ok' || (!here && age < 60000) ? 'done' : ''}">${linkStatus}</span>${here && m.live.error ? `<span class="chip bad">${esc(m.live.error)}</span>` : ''}</div>`)}
    ${state.schema2 ? '' : schemaNotice()}
    ${here && (!addon || addon < '0.4.6') ? '<div class="notice">The live link needs addon <b>0.4.6</b> or later: <a href="#/setup">update the addon</a>, then <code>/reload</code> in game.</div>' : ''}
    <div class="two">
      <div>
        <div class="panel"><h3>This stream session</h3>
          <div class="cards" style="margin:8px 0 12px">
            ${card(snap?.kills ?? 0, 'kills', '#/drops')}${card(snap?.deaths ?? 0, 'deaths', '#/drops')}${card(snap?.drops?.reduce((n, d) => n + d.n, 0) ?? 0, 'items dropped', '#/drops?range=session')}${card(snap?.questsDone ?? 0, 'quests turned in', '#/quests')}${card(snap?.seq ?? 0, 'events', '#/live')}
          </div>
          <p class="small muted">Since ${snap?.since ? esc(when(snap.since / 1000)) : '—'}${snap?.lastEventAt ? ` · last event ${esc(when(snap.lastEventAt / 1000))}` : ''}${snap?.character?.name ? ` · ${esc(snap.character.name)} level ${snap.character.level ?? '?'}${snap.character.zone ? ` in ${esc(snap.character.zone)}` : ''}` : ''}</p>
          <div class="row">${here ? '<button data-live="reset">Start a new stream session (counters from now)</button>' : '<span class="muted small">Counters restart from the gaming PC: open this page there.</span>'}<a class="btn ghost" href="#/drops?range=session">Drops this session</a></div>
        </div>
        <div class="panel"><h3>Link check</h3>
          <p class="small muted">The chain is: addon → hidden lines in the chat log → <code>Logs\\WoWChatLog.txt</code> → this app on the gaming PC → the cloud → the overlay. In game, type <code>/chron live test</code>: a line goes down the whole chain, this page shows it below, and the overlay shows <b>LIVE LINK OK</b>. <code>/chron live</code> on its own prints the addon's side of things.</p>
          ${linkCheck(here, m, snap, row)}
        </div>
        <div class="panel"><h3>Try it</h3>
          <p class="small muted">Sends a fake event to the overlay so you can see each effect in OBS (they also count in this session's totals).</p>
          <div class="tests">${Object.entries(LIVE_TESTS).map(([k, [label, ev]]) => `<button class="ghost ${ev.kind === 'loot' ? `q${ev.q}` : ''}" data-test="${k}">${esc(label)}</button>`).join('')}</div>
        </div>
        <form id="countersForm" class="panel"><h3>Item counters</h3>
          <p class="small muted">Show how many of an item have dropped: this session, or all time across every session (plus an offset if you started counting before Chronicler).</p>
          <table class="counters-list"><tbody>
            ${counters.map((c, i) => `<tr><td>${itemLink(c.id, c.name, c.q)}</td><td><select name="mode${i}"><option value="session" ${c.mode !== 'ongoing' ? 'selected' : ''}>this session</option><option value="ongoing" ${c.mode === 'ongoing' ? 'selected' : ''}>all time</option></select></td><td><input type="number" name="add${i}" value="${Number(c.add) || 0}" title="Added to the count"></td><td class="num">${snap?.counters?.find((x) => x.id === c.id && (x.mode || 'session') === (c.mode || 'session'))?.n ?? ''}</td><td><button class="ghost small" type="button" data-remove="${i}" title="Remove">✕</button></td></tr>`).join('') || '<tr><td class="muted" colspan="5">No counters yet.</td></tr>'}
          </tbody></table>
          <div class="row" style="margin-top:8px"><input type="text" name="item" list="itemNames" placeholder="Item name or id…" style="max-width:280px"><datalist id="itemNames">${world.items.slice(0, 2000).map((i) => `<option value="${esc(i.name ?? '')}" data-id="${i.id}">${i.id}</option>`).join('')}</datalist><select name="newMode"><option value="session">this session</option><option value="ongoing">all time</option></select><button type="submit">Add</button></div>
        </form>
      </div>
      <div>
        <form id="overlayForm" class="panel"><h3>One window per widget</h3>
          <p class="small muted">Each widget as its own OBS Browser source, so you place and size them however you like. Pop out a preview to see it run on its own with demo events. Give the drop toasts their full size: the legendary rays and bursts spread far around the card. Full-screen effects is a 1920 × 1080 source to lay over the whole stream.</p>
          <table class="widget-list"><tbody>${OVERLAY_WIDGETS.map(([k, label]) => `<tr><td><b>${esc(label)}</b><br><span class="muted small">${WIDGET_SIZES[k][0]} × ${WIDGET_SIZES[k][1]}</span></td><td><button type="button" class="small" data-copy-widget="${k}" ${token ? '' : 'disabled'}>Copy address</button> <button type="button" class="ghost small" data-pop-widget="${k}">Pop out preview</button></td></tr>`).join('')}</tbody></table>
          <label class="row" style="margin-top:10px"><span>Chroma key background</span><input type="color" name="bgPick" value="${/^[0-9a-f]{6}$/i.test(String(cfg.bg || '').replace('#', '')) ? `#${String(cfg.bg).replace('#', '')}` : '#00ff00'}" style="width:48px;padding:0"><input type="text" name="bg" value="${esc(cfg.bg || '')}" placeholder="transparent (empty) or a hex like 00ff00" style="max-width:220px"></label>
          <p class="small muted">Leave it empty for a transparent background (an OBS Browser source needs nothing more). Set a hex colour when the overlay goes through a capture or a feed that cannot carry transparency, and key it out with OBS's Chroma Key filter.</p>
          <h3 style="margin-top:18px">Everything in one window</h3>
          <div class="widgets">${OVERLAY_WIDGETS.map(([k, label]) => `<label><input type="checkbox" name="show" value="${k}" ${cfg.show.includes(k) ? 'checked' : ''}><span>${esc(label)}</span>${DEFAULT_OVERLAY[k] ? `<select name="${k}">${OVERLAY_POSITIONS.map(([p, pl]) => `<option value="${p}" ${cfg[k] === p ? 'selected' : ''}>${pl}</option>`).join('')}</select>` : ''}</label>`).join('')}</div>
          <label class="row" style="margin-top:10px"><span>Colours</span><select name="theme">${[['auto', 'Follow the character (by race)'], ...OVERLAY_RACES].map(([k, l]) => `<option value="${k}" ${k === (cfg.theme || 'auto') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="small muted">Each race has its own palette: the accent, its glow and the panels change the moment a different character logs in. Pick one here to pin it instead.</p>
          <label style="margin-top:10px"><span>Size <b id="scaleOut">${Number(cfg.scale).toFixed(2)}×</b></span><input type="range" name="scale" min="0.6" max="1.8" step="0.05" value="${cfg.scale}"></label>
          <p class="overlay-url" id="overlayUrl">${token ? esc(overlayUrl(cfg, token)) : 'The address appears once Chronicler has run on the gaming PC.'}</p>
          <div class="row"><button type="button" id="copyUrl" ${token ? '' : 'disabled'}>Copy address</button><a class="btn ghost" href="${overlayUrl(cfg, token, { demo: true })}" target="_blank" rel="noopener">Open the demo</a></div>
          <p class="small muted">In OBS: <b>Sources › + › Browser</b>, paste the address, width <b>1920</b>, height <b>1080</b>, FPS <b>60</b>. Untick <i>Shutdown source when not visible</i>. Put it above the game capture. The background is transparent. Keep this address to yourself: anyone with it can watch your counters.</p>
        </form>
        <div class="panel"><h3>Preview <span class="muted small">demo events</span></h3><div class="overlay-preview" id="overlayPreview"><iframe title="Overlay preview" src="${overlayUrl(cfg, token, { demo: true })}"></iframe></div></div>
      </div>
    </div>`;
};

function linkCheck(here, m, snap, row) {
  const rows = [];
  const yes = (t) => `<span class="dot ok"></span> ${t}`;
  const no = (t) => `<span class="dot"></span> ${t}`;
  if (here) {
    const l = m.live;
    rows.push(['Chat log file', l.status === 'ok' ? yes(`found in ${esc(l.flavor ?? '')}\\Logs\\WoWChatLog.txt, ${(l.fileSize / 1024).toFixed(0)} KB${l.fileModified ? `, last written ${esc(when(l.fileModified / 1000))}` : ''}`) : l.status === 'no-log' ? no('not found yet: it appears once you log in with addon 0.4.6, which turns chat logging on') : no(esc(l.status))]);
    rows.push(['Lines read since this tab opened', `${l.lines.toLocaleString()} lines, ${l.decoded.toLocaleString()} from the addon${l.linkSeenAt ? ` · last addon line ${esc(when(l.linkSeenAt / 1000))}` : ''}`]);
    if (l.lastLine) rows.push(['Last line', `<code class="small">${esc(l.lastLine)}</code>`]);
    rows.push(['Cloud', l.error ? no(esc(l.error)) : l.lastPush ? yes(`pushed ${esc(when((l.lastPush + (m.offset ?? 0)) / 1000))}`) : no('nothing pushed yet')]);
    rows.push(['Chat log clean-up', l.purgedAt ? yes(`emptied it (${(l.purgedBytes / 1048576).toFixed(1)} MB) ${esc(when((l.purgedAt + (m.offset ?? 0)) / 1000))}`) : l.purgeError ? no(`could not empty it yet (${esc(l.purgeError)}); tries again while you are logged out`) : 'the file is emptied by this tab once it is over 1 MB and you have been logged out for 3 minutes']);
  } else {
    const l = snap?.link;
    rows.push(['Gaming PC', l ? (l.status === 'ok' ? yes(`reading ${esc(l.flavor ?? '')}\\Logs\\WoWChatLog.txt${l.fileModified ? `, last written ${esc(when(l.fileModified / 1000))}` : ''}`) : no(esc(l.status))) : no('has not reported yet')]);
    if (l?.purgedAt) rows.push(['Chat log clean-up', `emptied (${((l.purgedBytes || 0) / 1048576).toFixed(1)} MB) ${esc(when(l.purgedAt / 1000))}`]);
    if (l) rows.push(['Lines it read', `${(l.lines ?? 0).toLocaleString()} lines, ${(l.decoded ?? 0).toLocaleString()} from the addon${l.linkSeenAt ? ` · last addon line ${esc(when(l.linkSeenAt / 1000))}` : ''}`]);
    rows.push(['Last update from it', row?.updated_at ? esc(when(Date.parse(row.updated_at) / 1000)) : 'never']);
  }
  rows.push(['Test line from the game', snap?.lastTestAt ? yes(`received ${esc(when(snap.lastTestAt / 1000))}`) : no('none yet: type <code>/chron live test</code> in game')]);
  return `<div class="health">${rows.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><span>${v}</span></div>`).join('')}</div>`;
}

function wireLive(cfg, token) {
  const m = state.machine;
  const form = document.getElementById('overlayForm');
  const readForm = () => {
    const f = new FormData(form);
    const next = { ...cfg, show: f.getAll('show'), scale: Number(f.get('scale')) || 1, bg: String(f.get('bg') || '').trim().replace('#', ''), theme: String(f.get('theme') || 'auto') };
    for (const [k] of OVERLAY_WIDGETS) if (DEFAULT_OVERLAY[k]) next[k] = f.get(k) || DEFAULT_OVERLAY[k];
    return next;
  };
  const fit = () => {
    const box = document.getElementById('overlayPreview');
    const frame = box?.querySelector('iframe');
    if (!box || !frame) return;
    const s = box.clientWidth / 1920;
    frame.style.transform = `scale(${s})`;
    box.style.height = `${Math.round(1080 * s)}px`;
  };
  fit();
  new ResizeObserver(fit).observe(document.getElementById('overlayPreview'));
  let saveTimer = null;
  form?.addEventListener('input', () => {
    const next = readForm();
    document.getElementById('scaleOut').textContent = `${Number(next.scale).toFixed(2)}×`;
    document.getElementById('overlayUrl').textContent = token ? overlayUrl(next, token) : '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      state.settings = { ...state.settings, overlay: next };
      try { await state.store.saveSettings(state.settings); } catch (err) { toast(err.message); }
      const frame = document.querySelector('#overlayPreview iframe');
      if (frame) frame.src = overlayUrl(next, token, { demo: true });
    }, 400);
  });
  document.getElementById('copyUrl')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(overlayUrl(readForm(), token)); toast('Overlay address copied. Paste it into an OBS Browser source.'); } catch (err) { toast(err.message); }
  });
  for (const b of document.querySelectorAll('[data-copy-widget]')) {
    b.addEventListener('click', async () => {
      const w = b.dataset.copyWidget;
      try { await navigator.clipboard.writeText(overlayUrl(readForm(), token, { widget: w })); toast(`${OVERLAY_WIDGETS.find(([k]) => k === w)[1]} address copied. In OBS: Browser source, ${WIDGET_SIZES[w][0]} × ${WIDGET_SIZES[w][1]}.`); } catch (err) { toast(err.message); }
    });
  }
  for (const b of document.querySelectorAll('[data-pop-widget]')) {
    b.addEventListener('click', () => {
      const w = b.dataset.popWidget;
      const [width, height] = WIDGET_SIZES[w];
      window.open(overlayUrl(readForm(), token, { widget: w, demo: true }), `chronicler-${w}`, `popup=yes,width=${width},height=${height}`);
    });
  }
  form?.querySelector('[name=bgPick]')?.addEventListener('input', (ev) => { form.querySelector('[name=bg]').value = ev.target.value.replace('#', ''); form.dispatchEvent(new Event('input')); });
  for (const b of document.querySelectorAll('[data-test]')) {
    b.addEventListener('click', async () => {
      try { await liveTestEvent(LIVE_TESTS[b.dataset.test][1]); toast(`${LIVE_TESTS[b.dataset.test][0]} sent to the overlay.`); } catch (err) { toast(err.message); }
    });
  }
  document.querySelector('[data-live="reset"]')?.addEventListener('click', async () => {
    if (!window.confirm('Start a new stream session? The overlay\'s kills, drops and session counters start again from now.')) return;
    try { await m.resetLive(); toast('New stream session started.'); route({ keepScroll: true }); } catch (err) { toast(err.message); }
  });
  const cform = document.getElementById('countersForm');
  const saveCounters = async (list) => {
    state.settings = { ...state.settings, liveCounters: list };
    try { await state.store.saveSettings(state.settings); } catch (err) { toast(err.message); return; }
    if (m.liveEnabled()) m.pushLive(true).catch(() => {});
    route({ keepScroll: true });
  };
  cform?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(cform);
    const list = (state.settings.liveCounters || []).map((c, i) => ({ ...c, mode: f.get(`mode${i}`) || c.mode, add: Number(f.get(`add${i}`)) || 0 }));
    const text = String(f.get('item') || '').trim();
    if (text) {
      const { world } = derived();
      const opt = [...document.querySelectorAll('#itemNames option')].find((o) => o.value === text);
      const id = Number(opt?.dataset.id) || Number(text) || null;
      const it = id ? world.byItem.get(id) : world.items.find((i) => (i.name ?? '').toLowerCase() === text.toLowerCase());
      if (!it && !id) { toast('Pick an item from the list, or type its id.'); return; }
      list.push({ id: it?.id ?? id, name: it?.name ?? text, q: it?.quality ?? null, mode: f.get('newMode') || 'session', add: 0 });
    }
    await saveCounters(list);
  });
  for (const b of document.querySelectorAll('[data-remove]')) {
    b.addEventListener('click', async () => {
      const list = (state.settings.liveCounters || []).filter((_, i) => i !== Number(b.dataset.remove));
      await saveCounters(list);
    });
  }
}

const toLocalInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

pages.drops = async (_, params) => {
  const d = derived();
  const m = state.machine;
  const past = pastLoot(d.sessions, (s, e) => eventMs(s, e, d.clock));
  let since = null; let uploadedUntil = 0; let liveLoot = [];
  if (m.liveEnabled() && m.wow.state === 'ok') {
    since = m.live.state.since; uploadedUntil = m.live.state.uploadedUntil; liveLoot = m.live.state.loot;
  } else {
    const row = await liveRow();
    if (row?.state) { since = row.state.since; uploadedUntil = row.state.uploadedUntil || 0; liveLoot = row.state.loot || []; }
  }
  const all = [...past, ...liveLoot.filter((l) => l.at > uploadedUntil)].sort((a, b) => a.at - b.at);
  const now = Date.now() + (m.offset ?? 0);
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const lastSession = d.sessions.at(-1);
  const presets = [
    ['session', 'This stream session', since ? [since, now] : null],
    ['today', 'Today', [day.getTime(), now]],
    ['last', 'Last uploaded session', lastSession?.events.length ? [eventMs(lastSession, lastSession.events[0], d.clock), eventMs(lastSession, lastSession.events.at(-1), d.clock)] : null],
    ['all', 'Everything', [all[0]?.at ?? now - 3600000, now]],
  ];
  const range = params.get('range') || (params.get('from') ? 'custom' : since ? 'session' : 'all');
  const preset = presets.find(([k]) => k === range)?.[2];
  const from = Number(params.get('from')) || preset?.[0] || 0;
  const to = Number(params.get('to')) || preset?.[1] || now;
  const sum = dropsBetween(all, from, to);
  let kills = 0; let money = 0; let quests = 0;
  for (const s of d.sessions) {
    for (const e of s.events) {
      if (e.e !== 'kill' && e.e !== 'money' && e.e !== 'quest_turnin') continue;
      const at = eventMs(s, e, d.clock);
      if (at < from || at > to) continue;
      if (e.e === 'kill') kills++; else if (e.e === 'money' && e.delta > 0) money += e.delta; else quests++;
    }
  }
  setTimeout(() => {
    const form = document.getElementById('rangeForm');
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const a = new Date(f.get('from')).getTime(); const b = new Date(f.get('to')).getTime();
      if (!a || !b) return;
      location.hash = `#/drops?range=custom&from=${a}&to=${b}`;
    });
    document.getElementById('dropsCsv')?.addEventListener('click', () => {
      const lines = [['item_id', 'item', 'quality', 'count', 'times', 'from', 'first', 'last'], ...sum.rows.map((r) => [r.id, r.name, qualityName(r.q) ?? '', r.n, r.times, r.sources.map((x) => `${x.name} x${x.n}`).join('; '), new Date(r.first).toISOString(), new Date(r.last).toISOString()])];
      download(`drops-${toLocalInput(from).replace(/[T:]/g, '-')}.csv`, 'text/csv', lines.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
    });
  });
  return `${pageHead('Stream', 'Drops', 'Everything that dropped in a stretch of time: a stream session, a day, or any two moments you pick. Uploaded sessions and the live session are combined.', `<div class="row"><button class="ghost" id="dropsCsv">Download CSV</button></div>`)}
    <div class="row" style="margin-bottom:10px">${presets.map(([k, label, r]) => (r ? `<a class="chip ${range === k ? 'active' : ''}" href="#/drops?range=${k}">${label}</a>` : '')).join(' ')}</div>
    <form id="rangeForm" class="panel range-form">
      <label>From<input type="datetime-local" name="from" value="${toLocalInput(from)}" step="60"></label>
      <label>To<input type="datetime-local" name="to" value="${toLocalInput(to)}" step="60"></label>
      <button type="submit">Show</button>
      <span class="muted small">${esc(when(from / 1000))} → ${esc(when(to / 1000))}${liveLoot.length ? ' · live session included' : ''}</span>
    </form>
    <div class="cards">${card(sum.items, 'items dropped', '#/drops')}${card(sum.kinds, 'different items', '#/drops')}${card(sum.rows.filter((r) => (r.q ?? 0) >= 3).reduce((n, r) => n + r.n, 0), 'rare or better', '#/drops')}${card(kills, 'kills (uploaded sessions)', '#/bestiary')}${card(quests, 'quests turned in', '#/quests')}${card(Math.floor(money / 10000), 'gold looted', '#/items')}</div>
    ${table(sum.rows, [
      { label: 'Item', value: (r) => r.name ?? '', html: (r) => itemLink(r.id, r.name, r.q) },
      { label: 'Quality', value: (r) => r.q ?? -1, html: (r) => `<span class="q-${r.q ?? 1}">${esc(qualityName(r.q) ?? '')}</span>`, num: true },
      { label: 'Count', value: (r) => r.n, num: true },
      { label: 'Drops', value: (r) => r.times, num: true },
      { label: 'From', value: (r) => r.sources.map((x) => x.name).join(', '), html: (r) => r.sources.slice(0, 3).map((x) => `${esc(x.name)} <span class="muted">×${x.n}</span>`).join(', ') + (r.sources.length > 3 ? ` <span class="muted">+${r.sources.length - 3}</span>` : '') },
      { label: 'First', value: (r) => r.first, html: (r) => esc(when(r.first / 1000)) },
      { label: 'Last', value: (r) => r.last, html: (r) => esc(when(r.last / 1000)) },
    ], { search: (r) => `${r.name} ${qualityName(r.q)} ${r.sources.map((x) => x.name).join(' ')}`, sort: 1, desc: true, empty: 'Nothing dropped in this stretch.' })}`;
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
            ${r.counts.voice ? exportBtn('narration', 'Narration (.srt)') : ''}
          </div>
          ${overlayPackPanel(r)}
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
  narration: { ext: '.narration.srt', type: 'application/x-subrip' },
};

function renderExport(r, format, cats) {
  const cfg = settings();
  const list = cats ? r.timeline.filter((e) => cats.has(e.cat)) : r.timeline;
  switch (format) {
    case 'xml': return toFCPXML(r, list, cfg);
    case 'srt': return toSRT(list, cfg.cueSeconds);
    case 'csv': return toCSV(list);
    case 'chapters': return toChapters(r.timeline);
    case 'narration': return toSRT(r.timeline.filter((e) => e.cat === 'voice'), cfg.cueSeconds);
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
  document.getElementById('packBuild')?.addEventListener('click', (ev) => { ev.preventDefault(); buildOverlayPack(r).catch((err) => toast(err.message)); });
}

// Overlay pack: stills for Premiere, placed by an XML sequence -----------------

function overlayPackPanel(r) {
  const o = { drops: true, minQuality: 2, quests: true, levels: true, kills: true, killsMode: 'recording', corner: 'br', folder: '', cardSeconds: 4, ...(state.settings.overlayPack || {}) };
  const counts = { drops: r.timeline.filter((e) => e.e === 'loot' && (e.q ?? 1) >= o.minQuality).length, quests: r.counts.quest ?? 0, kills: r.timeline.filter((e) => e.e === 'kill').length, levels: r.timeline.filter((e) => e.e === 'level').length };
  return `<details class="pack" ${state.settings.overlayPack ? 'open' : ''}><summary>Overlay pack for Premiere (.zip)</summary>
    <p class="muted small">Transparent PNG stills at the video's size (item cards with icons, quest and level banners, a kill counter) plus an XML sequence that puts each one on the tracks above this recording at the right frame. Import the XML, and they are already in place.</p>
    <form id="packForm" class="pack-opts">
      <label><input type="checkbox" name="drops" ${o.drops ? 'checked' : ''}> Drops of</label>
      <select name="minQuality">${[[1, 'any quality'], [2, 'uncommon and up'], [3, 'rare and up'], [4, 'epic and up']].map(([q, l]) => `<option value="${q}" ${o.minQuality === q ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label><input type="checkbox" name="quests" ${o.quests ? 'checked' : ''}> Quest complete banners <span class="muted">${counts.quests}</span></label>
      <label><input type="checkbox" name="levels" ${o.levels ? 'checked' : ''}> Level-ups <span class="muted">${counts.levels}</span></label>
      <label><input type="checkbox" name="kills" ${o.kills ? 'checked' : ''}> Kill counter <span class="muted">${counts.kills}</span></label>
      <select name="killsMode"><option value="recording" ${o.killsMode === 'recording' ? 'selected' : ''}>counting from this recording</option><option value="lifetime" ${o.killsMode === 'lifetime' ? 'selected' : ''}>lifetime total</option></select>
      <label>Corner <select name="corner">${Object.entries(CORNERS).map(([k, l]) => `<option value="${k}" ${o.corner === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Seconds per card <input type="number" name="cardSeconds" value="${o.cardSeconds}" min="1" max="30" style="width:70px"></label>
      <label style="flex-basis:100%">Overlays folder on the editing computer <input type="text" name="folder" value="${esc(o.folder)}" placeholder="/Users/you/Movies/Chronicler overlays or C:\\Videos\\Chronicler overlays"></label>
      <button id="packBuild" class="primary">Build the pack</button>
      <span class="muted small" id="packStatus"></span>
    </form>
  </details>`;
}

async function buildOverlayPack(r) {
  const f = new FormData(document.getElementById('packForm'));
  const opts = { drops: f.get('drops') === 'on', minQuality: Number(f.get('minQuality')) || 2, quests: f.get('quests') === 'on', levels: f.get('levels') === 'on', kills: f.get('kills') === 'on', killsMode: f.get('killsMode') || 'recording', corner: f.get('corner') || 'br', folder: String(f.get('folder') || '').trim(), cardSeconds: Number(f.get('cardSeconds')) || 4 };
  state.settings = { ...state.settings, overlayPack: opts };
  state.store.saveSettings(state.settings).catch(() => {});
  const status = document.getElementById('packStatus');
  const say = (t) => { if (status) status.textContent = t; };
  const cfg = settings();
  const killsBefore = opts.killsMode === 'lifetime' ? lifetimeKillsBefore(state.sessions, r.start, (s, e) => eventMs(s, e, derived().clock)) : 0;
  const { stills, clips } = planOverlays(r.timeline, { ...opts, killsBefore, duration: r.duration });
  if (!stills.size) { say('Nothing to overlay with these options.'); return; }
  const files = [];
  let i = 0;
  for (const [file, spec] of stills) {
    i++;
    say(`Rendering ${i} of ${stills.size}: ${file}`);
    let icon = null;
    if (spec.kind === 'item') {
      const name = await iconName(spec.id);
      if (name) icon = await loadImage(iconUrl(name));
    }
    let blob = await renderStill(spec, { width: cfg.width, height: cfg.height, corner: opts.corner, icon });
    if (!blob && icon) blob = await renderStill(spec, { width: cfg.width, height: cfg.height, corner: opts.corner, icon: null });
    if (blob) files.push({ name: `overlays/${file}`, data: blob });
  }
  files.push({ name: `${stem(r.name)}.overlays.xml`, data: toOverlayXML(r, clips, { fps: cfg.fps, width: cfg.width, height: cfg.height, folder: opts.folder }) });
  files.push({ name: 'README.txt', data: packReadme(r, opts.folder, stills.size) });
  say('Zipping…');
  const zip = await makeZip(files);
  downloadBlob(`${stem(r.name)}.overlays.zip`, new Blob([zip], { type: 'application/zip' }));
  say(`Done: ${stills.size} stills, ${clips.length} placed on the timeline.`);
}

// A fresh canvas per still: one tainted by a cross-origin icon stays tainted.
async function renderStill(spec, { width, height, corner, icon }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawStill(canvas.getContext('2d'), spec, { width, height, corner, icon });
  try {
    return await new Promise((res, rej) => { try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'); } catch (err) { rej(err); } });
  } catch { return null; }
}

function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Narration: voice notes ------------------------------------------------------

pages.narration = async () => {
  const d = derived();
  const m = state.machine;
  const notes = (state.voice || []).slice().sort((a, b) => b.start_ms - a.start_ms);
  const moment = (v) => ({ session: 'voice', t: v.start_ms / 1000, footage: d.where.get(`voice|${v.start_ms / 1000}`) ?? null });
  const st = m.voice?.status ?? 'off';
  const status = m.config.plays ? (m.config.voice ? `<span class="chip ${st === 'listening' ? 'done' : st.startsWith('error') ? 'bad' : ''}">${esc(st)}</span>` : '<a class="chip" href="#/setup">turn on voice notes on this computer</a>') : '';
  return `${pageHead('Footage', 'Narration', 'What you said while playing, transcribed on the gaming PC as you spoke and lined up with the footage. Each recording exports it as captions (.srt), and it shows on the timelines.', `<div class="row">${status}</div>`)}
    ${state.schema3 === false ? schemaNotice() : ''}
    ${table(notes, [
      { label: 'When', value: (v) => v.start_ms, html: (v) => esc(when(v.start_ms / 1000)) },
      { label: 'Footage', value: (v) => moment(v).footage?.offset ?? -1, html: (v) => play(moment(v)) },
      { label: 'Said', value: (v) => v.text, html: (v) => `<span class="note-text">${esc(v.text)}</span>` },
      { label: 'Length', value: (v) => ((v.end_ms ?? v.start_ms) - v.start_ms) / 1000, html: (v) => `${(((v.end_ms ?? v.start_ms) - v.start_ms) / 1000).toFixed(1)}s`, num: true },
    ], { search: (v) => v.text, sort: 0, desc: true, empty: 'No voice notes yet. On the gaming PC: This computer › Voice notes.' })}`;
};

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
      <label class="check"><input type="checkbox" name="live" ${cfg.live !== false ? 'checked' : ''}><span>Feed the <a href="#/live">stream overlay</a> while I play (reads the game's chat log, <code>Logs\WoWChatLog.txt</code>, as it is written)</span></label>
      <button class="primary" type="submit">${cfg.fresh ? 'Save and continue' : 'Save'}</button>
      ${cfg.fresh ? '<p class="muted small">These are guesses for this computer; change them if they are wrong.</p>' : ''}
    </form>
    ${cfg.plays && !cfg.fresh ? `<div class="panel"><h3>World of Warcraft</h3>${wowBody}</div>
      <div class="panel"><h3>In game</h3><p class="small">Key bindings: Options › Keybindings › AddOns › Chronicler. Bind <b>Sync flash</b> and the marks you want. Press Sync right after starting a recording.</p>
        <p class="small">Optional commands: <code>/chron scanner on</code> logs every NPC within about 40 yards using invisible nameplates (it changes your nameplate settings; <code>/chron scanner off</code> puts them back). <code>/chron shots off</code> stops automatic screenshots. <code>/chron social on</code> also logs group, duels and chat. <code>/chron</code> lists everything.</p></div>` : ''}
    ${cfg.plays && !cfg.fresh ? `<form id="voiceForm" class="panel"><h3>Voice notes</h3>
      <p class="small">Transcribes what you say into the microphone while you play (Chrome's own speech recognition, so it needs the internet and your OK for the microphone). Notes land on the timelines, on the <a href="#/narration">Narration</a> page and in each recording's captions.</p>
      <label class="check"><input type="checkbox" name="voice" ${cfg.voice ? 'checked' : ''}><span>Transcribe my voice while this tab is open</span></label>
      <div class="grid2"><label><span>Language</span><input type="text" name="voiceLang" value="${esc(cfg.voiceLang || 'en-US')}"></label></div>
      <p class="small">Status: <b>${esc(m.voice?.status ?? 'off')}</b>${(state.voice || []).length ? ` · ${(state.voice || []).length} note${(state.voice || []).length === 1 ? '' : 's'} so far` : ''}</p>
      <button class="primary" type="submit">Save</button></form>` : ''}
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
    ${addonErrorsPanel()}
    <div class="panel"><h3>Account</h3><p class="small">Logged in as <b>${esc(state.user.email)}</b>. Clock: ${m.offset == null ? 'measuring…' : `${(m.offset / 1000).toFixed(3)}s from the server (±${Math.round((m.rtt ?? 0) / 2)} ms)`}.</p><button data-act="logout">Log out</button></div>
    <div class="panel danger"><h3>Start over</h3>
      <p class="small">Deletes every session, recording, item, route, screenshot, clock sample and deleted-mark record from your account, on both computers. Your own map images are kept. Sessions and recordings from before now will not come back even if the addon still has them; afterwards, type <code>/chron clear confirm</code> in game to empty the addon's log too.</p>
      <div class="row"><input type="text" id="wipeWord" placeholder="type DELETE" autocomplete="off"><button class="danger-btn" id="wipe" disabled>Delete everything and start over</button></div>
    </div>`;
};

// Lua errors the addon caught, with a dump to paste into a bug report.
function addonErrorsPanel() {
  const list = state.settings.addonErrors || [];
  const total = list.reduce((n, e) => n + (e.n || 1), 0);
  return `<div class="panel" id="errors"><h3>Addon errors ${total ? `<span class="chip bad">${total}</span>` : '<span class="chip done">none</span>'}</h3>
    <p class="small muted">Every Lua error the addon catches in game (its own and other addons') is kept with its stack and where you were. Copy the dump and paste it to whoever is fixing the addon. In game, <code>/chron errors</code> shows them too.</p>
    ${list.length ? `<div class="row"><button id="copyErrors">Copy error dump</button><button class="ghost" id="clearErrors">Clear</button></div>
    <table><thead><tr><th>Times</th><th>Error</th><th>While</th><th>Last</th></tr></thead><tbody>${list.slice(0, 20).map((e) => `<tr><td class="num">${e.n || 1}</td><td><code style="white-space:pre-wrap">${esc(String(e.msg).slice(0, 220))}</code></td><td class="muted small">${esc(e.ctx ?? '')}${e.zone ? ` · ${esc(e.zone)}` : ''}</td><td class="muted small">${e.last ? esc(when(e.last)) : ''}</td></tr>`).join('')}</tbody></table>${list.length > 20 ? `<p class="muted small">and ${list.length - 20} more in the dump.</p>` : ''}` : ''}
  </div>`;
}

function errorDump() {
  const list = state.settings.addonErrors || [];
  const m = state.machine;
  const last = state.sessions.at(-1);
  const head = [
    `Chronicler addon error dump — ${new Date().toISOString()}`,
    `Site: ${location.host} · this computer: ${m?.name ?? '?'} · addon installed: ${m?.wow?.installs?.map((i) => `${i.flavor} ${i.addonVersion ?? '?'}`).join(', ') || 'unknown here'}`,
    last ? `Last session: ${last.id} · ${last.char?.name ?? '?'} ${last.char?.class ?? ''} level ${last.char?.level ?? '?'} · build ${last.build?.version ?? '?'} (${last.build?.interface ?? '?'}) · ${last.flavor ?? ''}` : 'No sessions uploaded yet.',
    `${list.length} distinct error${list.length === 1 ? '' : 's'}, ${list.reduce((n, e) => n + (e.n || 1), 0)} in total.`,
    '',
  ];
  const body = list.map((e, i) => [
    `${i + 1}. [${e.n || 1}×] ${e.first ? new Date(e.first * 1000).toISOString() : '?'} → ${e.last ? new Date(e.last * 1000).toISOString() : '?'}  addon ${e.version ?? '?'} build ${e.build ?? '?'}  while: ${e.ctx ?? '?'}  at: ${[e.zone, e.sub].filter(Boolean).join(': ') || '?'}${e.level ? ` level ${e.level}` : ''}${e.session ? `  session ${e.session}` : ''}`,
    `   ${String(e.msg).replace(/\n/g, '\n   ')}`,
    e.stack ? `   stack:\n   ${String(e.stack).replace(/\n/g, '\n   ')}` : '   (no stack)',
    '',
  ].join('\n'));
  return [...head, ...body].join('\n');
}

function wireSetup() {
  const m = state.machine;
  document.getElementById('copyErrors')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(errorDump()); toast('Error dump copied. Paste it into your message.'); } catch { download('chronicler-errors.txt', 'text/plain', errorDump()); }
  });
  document.getElementById('clearErrors')?.addEventListener('click', async () => {
    if (!window.confirm('Clear the collected addon errors here? The addon keeps its own list until /chron errors clear.')) return;
    state.settings = { ...state.settings, addonErrors: [] };
    try { await state.store.saveSettings(state.settings); } catch (err) { toast(err.message); }
    route({ keepScroll: true });
  });
  document.getElementById('voiceForm')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const on = f.get('voice') === 'on';
    m.saveConfig({ voice: on, voiceLang: String(f.get('voiceLang') || 'en-US').trim() || 'en-US' });
    toast(on ? 'Voice notes on. Chrome will ask for the microphone.' : 'Voice notes off.');
    route({ keepScroll: true });
  });
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
    m.saveConfig({ name: String(f.get('name')).trim() || m.config.name, plays: f.get('plays') === 'on', records: f.get('records') === 'on', live: f.get('live') === 'on' });
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

// Where emailed links come back to. Supabase allows the project's Site URL
// exactly as typed, so the bare address, with no trailing slash, is safest.
function siteAddress() {
  return location.pathname === '/' ? location.origin : location.origin + location.pathname.replace(/\/$/, '');
}

function renderLogin(message = '') {
  document.getElementById('nav').hidden = true;
  main.innerHTML = `<div class="login"><div class="panel glow">
    <div class="brand" style="font-size:2rem;margin-bottom:6px"><span class="brand-mark"></span>Chronicler</div>
    <p class="muted">Log in with the same account on your gaming PC and your recording computer. Use the same email address as your Supabase account: Supabase's built-in mailer only sends to addresses on your Supabase team. Emailed links only come back to this site once its address is the project's Site URL (Supabase › Authentication › URL Configuration).</p>
    ${message ? `<div class="notice">${message}</div>` : ''}
    <form id="login">
      <label><span>Email</span><input type="email" name="email" required autocomplete="username" style="width:100%"></label>
      <label><span>Password</span><input type="password" name="password" minlength="6" autocomplete="current-password" style="width:100%"></label>
      <div class="row"><button class="primary" type="submit" name="mode" value="in">Log in</button><button type="submit" name="mode" value="up">Create account</button></div>
      <p class="muted small" style="margin:14px 0 6px">Or skip the password:</p>
      <div class="row"><button type="submit" name="mode" value="magic" formnovalidate>Email me a sign-in link</button></div>
    </form></div></div>`;
  document.getElementById('login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const creds = { email: String(f.get('email') || '').trim(), password: f.get('password') };
    const auth = state.client.auth;
    const mode = ev.submitter?.value;
    if (mode === 'magic') {
      if (!creds.email) return renderLogin('Enter your email first.');
      const { error: err } = await auth.signInWithOtp({ email: creds.email, options: { emailRedirectTo: siteAddress() } });
      if (err) return renderLogin(esc(err.message));
      return renderLogin(`A sign-in link is on its way to <b>${esc(creds.email)}</b> (from Supabase Auth; check spam too). Open it on this computer and you are in. It works once and expires after an hour.`);
    }
    if (!creds.password) return renderLogin('Enter your password, or ask for a sign-in link.');
    const { data, error } = mode === 'up'
      ? await auth.signUp({ ...creds, options: { emailRedirectTo: siteAddress() } })
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
// Data notes: the text the addon read in game against the database. The
// first-hand version is what the wiki shows; a difference is kept as a
// note (quest titles and objectives, NPC names by id) for later.
const squash = (t) => String(t ?? '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d"']/g, '').replace(/\s+/g, ' ').trim();
function dataNotes() {
  const d = derived();
  if (d.notes) return d.notes;
  const db = state.db;
  const notes = [];
  if (db) {
    for (const q of d.codex.quests) {
      const dq = q.qid ? db.quests.get(q.qid) : null;
      if (!dq) continue;
      if (q.title && squash(q.title) !== squash(dq.n)) notes.push({ kind: 'quest', field: 'title', key: q.key, name: q.title, ours: q.title, theirs: dq.n });
      if (q.objectives && dq.o && !/\d+\s*\/\s*\d+/.test(q.objectives) && squash(q.objectives) !== squash(dq.o)) notes.push({ kind: 'quest', field: 'objectives', key: q.key, name: q.title, ours: q.objectives, theirs: dq.o });
    }
    for (const n of d.world.npcs) {
      if (!n.name || n.object) continue;
      for (const id of n.ids || (n.npcId ? [n.npcId] : [])) {
        const dn = db.npc(id);
        if (dn && squash(dn.n) !== squash(n.name)) notes.push({ kind: 'npc', field: 'name', key: n.key, name: n.name, ours: n.name, theirs: dn.n });
      }
    }
  }
  d.notes = notes;
  // Say so once when new differences turn up.
  try {
    const seen = Number(localStorage.getItem('chronicler.notes.seen') || 0);
    if (notes.length > seen) { toast(`${notes.length - seen} new place${notes.length - seen === 1 ? '' : 's'} where the game's text differs from the database. See Quests › Notes.`); localStorage.setItem('chronicler.notes.seen', String(notes.length)); }
  } catch { /* storage off */ }
  return notes;
}
const noteFor = (kind, key) => dataNotes().filter((n) => n.kind === kind && n.key === key);
const firstHandChip = (kind, key) => (noteFor(kind, key).length ? ' <span class="chip firsthand" title="What the game showed differs from the database; the first-hand version is used">first-hand</span>' : '');

// Which pages show which topics. Everything else redraws only when the
// recorded data changes, so a kill on the live link never rebuilds a map.
const PAGE_TOPICS = { '': ['data', 'voice'], live: ['data', 'live', 'wow'], drops: ['data', 'live'], setup: ['data', 'live', 'wow', 'obs', 'voice', 'clock'], narration: ['data', 'voice'], sessions: ['data', 'wow'] };
function changed(topic = 'all') {
  if (topic !== 'live' && topic !== 'obs' && topic !== 'clock') invalidate();
  renderStatus();
  // Redraw the current page with new data, except where it would interrupt:
  // the video player, or a form being typed in.
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    const page = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
    if (page === 'recording') return;
    if (topic !== 'all' && !(PAGE_TOPICS[page] ?? ['data']).includes(topic)) return;
    if (document.activeElement?.matches('input, textarea, select')) return;
    route({ keepScroll: true });
  }, 400);
}

// The World's percentages in the sidebar: what this account has done
// against everything in Classic. Cached with the rest until data changes.
async function navPercents() {
  const spans = [...document.querySelectorAll('#nav .pct')];
  if (!spans.length || !state.machine) return;
  const d = derived();
  if (!d.navPct) {
    const db = await questDB();
    if (!db) return;
    const itemdb = await itemTable().catch(() => null);
    const cov = coverageWho();
    const tree = completionTree(db, cov.ctx);
    const zonesAll = Object.values(db.zones).filter((z) => !z.kind && !z.p && z.c);
    const visited = new Set(d.codex.zones.map((z) => z.name.toLowerCase()));
    const story = storylines(db, cov.ctx);
    const totals = npcTotals(db);
    d.navPct = {
      locations: pctOf(zonesAll.filter((z) => visited.has(String(z.n).toLowerCase())).length, zonesAll.length),
      quests: pctOf(tree.done, tree.total),
      storylines: pctOf(story.reduce((n, s) => n + s.done, 0), story.reduce((n, s) => n + s.total, 0)),
      bestiary: pctOf(d.world.creatures.filter((n) => n.kills > 0).length, totals.creatures),
      people: pctOf(d.world.people.filter((n) => n.met).length, totals.people),
      items: itemdb ? pctOf(d.world.items.filter((i) => i.obtained).length, itemdb.size) : null,
    };
  }
  for (const el of spans) {
    const v = d.navPct[el.dataset.pct];
    const text = v == null ? '' : `${v}%`;
    if (el.textContent === text) continue;
    const had = el.textContent !== '';
    el.textContent = text;
    if (had) { el.classList.remove('shine'); void el.offsetWidth; el.classList.add('shine'); }
  }
}

async function route({ keepScroll = false } = {}) {
  if (!state.machine) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = hash.split('?');
  const [page, ...rest] = pathPart.split('/');
  const params = new URLSearchParams(query);
  for (const a of document.querySelectorAll('#nav a')) {
    const target = a.getAttribute('href').slice(2);
    let alias = { item: 'items', character: 'characters', quest: 'quests', zone: 'characters', zones: 'characters', journal: 'characters', texts: 'lore', recording: 'recordings', session: 'sessions', map: 'locations', texts: 'lore', vendors: 'people', creatures: 'bestiary', npcs: 'people', creature: 'bestiary', storyline: 'storylines' }[page] ?? page;
    if (page === 'npc') {
      const n = state.cache?.world?.byNpc.get(rest.map(decodeURIComponent).join('/'));
      alias = n?.attackable ? 'bestiary' : n?.object ? 'items' : 'people';
    }
    a.classList.toggle('active', target.split('?')[0] === alias);
  }
  const render = state.machine.config.fresh && page !== 'setup' ? pages.setup : pages[page] ?? pages[''];
  const y = window.scrollY;
  // A refresh (new data, same page) must be seamless: remember the numbers on
  // screen so only the ones that changed get a shine.
  const before = keepScroll ? statSnapshot(main) : null;
  // The same page with other parameters (a tab, a filter): only what
  // changed gets to animate; the head and everything else stays still.
  const same = !keepScroll && state.lastRoute === pathPart;
  state.lastRoute = pathPart;
  state.lastHref = location.href;
  if (keepScroll) main.classList.remove('enter');
  let html;
  try {
    html = await render(rest.map(decodeURIComponent).join('/'), params);
  } catch (err) {
    html = `<div class="notice error">${esc(err.message)}</div>`;
    console.error(err);
  }
  const was = same ? state.lastHtml || [] : null;
  main.innerHTML = html;
  state.lastHtml = [...main.children].map((c) => c.outerHTML);
  navPercents().catch((err) => console.warn('percentages', err));
  if (!keepScroll) {
    // Navigation: children rise in one after another; numbers count up.
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
    let i = 0;
    for (const child of main.children) {
      const still = same && was.includes(child.outerHTML);
      child.classList.toggle('still', still);
      if (still) continue;
      child.style.setProperty('--i', Math.min(i++, 12));
      animateNumbers(child);
    }
  } else {
    shineChanged(main, before);
  }
  moveNavGlow();
  window.scrollTo(0, keepScroll || same ? y : 0);
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
    items: all.items, screenshots: all.screenshots, schema2: all.schema2, voice: all.voice ?? [], schema3: all.schema3,
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
    // Back from a sign-in or confirmation link: its tokens (or its error) sit in the address.
    const linkError = /^#error=/.test(location.hash) ? new URLSearchParams(location.hash.slice(1)) : null;
    const { data } = await state.client.auth.getSession();
    if (/^#(access_token|error)=/.test(location.hash)) history.replaceState(null, '', `${location.pathname}#/`);
    if (!data.session) {
      return renderLogin(linkError ? `The link did not work: <b>${esc(linkError.get('error_description') || linkError.get('error') || 'unknown error')}</b>. Links work once and expire after an hour, and some mail apps open them themselves for a preview, which uses them up. Ask for a new one and open it in this browser, or log in with your password.` : '');
    }
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
// A hash change fires both events; the page is drawn once per address.
const onNav = () => { if (location.href !== state.lastHref) route(); };
window.addEventListener('hashchange', () => { document.getElementById('side')?.classList.remove('open'); onNav(); });
window.addEventListener('popstate', onNav);
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
