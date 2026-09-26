// Turns the addon's SavedVariables file into clean session objects.

import { parseSavedVariables } from './luasv.js';

export const EXPANSIONS = [
  { key: 'classic', name: 'Classic', below: 20000 },
  { key: 'tbc', name: 'The Burning Crusade', below: 30000 },
  { key: 'wrath', name: 'Wrath of the Lich King', below: 40000 },
  { key: 'cata', name: 'Cataclysm', below: 50000 },
  { key: 'mop', name: 'Mists of Pandaria', below: 60000 },
  { key: 'wod', name: 'Warlords of Draenor', below: 70000 },
  { key: 'legion', name: 'Legion', below: 80000 },
  { key: 'bfa', name: 'Battle for Azeroth', below: 90000 },
  { key: 'sl', name: 'Shadowlands', below: 100000 },
  { key: 'df', name: 'Dragonflight', below: 110000 },
  { key: 'tww', name: 'The War Within', below: 120000 },
  { key: 'midnight', name: 'Midnight', below: 130000 },
];

// The client's interface number says which game it is (retail can still
// play old zones), so this is only a sensible default grouping.
export function expansionOf(iface) {
  const n = Number(iface);
  if (!Number.isFinite(n) || n <= 0) return null;
  const hit = EXPANSIONS.find((x) => n < x.below);
  return hit ? hit.key : 'retail';
}

// Every session in a Chronicler.lua SavedVariables file.
export function sessionsFromSavedVariables(text, opts) {
  return readAddonLog(text, opts).sessions;
}

// Sessions plus the item catalog: { sessions, items: [{ item_id, data }] }.
export function readAddonLog(text, { flavor = null, account = null } = {}) {
  const db = parseSavedVariables(text).ChroniclerDB;
  if (!db) return { sessions: [], items: [], errors: [] };
  const sessions = Object.values(db.sessions || {}).map((raw) => normalizeSession(raw, { flavor, account })).filter(Boolean);
  const items = Object.values(db.items || {})
    .filter((i) => i && Number.isFinite(i.id))
    .map((i) => ({ item_id: i.id, data: normalizeItem(i) }));
  const errors = Object.values(db.errors || {}).filter((e) => e && e.msg).map((e) => ({ ...e, key: e.key ?? String(e.msg).slice(0, 200), n: e.n || 1 }));
  return { sessions, items, errors };
}

// Tooltip lines are "left", "left\tright", optionally followed by "|rrggbb".
export function tooltipLine(line) {
  const m = /^(.*?)(?:\|([0-9a-f]{6}))?$/.exec(String(line));
  const [left, right] = m[1].split('\t');
  return { left, right: right ?? null, color: m[2] ?? null };
}

function normalizeItem(i) {
  const out = { ...i };
  for (const key of ['tip']) {
    if (out[key] && !Array.isArray(out[key])) out[key] = Object.values(out[key]);
  }
  delete out.scanned;
  return out;
}

export function normalizeSession(raw, { flavor, account } = {}) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const events = Object.values(raw.events || {})
    .filter((e) => e && typeof e === 'object' && e.e && Number.isFinite(e.t))
    .map(normalizeEvent)
    .sort((a, b) => a.t - b.t);
  return {
    id: String(raw.id),
    started: raw.started || (events[0] ? Math.floor(events[0].t) : 0),
    char: raw.char || {},
    build: raw.build || {},
    expansion: expansionOf(raw.build?.interface),
    flavor: flavor || null,
    account: account || null,
    events,
    track: Array.isArray(raw.track) ? raw.track : Object.values(raw.track || {}),
  };
}

function normalizeEvent(e) {
  const out = { ...e };
  // Lists come back as objects when they had gaps; turn them into arrays.
  for (const key of ['pages', 'options', 'items', 'sources', 'costs', 'services', 'nodes', 'enemies', 'spells', 'slots', 'tabs', 'talents', 'factions', 'skills', 'members', 'rewards', 'choices']) {
    if (out[key] && !Array.isArray(out[key])) out[key] = Object.values(out[key]);
  }
  return out;
}

// Adds events from `incoming` that `existing` does not have yet. WoW writes
// table keys in no particular order, so events are compared by content with
// keys sorted. Returns null when nothing is new.
export function mergeSession(existing, incoming) {
  if (!existing) return incoming;
  const seen = new Set(existing.events.map(eventKey));
  const fresh = incoming.events.filter((e) => !seen.has(eventKey(e)));
  if (!fresh.length) return null;
  return { ...existing, ...incoming, events: [...existing.events, ...fresh].sort((a, b) => a.t - b.t) };
}

function eventKey(e) {
  return JSON.stringify(e, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}
