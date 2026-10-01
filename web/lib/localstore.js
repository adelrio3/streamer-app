// The store the app runs on now that the Supabase database is retired: the
// same methods as the old CloudStore, with everything kept in this browser
// only. Sessions, recordings and the rest live in memory for the life of
// the tab; settings are remembered in localStorage so This computer keeps
// its choices between visits. Nothing goes over the network.

const SETTINGS_KEY = 'compendium.local.settings';

export class LocalStore {
  constructor() {
    this.userId = 'local';
    this.offset = 0;
    this.sessions = new Map();
    this.recordings = new Map();
    this.clock = [];
    this.items = new Map();
    this.voice = new Map();
    this.tracks = new Map();
    this.live = null;
    try { this.settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { this.settings = {}; }
  }

  nowIso() {
    return new Date(Date.now() + this.offset).toISOString();
  }

  async loadAll() {
    return {
      sessions: [...this.sessions.values()], recordings: [...this.recordings.values()], clock: this.clock,
      settings: this.settings, items: [...this.items.values()], schema2: true, voice: [...this.voice.values()], schema3: true,
    };
  }

  async loadTracks() {
    const out = new Map();
    for (const [id, chunks] of this.tracks) out.set(id, [...chunks.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, p]) => p));
    return out;
  }

  async saveTrack(sessionId, chunk, points) {
    if (!this.tracks.has(sessionId)) this.tracks.set(sessionId, new Map());
    this.tracks.get(sessionId).set(chunk, points);
  }

  async saveItems(rows) {
    const now = this.nowIso();
    for (const r of rows) this.items.set(r.item_id, { item_id: r.item_id, data: r.data, updated_at: now });
  }

  async saveMapImage() {
    throw new Error('Map images are not kept without a database.');
  }

  async screenshotUrls() {
    return new Map();
  }

  async changedSince() {
    return { sessions: [], recordings: [], items: [], voice: [] };
  }

  async saveSession(session, machine) {
    const now = this.nowIso();
    this.sessions.set(session.id, { ...session, machine, updated_at: now });
    return now;
  }

  async deleteSessions(ids) {
    for (const id of ids) { this.sessions.delete(id); this.tracks.delete(id); }
  }

  async deleteRecordings(names) {
    for (const n of names) this.recordings.delete(n);
  }

  async saveRecording(row) {
    const full = { ...row, user_id: this.userId, updated_at: this.nowIso() };
    this.recordings.set(row.name, full);
    return full;
  }

  async addClockSample(machine, offset, rtt) {
    const row = { machine, offset_ms: offset, rtt_ms: rtt, measured_at: new Date(Date.now() + offset).toISOString() };
    this.clock.push(row);
    return row;
  }

  async saveSettings(data) {
    this.settings = data;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* storage off */ }
  }

  async deleteAll() {
    this.sessions.clear(); this.recordings.clear(); this.items.clear(); this.voice.clear(); this.tracks.clear();
    this.clock = []; this.live = null;
  }

  async saveLive(token, machine, state) {
    this.live = { token, machine, state, updated_at: this.nowIso() };
  }

  async touchLive() {
    if (this.live) this.live.updated_at = this.nowIso();
  }

  async loadLive() {
    return this.live;
  }

  async saveVoice(rows) {
    for (const r of rows) this.voice.set(r.id, { ...r, updated_at: this.nowIso() });
  }

  async loadVoice() {
    return [...this.voice.values()];
  }

  // No server: this computer's clock is the reference.
  async serverTime() {
    return Date.now();
  }
}
