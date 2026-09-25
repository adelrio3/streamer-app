// The companion's state and HTTP API. server.js wires this to a port.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, safeName } from './store.js';
import { findSavedVariables, ingestAll, EXPANSIONS } from './ingest.js';
import { scanRecordings } from './recordings.js';
import { buildCodex } from './codex.js';
import { describe, category } from './describe.js';
import { buildTimelines, toSRT, toCSV, toChapters, toKillsCSV, toFCPXML, lifetimeKillsBefore } from './exports.js';
import { ObsLink } from './obs.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.flv': 'video/x-flv', '.ts': 'video/mp2t',
};
const EXPORTS = {
  xml: { ext: '.xml', type: 'application/xml' },
  srt: { ext: '.srt', type: 'application/x-subrip' },
  csv: { ext: '.events.csv', type: 'text/csv' },
  chapters: { ext: '.chapters.txt', type: 'text/plain' },
  kills: { ext: '.kills.csv', type: 'text/csv' },
};

export class App {
  constructor({ dataDir, WebSocketImpl } = {}) {
    this.store = new Store(dataDir);
    this.lastIngest = null;
    this.watched = new Map();
    this.cache = { key: null };
    this.obs = new ObsLink(this.store, () => this.store.config().obs, { WebSocketImpl });
  }

  start() {
    this.obs.start();
    this.ingest();
    this.watch();
    this.rescanTimer = setInterval(() => this.watch(), 60000);
    this.rescanTimer.unref?.();
  }

  stop() {
    this.obs.stop();
    clearInterval(this.rescanTimer);
    for (const file of this.watched.keys()) fs.unwatchFile(file);
    this.watched.clear();
  }

  // WoW rewrites the SavedVariables file on logout and /reload; ingest when it
  // changes. Polling is used because fs.watch is unreliable across platforms.
  watch() {
    const files = findSavedVariables(this.store.config().wowPaths).map((f) => f.file);
    for (const file of files) {
      if (this.watched.has(file)) continue;
      const listener = (cur, prev) => {
        if (cur.mtimeMs !== prev.mtimeMs) setTimeout(() => this.ingest(), 1500);
      };
      fs.watchFile(file, { interval: 3000 }, listener);
      this.watched.set(file, listener);
    }
  }

  ingest() {
    this.lastIngest = ingestAll(this.store, this.store.config().wowPaths);
    return this.lastIngest;
  }

  // Recordings, timelines and codex are rebuilt only when data or the
  // recordings folder changes.
  derived() {
    const cfg = this.store.config();
    const recordings = scanRecordings(cfg.recordingsDir, { pattern: cfg.filenamePattern, obsLog: this.store.obsRecordings(), overrides: this.store.overrides() });
    const key = `${this.store.version}|${cfg.clockOffset}|${recordings.map((r) => `${r.id}:${r.start}:${r.end}`).join(',')}`;
    if (this.cache.key !== key) {
      const sessions = this.store.sessions();
      const timelines = buildTimelines(sessions, recordings, cfg.clockOffset);
      const where = new Map();
      for (const [recId, events] of timelines) {
        for (const e of events) where.set(`${e.session}|${e.t}`, { rec: recId, offset: e.offset });
      }
      const resolve = (sessionId, t) => where.get(`${sessionId}|${t}`) ?? null;
      this.cache = { key, recordings, timelines, where, codex: buildCodex(sessions, resolve) };
    }
    return { cfg, ...this.cache };
  }

  status() {
    const cfg = this.store.config();
    const { recordings } = this.derived();
    const sessions = this.store.sessions();
    return {
      config: cfg,
      savedVariables: findSavedVariables(cfg.wowPaths),
      lastIngest: this.lastIngest,
      sessions: sessions.length,
      events: sessions.reduce((n, s) => n + s.events.length, 0),
      recordings: recordings.length,
      obs: this.obs.status(),
      expansions: EXPANSIONS,
      latestExpansion: sessions.at(-1)?.expansion ?? null,
    };
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === 'api') return await this.api(req, res, parts.slice(1), url);
      if (parts[0] === 'media' && parts[1]) return this.media(req, res, parts[1]);
      return this.static(res, url.pathname);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  async api(req, res, parts, url) {
    const [route, id, sub, format] = parts;
    if (req.method === 'GET' && route === 'status') return json(res, 200, this.status());
    if (req.method === 'POST' && route === 'config') {
      const cfg = this.store.saveConfig(await readBody(req));
      this.obs.restart();
      this.watch();
      this.ingest();
      return json(res, 200, cfg);
    }
    if (req.method === 'POST' && route === 'ingest') return json(res, 200, this.ingest());
    if (req.method === 'GET' && route === 'codex') {
      return json(res, 200, this.derived().codex);
    }
    if (req.method === 'GET' && route === 'sessions' && !id) {
      return json(res, 200, this.store.sessions().map((s) => ({
        id: s.id, started: s.started, char: s.char, build: s.build, expansion: s.expansion, flavor: s.flavor,
        events: s.events.length, first: s.events[0]?.t ?? null, last: s.events.at(-1)?.t ?? null,
        zones: [...new Set(s.events.map((e) => e.z).filter(Boolean))],
      })).reverse());
    }
    if (req.method === 'GET' && route === 'sessions' && id) {
      const s = this.store.session(id);
      if (!s) return json(res, 404, { error: 'No such session' });
      const { where } = this.derived();
      return json(res, 200, {
        ...s,
        events: s.events.map((e) => ({ ...e, label: describe(e), cat: category(e), footage: where.get(`${s.id}|${e.t}`) ?? null })),
      });
    }
    if (req.method === 'GET' && route === 'recordings' && !id) {
      const { recordings, timelines } = this.derived();
      return json(res, 200, recordings.map((r) => summary(r, timelines.get(r.id))).reverse());
    }
    if (route === 'recordings' && id) {
      const { recordings, timelines } = this.derived();
      const r = recordings.find((x) => x.id === id);
      if (!r) return json(res, 404, { error: 'No such recording' });
      if (sub === 'export') return this.exportFile(res, r, timelines.get(r.id), format, url.searchParams.get('only'));
      if (sub === 'sync-candidates') return json(res, 200, this.syncCandidates(r, Number(url.searchParams.get('at') || 0)));
      if (req.method === 'POST' && sub === 'sync') {
        const { t, videoTime } = await readBody(req);
        if (!Number.isFinite(t) || !Number.isFinite(videoTime)) return json(res, 400, { error: 'Need t and videoTime' });
        // The recording started videoTime seconds before the flash appeared.
        const start = Math.round((t + this.store.config().clockOffset - videoTime) * 1000);
        return json(res, 200, this.store.setOverride(r.name, { start, syncT: t, videoTime }));
      }
      if (req.method === 'DELETE' && sub === 'sync') {
        return json(res, 200, this.store.setOverride(r.name, { start: null, syncT: null, videoTime: null }));
      }
      if (req.method === 'POST' && sub === 'duration') {
        const { duration } = await readBody(req);
        if (!(duration > 0)) return json(res, 400, { error: 'Need a duration' });
        // Only worth saving when the file dates were off (copied without them).
        if (Math.abs(duration - r.duration) < 1) return json(res, 200, { unchanged: true });
        return json(res, 200, this.store.setOverride(r.name, { duration }));
      }
      if (req.method === 'GET' && !sub) return json(res, 200, { ...summary(r, timelines.get(r.id)), events: timelines.get(r.id) });
      return json(res, 404, { error: 'Unknown recording route' });
    }
    if (req.method === 'POST' && route === 'export-all') return json(res, 200, this.exportAll());
    return json(res, 404, { error: 'Unknown API route' });
  }

  // Sync flashes near where this point of the video probably is, closest
  // first. The estimate uses the recording's uncorrected clock, so it can be
  // off by the very clock gap being measured; hence several candidates.
  syncCandidates(r, at) {
    const estimate = r.rawStart / 1000 + at;
    const out = [];
    for (const s of this.store.sessions()) {
      for (const e of s.events) {
        if (e.e === 'sync') out.push({ t: e.t, session: s.id, char: s.char?.name ?? null, zone: e.z ?? null, distance: e.t - estimate });
      }
    }
    return out.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance)).slice(0, 8);
  }

  renderExport(r, events, format, only) {
    const { cfg } = this.derived();
    const cats = only ? new Set(only.split(',')) : null;
    const list = cats ? events.filter((e) => cats.has(e.cat)) : events;
    switch (format) {
      case 'xml': return toFCPXML(r, list, cfg);
      case 'srt': return toSRT(list, cfg.cueSeconds);
      case 'csv': return toCSV(list);
      case 'chapters': return toChapters(events);
      case 'kills': return toKillsCSV(events, lifetimeKillsBefore(this.store.sessions(), r.start / 1000 - cfg.clockOffset));
      default: return null;
    }
  }

  exportFile(res, r, events, format, only) {
    const spec = EXPORTS[format];
    const body = spec && this.renderExport(r, events, format, only);
    if (body == null) return json(res, 404, { error: 'Unknown export format' });
    const name = path.parse(r.name).name + spec.ext;
    res.writeHead(200, {
      'Content-Type': `${spec.type}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    });
    res.end(body);
  }

  // Writes every export for every recording that has events to data/exports.
  exportAll() {
    const { recordings, timelines } = this.derived();
    const dir = this.store.file('exports');
    const written = [];
    for (const r of recordings) {
      const events = timelines.get(r.id);
      if (!events?.length) continue;
      const folder = path.join(dir, safeName(path.parse(r.name).name));
      fs.mkdirSync(folder, { recursive: true });
      for (const [format, spec] of Object.entries(EXPORTS)) {
        const file = path.join(folder, path.parse(r.name).name + spec.ext);
        fs.writeFileSync(file, this.renderExport(r, events, format));
        written.push(file);
      }
    }
    return { dir, files: written.length, recordings: new Set(written.map((f) => path.dirname(f))).size };
  }

  // Streams a recording to the browser's <video> element with range support.
  // Only files found in the recordings folder can be served.
  media(req, res, id) {
    const { recordings } = this.derived();
    const r = recordings.find((x) => x.id === id);
    if (!r) return json(res, 404, { error: 'No such recording' });
    const size = fs.statSync(r.file).size;
    const type = MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(r.file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(r.file).pipe(res);
  }

  static(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }
}

function summary(r, events = []) {
  const counts = {};
  for (const e of events) counts[e.cat] = (counts[e.cat] || 0) + 1;
  return {
    id: r.id, name: r.name, file: r.file, size: r.size, start: r.start, end: r.end, duration: r.duration, source: r.source,
    syncedFrom: r.syncedFrom ?? null,
    events: events.length, counts, zones: [...new Set(events.map((e) => e.z).filter(Boolean))],
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}
