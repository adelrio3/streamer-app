// Finds the addon's SavedVariables files and copies every session in them
// into the companion's own store.

import fs from 'node:fs';
import path from 'node:path';
import { parseSavedVariables } from './luasv.js';

const FLAVOR_DIRS = ['_classic_era_', '_anniversary_', '_classic_', '_retail_', '_ptr_', '_classic_era_ptr_', '_classic_ptr_', '_beta_'];

// Every Chronicler.lua under WTF/Account/<account>/SavedVariables for each
// configured path. A path may be a flavor folder, the WoW root, or the file.
export function findSavedVariables(wowPaths) {
  const found = [];
  const seen = new Set();
  const add = (file, flavor) => {
    const key = path.resolve(file);
    if (seen.has(key) || !isFile(key)) return;
    seen.add(key);
    found.push({ file: key, flavor, mtime: fs.statSync(key).mtimeMs });
  };
  for (const raw of wowPaths || []) {
    const p = path.resolve(raw);
    if (p.toLowerCase().endsWith('.lua')) {
      add(p, flavorOf(p));
      continue;
    }
    const roots = isDir(path.join(p, 'WTF'))
      ? [p]
      : FLAVOR_DIRS.map((d) => path.join(p, d)).filter((d) => isDir(path.join(d, 'WTF')));
    for (const root of roots) {
      const accounts = path.join(root, 'WTF', 'Account');
      for (const account of listDir(accounts)) {
        add(path.join(accounts, account, 'SavedVariables', 'Chronicler.lua'), flavorOf(root));
      }
    }
  }
  return found;
}

export function ingestFile(store, file, flavor = flavorOf(file)) {
  const parsed = parseSavedVariables(fs.readFileSync(file, 'utf8'));
  const db = parsed.ChroniclerDB;
  const result = { file, added: 0, updated: 0, unchanged: 0, sessions: 0, events: 0 };
  if (!db || !db.sessions) return result;
  const account = accountOf(file);
  for (const raw of Object.values(db.sessions)) {
    const session = normalizeSession(raw, { flavor, account });
    if (!session) continue;
    result.sessions++;
    result.events += session.events.length;
    result[store.putSession(session)]++;
  }
  return result;
}

export function ingestAll(store, wowPaths) {
  const files = findSavedVariables(wowPaths);
  const results = [];
  for (const { file, flavor } of files) {
    try {
      results.push(ingestFile(store, file, flavor));
    } catch (err) {
      results.push({ file, error: err.message });
    }
  }
  return { at: Date.now(), files: results };
}

export function normalizeSession(raw, { flavor, account } = {}) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const events = Object.values(raw.events || {})
    .filter((e) => e && typeof e === 'object' && e.e && Number.isFinite(e.t))
    .map((e) => normalizeEvent(e))
    .sort((a, b) => a.t - b.t);
  return {
    id: String(raw.id),
    schema: raw.schema || 1,
    started: raw.started || (events[0] ? Math.floor(events[0].t) : 0),
    char: raw.char || {},
    build: raw.build || {},
    expansion: expansionOf(raw.build?.interface),
    flavor: flavor || null,
    account: account || null,
    events,
  };
}

function normalizeEvent(e) {
  const out = { ...e };
  // Lists come back as objects when they had gaps; turn them into arrays.
  for (const key of ['pages', 'options']) {
    if (out[key] && !Array.isArray(out[key])) out[key] = Object.values(out[key]);
  }
  return out;
}

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

// The client's interface number says which game it is, not which expansion's
// content you are playing (retail can play old zones), so this is only a
// sensible default grouping.
export function expansionOf(iface) {
  const n = Number(iface);
  if (!Number.isFinite(n) || n <= 0) return null;
  const hit = EXPANSIONS.find((x) => n < x.below);
  return hit ? hit.key : 'retail';
}

function flavorOf(p) {
  const parts = path.resolve(p).split(path.sep);
  return parts.find((part) => /^_[a-z_]+_$/.test(part)) || null;
}

function accountOf(file) {
  const parts = path.resolve(file).split(path.sep);
  const i = parts.lastIndexOf('Account');
  return i >= 0 ? parts[i + 1] : null;
}

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listDir(p) { try { return fs.readdirSync(p); } catch { return []; } }
