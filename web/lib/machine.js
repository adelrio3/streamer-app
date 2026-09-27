// What this computer does for Compendium, running in the background while the
// app is open:
//
//   every computer   measures its clock against the server (clock samples)
//   gaming PC        watches the addon's SavedVariables and uploads sessions;
//                    installs and updates the addon
//   recording Mac    listens to OBS for recording start/stop, and scans the
//                    recordings folder for files made while the app was closed

import { measureClock } from './cloud.js';
import { readAddonLog, mergeSession } from './sessions.js';
import { clockModel, startFromName, baseName, eventMs, recordingRole } from './timeline.js';
import { readMovieInfo, isMovieFile } from './mov.js';
import { LiveState, eventsFromChatLog, counterValues, pastLoot, randomToken, PAD_PREFIX } from './live.js';
import { VoiceNotes } from './voice.js';
import { ObsLink } from './obs.js';
import * as folders from './folders.js';

const CONFIG_KEY = 'chronicler.machine';
const CLOCK_EVERY = 10 * 60 * 1000;
const WOW_EVERY = 5000;
const REC_EVERY = 20000;
const GROWING_FOR = 45000; // ms since a video's last write within which it counts as still being recorded
const REFRESH_EVERY = 60000;
const LIVE_EVERY = 1000;
const LIVE_PUSH_GAP = 1500; // between pushes while nothing is being recorded...
const LIVE_PUSH_GAP_LIVE = 200; // ...and while a session is on: every change goes up at once
const LIVE_HEARTBEAT = 60000; // a touch of updated_at when nothing changed
const LIVE_SINCE_KEY = 'chronicler.live.since';
const LIVE_FOLLOW_KEY = 'chronicler.live.follow'; // the recording the stream session follows
const LIVE_KNOWN_KEY = 'chronicler.live.known'; // items and creatures already called out as new, until the wiki has them
const LIVE_PURGE_MIN = 1024 * 1024; // empty the chat log once it is over 1 MB...
const LIVE_PURGE_QUIET = 3 * 60 * 1000; // ...and the game has not written it for 3 minutes (logged out)
const LIVE_PURGE_RETRY = 60 * 1000; // try again a minute later if the game still had it open

export function defaultMachineConfig(platform = globalThis.navigator?.platform ?? '') {
  const mac = /mac/i.test(platform);
  return {
    name: mac ? 'Recording Mac' : 'Gaming PC',
    plays: !mac,
    records: mac,
    pattern: '%CCYY-%MM-%DD %hh-%mm-%ss',
    obs: { enabled: mac, port: 4455, password: '' },
    // More OBS instances on the same computer that record alongside the main
    // one (a second for the camera, a third for the overlay): the app starts
    // and stops their recordings with the main one.
    obsMore: [{ key: 'cam', label: 'Camera', enabled: false, port: 4456, password: '' }, { key: 'overlay', label: 'Overlay', enabled: false, port: 4457, password: '' }],
  };
}

export class Machine {
  // state: { sessions, rows, clock } shared with the UI.
  // changed(topic): the UI should recompute and redraw the pages that show
  // that topic: 'data' (sessions, items, recordings), 'live'
  // (the live link), 'voice', 'obs', 'clock', 'wow' (folder and addon state).
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
    this.live = { status: 'off', file: null, flavor: null, size: 0, remainder: '', linkSeenAt: 0, lastPayload: null, state: new LiveState(this.loadSince()), lastPush: 0, pushedSeq: -1, error: null, changedAt: 0, fileSize: 0, fileModified: 0, lines: 0, decoded: 0, lastLine: '' };
    // Voice notes: transcribed here, uploaded in batches.
    this.voice = { status: 'off', notes: null, queue: [] };
  }

  loadConfig() {
    const base = defaultMachineConfig();
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
      return saved ? { ...base, ...saved, obs: { ...base.obs, ...(saved.obs || {}) }, obsMore: mergeMore(base.obsMore, saved.obsMore) } : { ...base, fresh: true };
    } catch {
      return { ...base, fresh: true };
    }
  }

  saveConfig(patch) {
    const next = { ...this.config, ...patch, obs: { ...this.config.obs, ...(patch.obs || {}) }, obsMore: mergeMore(this.config.obsMore, patch.obsMore) };
    delete next.fresh;
    this.config = next;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    this.restart();
  }

  get name() { return this.config.name; }

  async start() {
    await this.clockTick();
    this.every(CLOCK_EVERY, () => this.clockTick());
    // The gaming PC looks more often, so a recording started on the other
    // computer opens a stream session within seconds.
    this.every(this.liveEnabled() ? 10000 : REFRESH_EVERY, () => this.refresh());
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
    for (const c of this.obsMore || []) c.link?.stop();
    this.obsMore = [];
    this.voice.notes?.stop();
    this.voice.notes = null;
  }

  // Voice notes ---------------------------------------------------------------

  startVoice() {
    if (this.voice.notes) return;
    this.state.voice ??= [];
    this.voice.notes = new VoiceNotes({
      lang: this.config.voiceLang || 'en-US',
      onState: (status) => { this.voice.status = status; this.changed('voice'); },
      onNote: (n) => {
        const row = { id: n.id, machine: this.name, start_ms: Math.round(this.toServer(n.start)), end_ms: Math.round(this.toServer(n.end)), text: n.text };
        this.state.voice.push(row);
        this.voice.queue.push(row);
        this.changed('voice');
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
    this.start().then(() => this.changed('all')).catch((err) => this.notify(err.message));
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
        this.changed('clock');
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
    this.changed('wow');
  }

  async grantWow() {
    await folders.requestPermission(this.wowRoot, 'readwrite');
    await this.checkWow();
    this.changed('wow');
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
      const deleted = new Set(this.state.settings.deletedSessions || []);
      for (const s of log.sessions) {
        // Sessions from before "delete everything", and deleted characters, stay deleted.
        if ((s.started || 0) < resetAt || deleted.has(s.id)) continue;
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
    if (uploaded) {
      this.wow.lastIngest = { at: Date.now(), sessions: uploaded };
      this.state.sessions.sort((a, b) => a.started - b.started);
      this.markUploaded();
      this.changed('data');
      this.notify(`Uploaded ${uploaded} session${uploaded > 1 ? 's' : ''} from WoW.`);
    }
  }

  // Live link ---------------------------------------------------------------
  // The addon writes what happens into the chat log as hidden system lines; the game writes
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
  // While a stream session is on (a recording the PC follows, or one started
  // by hand in the last four hours) the link is as quick as it can be:
  // changes push at once and the overlay polls every second. Otherwise the
  // thrifty cadence holds.
  sessionActive() {
    const f = this.live.follow;
    if (f && f.start && !f.ended) return true;
    return Boolean(this.live.manualSince && Date.now() - this.live.manualSince < 4 * 3600 * 1000);
  }

  // After "delete everything": the stream session starts afresh and no
  // recording is followed until a new one starts.
  async forgetLive() {
    this.live.follow = null;
    this.live.manualSince = 0;
    this.live.known = new Set();
    try { localStorage.removeItem(LIVE_FOLLOW_KEY); localStorage.removeItem(LIVE_KNOWN_KEY); } catch { /* storage off */ }
    if (this.liveEnabled()) await this.resetLive();
  }

  async resetLive(sinceLocal = Date.now(), { manual = false } = {}) {
    const since = sinceLocal;
    if (manual) this.live.manualSince = Date.now();
    try { localStorage.setItem(LIVE_SINCE_KEY, String(since)); } catch { /* storage off */ }
    this.live.state.reset(this.toServer(since));
    this.markUploaded();
    await this.pushLive(true);
    this.changed('live');
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
    live.fileSize = file.size;
    live.fileModified = file.lastModified;
    if (await this.purgeChatLog(file)) return;
    if (file.size < live.size) { live.size = 0; live.remainder = ''; } // the game started the log over
    if (live.size === 0) live.size = Math.max(0, file.size - 512 * 1024); // catch up on the end of the file
    if (file.size > live.size) {
      const text = await file.slice(live.size, file.size).text();
      live.size = file.size;
      const chunk = live.remainder + text;
      const cut = chunk.lastIndexOf('\n');
      live.remainder = cut >= 0 ? chunk.slice(cut + 1) : chunk;
      const { events, linkSeenAt, lastPayload } = eventsFromChatLog(cut >= 0 ? chunk.slice(0, cut + 1) : '', { linkSeenAt: live.linkSeenAt, lastPayload: live.lastPayload });
      live.linkSeenAt = linkSeenAt;
      live.lastPayload = lastPayload;
      const lines = (cut >= 0 ? chunk.slice(0, cut) : '').split('\n').filter((l) => l && !l.includes(PAD_PREFIX + '~'));
      live.lines += lines.length;
      live.decoded += events.filter((e) => !e.fromGame).length;
      if (lines.length) live.lastLine = lines.at(-1).slice(0, 160);
      let changed = false;
      // The log carries this PC's local time; everything else runs on the server clock.
      for (const e of events) if (live.state.apply({ ...e, at: this.toServer(e.at) })) changed = true;
      if (changed) { live.changedAt = Date.now(); this.changed('live'); }
      await this.pushLive(changed);
      return;
    }
    await this.pushLive(false);
  }

  // The filler the addon sends makes the chat log grow by tens of MB in a
  // session, so this empties it when the game is not writing it. While you
  // are logged in the addon writes the file at least once a minute (the
  // heartbeat and its filler), so a file untouched for a few minutes means
  // you are logged out and the game has closed it; Windows refuses the
  // replace while it is open, and then this simply tries again later.
  async purgeChatLog(file) {
    const live = this.live;
    const now = Date.now();
    if (file.size < LIVE_PURGE_MIN || now - file.lastModified < LIVE_PURGE_QUIET || now - (live.purgeTriedAt || 0) < LIVE_PURGE_RETRY) return false;
    live.purgeTriedAt = now;
    try {
      const w = await live.file.createWritable({ keepExistingData: false });
      await w.close();
      live.purgedAt = now;
      live.purgedBytes = file.size;
      live.purgeError = null;
      live.size = 0;
      live.remainder = '';
      live.fileSize = 0;
      this.changed('live');
      await this.pushLive(true);
      return true;
    } catch (err) {
      live.purgeError = err.message; // in use by the game, most likely
      return false;
    }
  }

  async pushLive(force) {
    const live = this.live;
    const now = Date.now();
    const changed = live.state.seq !== live.pushedSeq;
    const gap = this.sessionActive() ? LIVE_PUSH_GAP_LIVE : LIVE_PUSH_GAP;
    const due = force || (changed && now - live.lastPush > gap) || now - live.lastPush > LIVE_HEARTBEAT;
    if (!due) return;
    live.lastPush = now;
    try {
      const token = await this.liveToken();
      if (!force && !changed && live.pushedSeq >= 0) {
        // Nothing new: just say this PC is still here (a tiny update, not the whole row).
        await this.store.touchLive();
        if (this.state.live) this.state.live.updated_at = new Date(now + (this.offset ?? 0)).toISOString();
        return;
      }
      this.markNovel(live.state.events);
      const snap = live.state.snapshot(this.toServer(now));
      snap.counters = this.counterValues();
      snap.machine = this.name;
      snap.recording = this.sessionActive(); // the overlay polls faster while it is
      snap.link = { status: live.status, purgedAt: live.purgedAt ? this.toServer(live.purgedAt) : 0, purgedBytes: live.purgedBytes || 0, flavor: live.flavor, changedAt: live.changedAt ? this.toServer(live.changedAt) : 0, linkSeenAt: live.linkSeenAt ? this.toServer(live.linkSeenAt) : 0, fileSize: live.fileSize, fileModified: live.fileModified ? this.toServer(live.fileModified) : 0, lines: live.lines, decoded: live.decoded };
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

  // An item looted or a creature hunted for the first time this session is
  // "novel" when the wiki (every uploaded session) has never had it either:
  // the overlay calls those out. Decided once per event, when the wiki is loaded.
  // "New" means new to the account, not to the stream session: the wiki
  // (every uploaded session, any character) decides, and until the current
  // play session is uploaded (the game writes its log at logout), a set kept
  // here remembers what has already been called out, so a second stream
  // session in the same evening does not call it out again.
  markNovel(events) {
    const world = this.state?.cache?.world;
    if (!world) return;
    if (!this.live.known) { try { this.live.known = new Set(JSON.parse(localStorage.getItem(LIVE_KNOWN_KEY) || '[]')); } catch { this.live.known = new Set(); } }
    const known = this.live.known;
    let grew = false;
    for (const e of events) {
      if (e.novel !== undefined) continue;
      if (e.kind !== 'loot' && e.kind !== 'kill') continue;
      const key = e.kind === 'loot' ? `i${Number(e.id)}` : `k${e.npcId || e.name}`;
      const inWiki = e.kind === 'loot'
        ? Boolean(world.byItem?.get(Number(e.id))?.obtained)
        : (world.byNpc?.get(`n${e.npcId}`)?.kills > 0) || Boolean(world.creatures?.some((c) => c.name === e.name && c.kills > 0));
      e.novel = !inWiki && !known.has(key);
      if (!known.has(key)) { known.add(key); grew = true; }
    }
    if (grew) { try { localStorage.setItem(LIVE_KNOWN_KEY, JSON.stringify([...known].slice(-5000))); } catch { /* storage off */ } }
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
    this.changed('data');
  }

  async installAddon(install) {
    const manifest = await (await fetch('addon/manifest.json', { cache: 'no-store' })).json();
    const files = [];
    for (const name of manifest.files) {
      const res = await fetch(`addon/Compendium/${name}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not download ${name}`);
      files.push({ name, text: await res.text() });
    }
    await folders.installAddon(install.dir, files);
    install.addonVersion = manifest.version;
    this.changed('wow');
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
    this.changed('wow');
  }

  async grantRec() {
    await folders.requestPermission(this.recRoot, 'read');
    await this.checkRec();
    this.changed('wow');
  }

  // Writing beside the recordings (the session package) needs the folder
  // granted for writing, which Chrome asks about once per session.
  async recWritable() {
    if (!this.recRoot) return false;
    return (await folders.permission(this.recRoot, 'readwrite')) === 'granted';
  }

  async grantRecWrite() {
    if (!this.recRoot) return false;
    await folders.requestPermission(this.recRoot, 'readwrite');
    this.changed('wow');
    return this.recWritable();
  }

  // A writable stream for a new file next to a recording (in the folder the
  // video is in), or null when the folder cannot be written.
  async recFile(name, beside = null) {
    if (!(await this.recWritable())) return null;
    const dir = (beside && await folders.folderOfVideo(this.recRoot, beside)) || this.recRoot;
    const handle = await dir.getFileHandle(name, { create: true });
    return handle.createWritable();
  }

  row(name) {
    return this.state.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  }

  async putRow(row) {
    const saved = await this.store.saveRecording(row);
    const i = this.state.rows.findIndex((r) => r.name === row.name);
    if (i >= 0) this.state.rows[i] = saved; else this.state.rows.push(saved);
    this.changed('data');
    return saved;
  }

  fullPath(name, sub = '') {
    const dir = this.obs?.recordDirectory || this.config.recordDirectory;
    if (!dir) return sub ? `${sub}/${name}` : null;
    return `${dir.replace(/[\\/]+$/, '')}/${sub ? `${sub}/` : ''}${name}`;
  }

  // The recordings folder is the source of truth: a file that appears and
  // keeps growing is a recording under way (a stream session starts, whether
  // OBS itself, a Source Record filter or QuickTime is writing it); one that
  // has stopped growing has ended. Its start comes from its name (OBS's
  // pattern) or, failing that, from the file's own movie header (creation
  // time and length: QuickTime/MP4 files say both, ProRes included); its end
  // from the last-modified date. Files that carry no time at all are left
  // alone.
  async scanRec() {
    if (this.rec.state !== 'ok') return;
    const videos = await folders.listVideos(this.recRoot);
    this.rec.videos = new Map(videos.map((v) => [v.name.toLowerCase(), v]));
    const now = Date.now();
    for (const v of videos) {
      const row = this.row(v.name);
      const growing = now - v.lastModified < GROWING_FOR;
      const path = this.fullPath(v.name, v.dir);
      // A failed attempt (an encoder that never wrote a frame) is not a recording.
      if (!row && !growing && v.size < 4096) continue;
      if (!row) {
        let local = startFromName(v.name, this.config.pattern);
        let duration = null;
        if (local == null && isMovieFile(v.name)) {
          const info = await readMovieInfo(v.file).catch(() => null);
          if (info?.created) { local = info.created; duration = info.duration; }
        }
        if (local == null || v.lastModified < local) continue;
        const start = this.toServer(local);
        // Recordings from before "delete everything" stay deleted.
        if (start < (this.state.settings.resetAt || 0) * 1000) continue;
        if (growing) {
          // Under way: no end yet. Only a game recording is a stream session, and only a fresh one.
          if (now - v.lastModified > 60000 || recordingRole(v.name, path) !== 'game') continue;
          await this.putRow({ name: v.name, path, machine: this.name, start_ms: Math.round(start), end_ms: null, duration: null, source: 'file', sync: null });
          this.notify(`Recording under way: ${v.name}`);
          continue;
        }
        const end = duration ? start + duration * 1000 : this.toServer(v.lastModified);
        if (end <= start) continue;
        await this.putRow({ name: v.name, path, machine: this.name, start_ms: Math.round(start), end_ms: Math.round(end), duration: (end - start) / 1000, source: duration ? 'file' : 'filename', sync: null });
      } else if (!row.duration && row.start_ms && v.lastModified && !growing) {
        // It was under way (OBS said so, or the file was growing); now it has stopped.
        let end = this.toServer(v.lastModified);
        if (isMovieFile(v.name)) { const info = await readMovieInfo(v.file).catch(() => null); if (info?.duration) end = row.start_ms + info.duration * 1000; }
        if (end > row.start_ms) { await this.putRow({ ...row, path: row.path || path, end_ms: Math.round(end), duration: (end - row.start_ms) / 1000 }); if (row.source === 'file') this.notify(`Recording saved: ${v.name}`); }
      } else if (!row.path && path) {
        await this.putRow({ ...row, path });
      }
    }
  }

  startObs() {
    const { port, password } = this.config.obs;
    this.obs = new ObsLink({
      port, password,
      onStatus: (s) => { this.obsStatus = s; this.changed('obs'); },
      onRecording: (ev) => this.onObs(ev).catch((err) => this.notify(err.message)),
    });
    this.obs.start();
    this.obsMore = (this.config.obsMore || []).filter((c) => c.enabled).map((c) => {
      const more = { ...c, status: { state: 'off', recording: false }, link: null };
      more.link = new ObsLink({
        port: c.port, password: c.password,
        onStatus: (s) => {
          // The camera instance also feeds OBS Virtual Camera, which the
          // streaming instance picks up as its camera source.
          if (c.key === 'cam' && s.state === 'connected' && more.status?.state !== 'connected') more.link.request('StartVirtualCam').catch?.(() => {});
          more.status = s; this.changed('obs');
        },
        onRecording: (ev) => this.onObs(ev, more).catch((err) => this.notify(err.message)),
      });
      more.link.start();
      return more;
    });
  }

  // ev from the main OBS, or from a companion instance (`more`) whose
  // recording the app starts and stops with the main one. Every file gets a
  // row with exact times; only the main one drives the sync prompt.
  async onObs(ev, more = null) {
    if (ev.type === 'start') {
      const start = this.toServer(ev.at);
      if (!more) this.pendingStart = start;
      if (ev.path) {
        const name = baseName(ev.path);
        await this.putRow({ ...(this.row(name) || {}), name, path: ev.path, machine: this.name, start_ms: Math.round(start), end_ms: null, duration: null, source: 'obs', sync: null });
      }
      if (!more) {
        this.notify('Recording started. Press your Sync key in game for a precise line-up.');
        for (const c of this.obsMore || []) if (c.status?.state === 'connected' && !c.status.recording) c.link.request('StartRecord').catch?.(() => {});
      }
    } else if (ev.type === 'stop' && ev.path) {
      const name = baseName(ev.path);
      const start = this.toServer(ev.start);
      const end = this.toServer(ev.at);
      await this.putRow({ ...(this.row(name) || {}), name, path: ev.path, machine: this.name, start_ms: Math.round(start), end_ms: Math.round(end), duration: (end - start) / 1000, source: 'obs' });
      if (!more) {
        this.notify(`Recording saved: ${name}`);
        for (const c of this.obsMore || []) if (c.status?.state === 'connected' && c.status.recording) c.link.request('StopRecord').catch?.(() => {});
      }
    }
  }

  // Both computers ----------------------------------------------------------

  // Picks up what the other computer uploaded.
  async refresh() {
    // A couple of minutes of overlap covers uploads that were in flight.
    const newest = latest([...this.state.sessions, ...this.state.rows, ...this.state.items]);
    const since = new Date(Date.parse(newest) - 120000).toISOString();
    const { sessions, recordings, items, voice } = await this.store.changedSince(since);
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
    if (sessions.length) this.state.tracks = null; // reload routes when next needed
    const deleted = new Set(this.state.settings.deletedSessions || []);
    for (const s of sessions) {
      if (deleted.has(s.id)) continue;
      const i = this.state.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) this.state.sessions[i] = s; else this.state.sessions.push(s);
      n++;
    }
    for (const r of recordings) {
      const i = this.state.rows.findIndex((x) => x.name === r.name);
      if (i >= 0) this.state.rows[i] = r; else this.state.rows.push(r);
      n++;
    }
    if (n) this.changed('data');
    await this.followRecordings();
  }

  // A stream session is a recording: when OBS on the recording computer
  // starts one, the live counters start from that moment; when it stops,
  // the session is complete and the overlay says so. Only the gaming PC
  // (which owns the live row) does this.
  async followRecordings() {
    if (!this.liveEnabled()) return;
    const rows = this.state.rows.filter((r) => (r.source === 'obs' || r.source === 'file') && Number.isFinite(r.start_ms) && recordingRole(r.name, r.path) === 'game');
    const newest = rows.sort((a, b) => b.start_ms - a.start_ms)[0];
    if (!newest) return;
    let f = this.live.follow;
    if (!f) { try { f = JSON.parse(localStorage.getItem(LIVE_FOLLOW_KEY) || 'null'); } catch { f = null; } f ??= { name: null, start: 0, ended: true }; this.live.follow = f; }
    const save = () => { try { localStorage.setItem(LIVE_FOLLOW_KEY, JSON.stringify(f)); } catch { /* storage off */ } };
    const nowServer = this.toServer(Date.now());
    if (newest.start_ms > (f.start || 0) && nowServer - newest.start_ms < 6 * 3600 * 1000) {
      Object.assign(f, { name: newest.name, start: newest.start_ms, ended: false });
      save();
      await this.resetLive(newest.start_ms - (this.offset ?? 0));
      this.live.state.apply({ at: newest.start_ms, kind: 'session', action: 'start', name: newest.name });
      await this.pushLive(true);
      this.changed('live');
      this.notify('Recording started on the recording computer: a new stream session.');
      return;
    }
    if (f.name === newest.name && !f.ended && newest.duration > 0) {
      f.ended = true;
      save();
      const s = this.live.state;
      s.apply({ at: nowServer, kind: 'session', action: 'stop', name: newest.name, seconds: newest.duration, kills: s.kills, questsDone: s.questsDone, deaths: s.deaths });
      await this.pushLive(true);
      this.changed('live');
      this.notify('Recording stopped: the stream session is complete.');
    }
  }
}

// Companion OBS settings merged by key, so new defaults reach old saves.
function mergeMore(base, saved) {
  const out = (base || []).map((b) => ({ ...b, ...((saved || []).find((s) => s.key === b.key) || {}) }));
  for (const s of saved || []) if (!out.some((o) => o.key === s.key)) out.push(s);
  return out;
}


function latest(rows) {
  let max = '1970-01-01T00:00:00Z';
  for (const r of rows) if (r.updated_at && r.updated_at > max) max = r.updated_at;
  return max;
}
