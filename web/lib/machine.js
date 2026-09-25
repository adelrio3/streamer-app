// What this computer does for Chronicler, running in the background while the
// app is open:
//
//   every computer   measures its clock against the server (clock samples)
//   gaming PC        watches the addon's SavedVariables and uploads sessions;
//                    installs and updates the addon
//   recording Mac    listens to OBS for recording start/stop, and scans the
//                    recordings folder for files made while the app was closed

import { measureClock } from './cloud.js';
import { sessionsFromSavedVariables, mergeSession } from './sessions.js';
import { clockModel, startFromName, baseName } from './timeline.js';
import { ObsLink } from './obs.js';
import * as folders from './folders.js';

const CONFIG_KEY = 'chronicler.machine';
const CLOCK_EVERY = 10 * 60 * 1000;
const WOW_EVERY = 5000;
const REC_EVERY = 30000;
const REFRESH_EVERY = 60000;

export function defaultMachineConfig(platform = globalThis.navigator?.platform ?? '') {
  const mac = /mac/i.test(platform);
  return {
    name: mac ? 'Recording Mac' : 'Gaming PC',
    plays: !mac,
    records: mac,
    pattern: '%CCYY-%MM-%DD %hh-%mm-%ss',
    obs: { enabled: mac, port: 4455, password: '' },
  };
}

export class Machine {
  // state: { sessions, rows, clock } shared with the UI.
  // changed(): the UI should recompute and redraw.
  constructor({ store, state, changed = () => {}, notify = () => {} }) {
    Object.assign(this, { store, state, changed, notify });
    this.config = this.loadConfig();
    this.offset = null;
    this.rtt = null;
    this.wow = { state: 'off', files: [], installs: [], lastIngest: null, error: null, addonVersion: null };
    this.rec = { state: 'off', videos: new Map(), error: null };
    this.obsStatus = { state: 'off' };
    this.seen = new Map(); // SavedVariables file -> lastModified already handled
    this.timers = [];
  }

  loadConfig() {
    const base = defaultMachineConfig();
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
      return saved ? { ...base, ...saved, obs: { ...base.obs, ...(saved.obs || {}) } } : { ...base, fresh: true };
    } catch {
      return { ...base, fresh: true };
    }
  }

  saveConfig(patch) {
    const next = { ...this.config, ...patch, obs: { ...this.config.obs, ...(patch.obs || {}) } };
    delete next.fresh;
    this.config = next;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    this.restart();
  }

  get name() { return this.config.name; }

  async start() {
    await this.clockTick();
    this.every(CLOCK_EVERY, () => this.clockTick());
    this.every(REFRESH_EVERY, () => this.refresh());
    if (this.config.plays) {
      await this.initWow();
      this.every(WOW_EVERY, () => this.pollWow());
    }
    if (this.config.records) {
      await this.initRec();
      this.every(REC_EVERY, () => this.scanRec());
      if (this.config.obs.enabled) this.startObs();
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.obs?.stop();
    this.obs = null;
  }

  restart() {
    this.stop();
    this.start().then(() => this.changed()).catch((err) => this.notify(err.message));
  }

  every(ms, fn) {
    this.timers.push(setInterval(() => fn().catch((err) => console.warn(err)), ms));
  }

  // Clock ---------------------------------------------------------------------

  async clockTick() {
    try {
      const m = await measureClock(() => this.store.serverTime());
      this.offset = m.offset;
      this.rtt = m.rtt;
      this.store.offset = m.offset;
      const mine = this.state.clock.filter((s) => s.machine === this.name);
      const last = mine.at(-1);
      const lastAt = last ? Date.parse(last.measured_at) : 0;
      // Store a sample when the clock moved or an hour passed.
      if (!last || Math.abs(last.offset_ms - m.offset) > 15 || Date.now() - lastAt > 3600 * 1000) {
        this.state.clock.push(await this.store.addClockSample(this.name, m.offset, m.rtt));
        this.changed();
      }
    } catch (err) {
      console.warn('clock', err);
    }
  }

  // This computer's local time (ms) -> shared clock, using what was measured
  // around that time if possible.
  toServer(localMs) {
    const mine = this.state.clock.some((s) => s.machine === this.name);
    if (mine) return localMs + clockModel(this.state.clock)(this.name, localMs);
    return localMs + (this.offset ?? 0);
  }

  // Gaming PC -------------------------------------------------------------

  async initWow() {
    this.wowRoot = await folders.savedFolder('wow');
    await this.checkWow();
  }

  async checkWow() {
    if (!this.wowRoot) { this.wow.state = 'none'; return; }
    const perm = await folders.permission(this.wowRoot, 'readwrite');
    if (perm !== 'granted') { this.wow.state = 'needs-permission'; return; }
    this.wow.installs = await folders.wowInstalls(this.wowRoot);
    this.wow.state = this.wow.installs.length ? 'ok' : 'wrong-folder';
    for (const inst of this.wow.installs) inst.addonVersion = await folders.installedAddonVersion(inst.dir);
    await this.pollWow();
  }

  async pickWow() {
    this.wowRoot = await folders.pickFolder('wow', 'readwrite');
    await this.checkWow();
    this.changed();
  }

  async grantWow() {
    await folders.requestPermission(this.wowRoot, 'readwrite');
    await this.checkWow();
    this.changed();
  }

  async pollWow() {
    if (this.wow.state !== 'ok') return;
    const files = await folders.savedVariablesFiles(this.wowRoot);
    this.wow.files = files.map((f) => ({ flavor: f.flavor, account: f.account }));
    let uploaded = 0;
    for (const f of files) {
      const file = await f.handle.getFile();
      const key = `${f.flavor}/${f.account}`;
      if (this.seen.get(key) === file.lastModified) continue;
      const sessions = sessionsFromSavedVariables(await file.text(), { flavor: f.flavor, account: f.account });
      for (const s of sessions) {
        const i = this.state.sessions.findIndex((x) => x.id === s.id);
        const merged = mergeSession(i >= 0 ? this.state.sessions[i] : null, s);
        if (!merged) continue;
        merged.machine = this.name;
        merged.updated_at = await this.store.saveSession(merged, this.name);
        if (i >= 0) this.state.sessions[i] = merged; else this.state.sessions.push(merged);
        uploaded++;
      }
      this.seen.set(key, file.lastModified);
    }
    if (uploaded) {
      this.wow.lastIngest = { at: Date.now(), sessions: uploaded };
      this.state.sessions.sort((a, b) => a.started - b.started);
      this.changed();
      this.notify(`Uploaded ${uploaded} session${uploaded > 1 ? 's' : ''} from WoW.`);
    }
  }

  async installAddon(install) {
    const manifest = await (await fetch('addon/manifest.json', { cache: 'no-store' })).json();
    const files = [];
    for (const name of manifest.files) {
      const res = await fetch(`addon/Chronicler/${name}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not download ${name}`);
      files.push({ name, text: await res.text() });
    }
    await folders.installAddon(install.dir, files);
    install.addonVersion = manifest.version;
    this.changed();
    return manifest.version;
  }

  // Recording Mac -----------------------------------------------------------

  async initRec() {
    this.recRoot = await folders.savedFolder('recordings');
    await this.checkRec();
  }

  async checkRec() {
    if (!this.recRoot) { this.rec.state = 'none'; return; }
    const perm = await folders.permission(this.recRoot, 'read');
    if (perm !== 'granted') { this.rec.state = 'needs-permission'; return; }
    this.rec.state = 'ok';
    await this.scanRec();
  }

  async pickRec() {
    this.recRoot = await folders.pickFolder('recordings', 'read');
    await this.checkRec();
    this.changed();
  }

  async grantRec() {
    await folders.requestPermission(this.recRoot, 'read');
    await this.checkRec();
    this.changed();
  }

  row(name) {
    return this.state.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  }

  async putRow(row) {
    const saved = await this.store.saveRecording(row);
    const i = this.state.rows.findIndex((r) => r.name === row.name);
    if (i >= 0) this.state.rows[i] = saved; else this.state.rows.push(saved);
    this.changed();
    return saved;
  }

  fullPath(name) {
    const dir = this.obs?.recordDirectory;
    return dir ? `${dir.replace(/[\\/]+$/, '')}/${name}` : null;
  }

  // Files made while the app was closed get their times from the file name
  // (start) and last-modified date (end).
  async scanRec() {
    if (this.rec.state !== 'ok') return;
    const videos = await folders.listVideos(this.recRoot);
    this.rec.videos = new Map(videos.map((v) => [v.name.toLowerCase(), v]));
    const recordingNow = this.obs?.recording;
    for (const v of videos) {
      const row = this.row(v.name);
      if (recordingNow && Date.now() - v.lastModified < 15000) continue;
      if (!row) {
        const local = startFromName(v.name, this.config.pattern);
        if (local == null || v.lastModified <= local) continue;
        const start = this.toServer(local);
        const end = this.toServer(v.lastModified);
        await this.putRow({ name: v.name, path: this.fullPath(v.name), machine: this.name, start_ms: Math.round(start), end_ms: Math.round(end), duration: (end - start) / 1000, source: 'filename', sync: null });
      } else if (!row.duration && row.start_ms && v.lastModified) {
        // OBS said it started, but the app closed before it stopped.
        const end = this.toServer(v.lastModified);
        if (end > row.start_ms) await this.putRow({ ...row, end_ms: Math.round(end), duration: (end - row.start_ms) / 1000 });
      } else if (!row.path && this.fullPath(v.name)) {
        await this.putRow({ ...row, path: this.fullPath(v.name) });
      }
    }
  }

  startObs() {
    const { port, password } = this.config.obs;
    this.obs = new ObsLink({
      port, password,
      onStatus: (s) => { this.obsStatus = s; this.changed(); },
      onRecording: (ev) => this.onObs(ev).catch((err) => this.notify(err.message)),
    });
    this.obs.start();
  }

  async onObs(ev) {
    if (ev.type === 'start') {
      this.pendingStart = this.toServer(ev.at);
      if (ev.path) {
        const name = baseName(ev.path);
        await this.putRow({ ...(this.row(name) || {}), name, path: ev.path, machine: this.name, start_ms: Math.round(this.pendingStart), end_ms: null, duration: null, source: 'obs', sync: null });
      }
      this.notify('Recording started. Press your Sync key in game for a precise line-up.');
    } else if (ev.type === 'stop' && ev.path) {
      const name = baseName(ev.path);
      const start = this.toServer(ev.start);
      const end = this.toServer(ev.at);
      await this.putRow({ ...(this.row(name) || {}), name, path: ev.path, machine: this.name, start_ms: Math.round(start), end_ms: Math.round(end), duration: (end - start) / 1000, source: 'obs' });
      this.notify(`Recording saved: ${name}`);
    }
  }

  // Both computers ----------------------------------------------------------

  // Picks up what the other computer uploaded.
  async refresh() {
    // A couple of minutes of overlap covers uploads that were in flight.
    const newest = latest([...this.state.sessions, ...this.state.rows]);
    const since = new Date(Date.parse(newest) - 120000).toISOString();
    const { sessions, recordings } = await this.store.changedSince(since);
    let n = 0;
    for (const s of sessions) {
      const i = this.state.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) this.state.sessions[i] = s; else this.state.sessions.push(s);
      n++;
    }
    for (const r of recordings) {
      const i = this.state.rows.findIndex((x) => x.name === r.name);
      if (i >= 0) this.state.rows[i] = r; else this.state.rows.push(r);
      n++;
    }
    if (n) this.changed();
  }
}

function latest(rows) {
  let max = '1970-01-01T00:00:00Z';
  for (const r of rows) if (r.updated_at && r.updated_at > max) max = r.updated_at;
  return max;
}
