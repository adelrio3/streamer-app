// What this computer does for Chronicler, running in the background while the
// app is open:
//
//   every computer   measures its clock against the server (clock samples)
//   gaming PC        watches the addon's SavedVariables and uploads sessions;
//                    installs and updates the addon
//   recording Mac    listens to OBS for recording start/stop, and scans the
//                    recordings folder for files made while the app was closed

import { measureClock } from './cloud.js';
import { readAddonLog, mergeSession } from './sessions.js';
import { clockModel, startFromName, baseName, eventMs } from './timeline.js';
import { LiveState, eventsFromChatLog, counterValues, pastLoot, randomToken } from './live.js';
import { VoiceNotes } from './voice.js';
import { ObsLink } from './obs.js';
import * as folders from './folders.js';

const CONFIG_KEY = 'chronicler.machine';
const CLOCK_EVERY = 10 * 60 * 1000;
const WOW_EVERY = 5000;
const REC_EVERY = 30000;
const REFRESH_EVERY = 60000;
const LIVE_EVERY = 1000;
const LIVE_PUSH_GAP = 1500;
const LIVE_HEARTBEAT = 20000;
const LIVE_SINCE_KEY = 'chronicler.live.since';

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
    // The live link: the chat log on this PC, read as the game writes it.
    this.live = { status: 'off', file: null, flavor: null, size: 0, remainder: '', linkSeenAt: 0, state: new LiveState(this.loadSince()), lastPush: 0, pushedSeq: -1, error: null, changedAt: 0 };
    // Voice notes: transcribed here, uploaded in batches.
    this.voice = { status: 'off', notes: null, queue: [] };
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
      if (this.liveEnabled()) {
        this.live.status = 'waiting';
        this.every(LIVE_EVERY, () => this.pollLive());
      }
      if (this.config.voice) {
        this.startVoice();
        this.every(5000, () => this.flushVoice());
      }
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
    this.voice.notes?.stop();
    this.voice.notes = null;
  }

  // Voice notes ---------------------------------------------------------------

  startVoice() {
    if (this.voice.notes) return;
    this.state.voice ??= [];
    this.voice.notes = new VoiceNotes({
      lang: this.config.voiceLang || 'en-US',
      onState: (status) => { this.voice.status = status; this.changed(); },
      onNote: (n) => {
        const row = { id: n.id, machine: this.name, start_ms: Math.round(this.toServer(n.start)), end_ms: Math.round(this.toServer(n.end)), text: n.text };
        this.state.voice.push(row);
        this.voice.queue.push(row);
        this.changed();
      },
    });
    this.voice.notes.start();
  }

  async flushVoice() {
    if (!this.voice.queue.length) return;
    const rows = this.voice.queue.splice(0);
    try { await this.store.saveVoice(rows); } catch (err) { this.voice.queue.unshift(...rows); this.voice.status = `error: ${err.message}`; }
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
      const log = readAddonLog(await file.text(), { flavor: f.flavor, account: f.account });
      const resetAt = this.state.settings.resetAt || 0;
      for (const s of log.sessions) {
        // Sessions from before "delete everything" stay deleted.
        if ((s.started || 0) < resetAt) continue;
        const i = this.state.sessions.findIndex((x) => x.id === s.id);
        const merged = mergeSession(i >= 0 ? this.state.sessions[i] : null, s);
        if (merged) {
          merged.machine = this.name;
          merged.updated_at = await this.store.saveSession(merged, this.name);
          if (i >= 0) this.state.sessions[i] = merged; else this.state.sessions.push(merged);
          uploaded++;
        }
        if (this.state.schema2) await this.uploadTrack(s);
      }
      if (this.state.schema2) await this.uploadItems(log.items);
      await this.collectErrors(log.errors || [], f.flavor);
      this.seen.set(key, file.lastModified);
    }
    if (this.state.schema2) await this.uploadScreenshots();
    if (uploaded) {
      this.wow.lastIngest = { at: Date.now(), sessions: uploaded };
      this.state.sessions.sort((a, b) => a.started - b.started);
      this.markUploaded();
      this.changed();
      this.notify(`Uploaded ${uploaded} session${uploaded > 1 ? 's' : ''} from WoW.`);
    }
  }

  // Live link ---------------------------------------------------------------
  // The addon posts what happens into a hidden chat channel; the game writes
  // the chat log as it goes; this reads the new lines every second and keeps
  // the overlay's totals in the cloud.

  // When the current stream session started. A session survives reloading
  // the tab, but not two days.
  loadSince() {
    try {
      const v = Number(localStorage.getItem(LIVE_SINCE_KEY)) || 0;
      if (v && Date.now() - v < 48 * 3600 * 1000) return v;
    } catch { /* storage off */ }
    return Date.now();
  }

  liveEnabled() {
    return Boolean(this.config.plays && this.config.live !== false);
  }

  // Everything uploaded so far ends here (server ms); live loot after it is
  // not in any session yet.
  markUploaded() {
    const clock = clockModel(this.state.clock);
    let until = 0;
    for (const s of this.state.sessions) {
      const last = s.events.at(-1);
      if (last) until = Math.max(until, eventMs(s, last, clock));
    }
    this.live.state.uploadedUntil = until;
  }

  // A new stream session: the overlay's counters start from now.
  async resetLive() {
    const since = Date.now();
    try { localStorage.setItem(LIVE_SINCE_KEY, String(since)); } catch { /* storage off */ }
    this.live.state.reset(this.toServer(since));
    this.markUploaded();
    await this.pushLive(true);
    this.changed();
  }

  async pollLive() {
    if (!this.liveEnabled() || this.wow.state !== 'ok') return;
    const live = this.live;
    if (!live.file) {
      for (const inst of this.wow.installs) {
        const f = await folders.chatLogFile(inst.dir);
        if (f) { live.file = f; live.flavor = inst.flavor; break; }
      }
      if (!live.file) { live.status = 'no-log'; await this.pushLive(false); return; }
      live.status = 'ok';
      this.markUploaded();
    }
    let file;
    try { file = await live.file.getFile(); } catch (err) { live.file = null; live.status = 'no-log'; live.error = err.message; return; }
    if (file.size < live.size) { live.size = 0; live.remainder = ''; } // the game started the log over
    if (live.size === 0) live.size = Math.max(0, file.size - 512 * 1024); // catch up on the end of the file
    if (file.size > live.size) {
      const text = await file.slice(live.size, file.size).text();
      live.size = file.size;
      const chunk = live.remainder + text;
      const cut = chunk.lastIndexOf('\n');
      live.remainder = cut >= 0 ? chunk.slice(cut + 1) : chunk;
      const { events, linkSeenAt } = eventsFromChatLog(cut >= 0 ? chunk.slice(0, cut + 1) : '', { linkSeenAt: live.linkSeenAt });
      live.linkSeenAt = linkSeenAt;
      let changed = false;
      // The log carries this PC's local time; everything else runs on the server clock.
      for (const e of events) if (live.state.apply({ ...e, at: this.toServer(e.at) })) changed = true;
      if (changed) { live.changedAt = Date.now(); this.changed(); }
      await this.pushLive(changed);
      return;
    }
    await this.pushLive(false);
  }

  async pushLive(force) {
    const live = this.live;
    const now = Date.now();
    const due = force || (live.state.seq !== live.pushedSeq && now - live.lastPush > LIVE_PUSH_GAP) || now - live.lastPush > LIVE_HEARTBEAT;
    if (!due) return;
    live.lastPush = now;
    try {
      const token = await this.liveToken();
      const snap = live.state.snapshot(this.toServer(now));
      snap.counters = this.counterValues();
      snap.machine = this.name;
      snap.link = { status: live.status, flavor: live.flavor, changedAt: live.changedAt ? this.toServer(live.changedAt) : 0, linkSeenAt: live.linkSeenAt ? this.toServer(live.linkSeenAt) : 0 };
      await this.store.saveLive(token, this.name, snap);
      live.pushedSeq = live.state.seq;
      live.error = null;
      this.state.live = { token, machine: this.name, state: snap, updated_at: new Date(now + (this.offset ?? 0)).toISOString() };
    } catch (err) {
      live.error = err.message;
      if (!/does not exist|schema cache/i.test(err.message)) console.warn('live', err);
    }
  }

  // A test event from the Live page, shown by the overlay like a real one.
  async liveTest(ev) {
    this.live.state.apply({ at: this.toServer(Date.now()), ...ev });
    await this.pushLive(true);
  }

  async liveToken() {
    if (!this.state.settings.liveToken) {
      this.state.settings = { ...this.state.settings, liveToken: randomToken() };
      await this.store.saveSettings(this.state.settings);
    }
    return this.state.settings.liveToken;
  }

  counterValues() {
    const counters = this.state.settings.liveCounters || [];
    if (!counters.length) return [];
    const clock = clockModel(this.state.clock);
    return counterValues(counters, pastLoot(this.state.sessions, (s, e) => eventMs(s, e, clock)), this.live.state);
  }

  // Lua errors the addon caught, kept in the settings so any computer can
  // show them and copy a dump for a bug report.
  async collectErrors(errors, flavor) {
    if (!errors.length) return;
    const have = new Map((this.state.settings.addonErrors || []).map((e) => [e.key, e]));
    let changed = false;
    for (const e of errors) {
      const prev = have.get(e.key);
      if (prev && prev.last === e.last && prev.n === e.n) continue;
      have.set(e.key, { ...e, flavor, machine: this.name });
      changed = true;
    }
    if (!changed) return;
    const list = [...have.values()].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 100);
    this.state.settings = { ...this.state.settings, addonErrors: list };
    await this.store.saveSettings(this.state.settings);
  }

  // Position points go up in chunks of 1000; only chunks with new points.
  async uploadTrack(s) {
    const points = s.track || [];
    if (!points.length) return;
    const key = `chronicler.track.${s.id}`;
    const done = Number(localStorage.getItem(key) || 0);
    if (done >= points.length) return;
    for (let chunk = Math.floor(done / 1000); chunk * 1000 < points.length; chunk++) {
      await this.store.saveTrack(s.id, chunk, points.slice(chunk * 1000, (chunk + 1) * 1000), this.name);
    }
    localStorage.setItem(key, String(points.length));
    this.state.tracks?.set(s.id, points);
  }

  // Items that are new or changed since they were last uploaded.
  async uploadItems(items) {
    const known = new Map(this.state.items.map((r) => [r.item_id, JSON.stringify(r.data)]));
    const changed = items.filter((r) => known.get(r.item_id) !== JSON.stringify(r.data));
    if (!changed.length) return;
    await this.store.saveItems(changed);
    const byId = new Map(this.state.items.map((r) => [r.item_id, r]));
    for (const r of changed) byId.set(r.item_id, r);
    this.state.items = [...byId.values()];
    this.changed();
  }

  // Screenshots taken while Chronicler was logging, shrunk and uploaded a few
  // at a time. WoW names them WoWScrnShot_MMDDYY_HHMMSS.jpg in local time.
  async uploadScreenshots() {
    this.skipShots ??= new Set();
    const have = new Set(this.state.screenshots.map((r) => r.name));
    const windows = this.state.sessions.filter((s) => s.machine === this.name && s.events.length)
      .map((s) => [s.events[0].t - 60, s.events.at(-1).t + 60]);
    let budget = 3;
    for (const inst of this.wow.installs) {
      for (const shot of await folders.listScreenshots(inst.dir)) {
        if (budget <= 0) return;
        if (have.has(shot.name) || this.skipShots.has(shot.name)) continue;
        const local = screenshotTime(shot.name);
        const sec = local / 1000;
        if (local == null || !windows.some(([a, b]) => sec >= a && sec <= b)) {
          this.skipShots.add(shot.name);
          continue;
        }
        budget--;
        try {
          const { blob, width, height } = await shrink(await shot.handle.getFile());
          const row = await this.store.saveScreenshot({ name: shot.name, flavor: inst.flavor, machine: this.name, taken_ms: Math.round(this.toServer(local)), width, height }, blob);
          this.state.screenshots.push(row);
          this.changed();
        } catch (err) {
          this.skipShots.add(shot.name);
          console.warn('screenshot', shot.name, err);
        }
      }
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
        // Recordings from before "delete everything" stay deleted.
        if (start < (this.state.settings.resetAt || 0) * 1000) continue;
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
    const newest = latest([...this.state.sessions, ...this.state.rows, ...this.state.items, ...this.state.screenshots]);
    const since = new Date(Date.parse(newest) - 120000).toISOString();
    const { sessions, recordings, items, screenshots, voice } = await this.store.changedSince(since);
    let n = 0;
    this.state.voice ??= [];
    for (const v of voice) {
      if (this.state.voice.some((x) => x.id === v.id)) continue;
      this.state.voice.push(v);
      n++;
    }
    if (voice.length) this.state.voice.sort((a, b) => a.start_ms - b.start_ms);
    if (items.length) {
      const byId = new Map(this.state.items.map((r) => [r.item_id, r]));
      for (const r of items) byId.set(r.item_id, r);
      this.state.items = [...byId.values()];
      n++;
    }
    for (const r of screenshots) {
      if (!this.state.screenshots.some((x) => x.name === r.name)) { this.state.screenshots.push(r); n++; }
    }
    if (sessions.length) this.state.tracks = null; // reload routes when next needed
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

export function screenshotTime(name) {
  const m = /WoWScrnShot_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m) return null;
  const [, mo, d, y, h, mi, sec] = m.map(Number);
  return new Date(2000 + y, mo - 1, d, h, mi, sec).getTime();
}

// Shrinks a screenshot to at most 1280 px wide as a JPEG.
async function shrink(file, maxWidth = 1280) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return { blob, width, height };
}

function latest(rows) {
  let max = '1970-01-01T00:00:00Z';
  for (const r of rows) if (r.updated_at && r.updated_at > max) max = r.updated_at;
  return max;
}
