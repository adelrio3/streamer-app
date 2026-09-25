// Everything the companion keeps lives in one data folder:
//
//   data/config.json          settings from the Setup page
//   data/sessions/<id>.json   one file per play session ingested from the addon
//   data/obs-recordings.json  exact start/stop times reported by OBS
//   data/recording-overrides.json  sync-flash corrections per recording
//   data/exports/...          files written by "Export all"

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  // WoW install folders. Either a flavor folder such as
  // "C:\\Program Files (x86)\\World of Warcraft\\_classic_era_" or the root
  // "World of Warcraft" folder (every flavor inside it is scanned).
  wowPaths: [],
  // Where OBS saves recordings.
  recordingsDir: '',
  // OBS "Filename Formatting" setting, used to read each file's start time.
  filenamePattern: '%CCYY-%MM-%DD %hh-%mm-%ss',
  // Recording frame rate and size, for Premiere marker timing.
  fps: 60,
  width: 1920,
  height: 1080,
  // Seconds added to every game timestamp before matching it to video. Leave
  // at 0 unless markers land consistently early or late.
  clockOffset: 0,
  // Seconds each subtitle cue stays on screen in the .srt export.
  cueSeconds: 3,
  obs: { enabled: false, host: '127.0.0.1', port: 4455, password: '' },
};

export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.sessionsDir = path.join(this.dir, 'sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.version = 0;
    this._sessions = null;
  }

  file(name) { return path.join(this.dir, name); }

  readJSON(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  writeJSON(name, value) {
    writeAtomic(this.file(name), JSON.stringify(value, null, 2));
  }

  config() {
    const saved = this.readJSON('config.json', {});
    return { ...DEFAULT_CONFIG, ...saved, obs: { ...DEFAULT_CONFIG.obs, ...(saved.obs || {}) } };
  }

  saveConfig(patch) {
    const current = this.config();
    const next = { ...current, ...patch, obs: { ...current.obs, ...(patch.obs || {}) } };
    if (typeof next.wowPaths === 'string') next.wowPaths = next.wowPaths.split(/\r?\n/);
    next.wowPaths = (next.wowPaths || []).map((p) => String(p).trim()).filter(Boolean);
    for (const key of ['fps', 'width', 'height', 'clockOffset', 'cueSeconds']) {
      const n = Number(next[key]);
      next[key] = Number.isFinite(n) ? n : DEFAULT_CONFIG[key];
    }
    next.obs.port = Number(next.obs.port) || DEFAULT_CONFIG.obs.port;
    next.obs.enabled = Boolean(next.obs.enabled);
    this.writeJSON('config.json', next);
    this.version++;
    return next;
  }

  sessions() {
    if (!this._sessions) {
      this._sessions = [];
      for (const name of fs.readdirSync(this.sessionsDir)) {
        if (!name.endsWith('.json')) continue;
        this._sessions.push(JSON.parse(fs.readFileSync(path.join(this.sessionsDir, name), 'utf8')));
      }
      this._sessions.sort((a, b) => a.started - b.started);
    }
    return this._sessions;
  }

  session(id) {
    return this.sessions().find((s) => s.id === id) || null;
  }

  // Saves a session, merging with any stored copy so events are never lost
  // when the addon's copy is shorter. Returns "added", "updated" or
  // "unchanged".
  putSession(session) {
    const existing = this.session(session.id);
    if (existing) {
      const seen = new Set(existing.events.map(eventKey));
      const fresh = session.events.filter((e) => !seen.has(eventKey(e)));
      if (fresh.length === 0) return 'unchanged';
      session = { ...existing, ...session, events: [...existing.events, ...fresh].sort((a, b) => a.t - b.t) };
    }
    writeAtomic(path.join(this.sessionsDir, safeName(session.id) + '.json'), JSON.stringify(session));
    this._sessions = null;
    this.version++;
    return existing ? 'updated' : 'added';
  }

  // Per-recording corrections keyed by lowercase file name: { start, duration,
  // syncT, videoTime }.
  overrides() { return this.readJSON('recording-overrides.json', {}); }

  setOverride(fileName, patch) {
    const all = this.overrides();
    const key = fileName.toLowerCase();
    const next = { ...(all[key] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    if (Object.keys(next).length) all[key] = next; else delete all[key];
    this.writeJSON('recording-overrides.json', all);
    this.version++;
    return next;
  }

  obsRecordings() { return this.readJSON('obs-recordings.json', []); }

  saveObsRecordings(list) {
    this.writeJSON('obs-recordings.json', list);
    this.version++;
  }
}

// WoW writes table keys in no particular order, so compare events by their
// content with keys sorted.
function eventKey(e) {
  return JSON.stringify(e, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}

export function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180);
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
