// Everything the app stores lives in Supabase (see supabase/schema.sql).
// Videos never leave your computers; only logs and recording times do.

const PAGE = 1000;

// Reads every row of a query, 1000 at a time (Supabase's page limit).
async function all(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function check({ error }) {
  if (error) throw new Error(error.message);
}

export class CloudStore {
  constructor(client, userId) {
    this.client = client;
    this.userId = userId;
    // This computer's clock offset from the server, once measured, so
    // updated_at stamps from both computers are comparable.
    this.offset = 0;
  }

  nowIso() {
    return new Date(Date.now() + this.offset).toISOString();
  }

  async loadAll() {
    const [sessions, recordings, clock, settings] = await Promise.all([
      all(() => this.client.from('sessions').select('*').order('started', { ascending: true })),
      all(() => this.client.from('recordings').select('*').order('start_ms', { ascending: true })),
      all(() => this.client.from('clock_samples').select('machine,offset_ms,rtt_ms,measured_at').order('measured_at', { ascending: true })),
      this.client.from('settings').select('data').maybeSingle(),
    ]);
    check(settings);
    return { sessions: sessions.map(fromRow), recordings, clock, settings: settings.data?.data ?? {} };
  }

  // Rows changed since a time (ISO string), for picking up what the other
  // computer uploaded.
  async changedSince(iso) {
    const [sessions, recordings] = await Promise.all([
      all(() => this.client.from('sessions').select('*').gt('updated_at', iso)),
      all(() => this.client.from('recordings').select('*').gt('updated_at', iso)),
    ]);
    return { sessions: sessions.map(fromRow), recordings };
  }

  async saveSession(session, machine) {
    const now = this.nowIso();
    check(await this.client.from('sessions').upsert({
      user_id: this.userId, id: session.id, started: session.started, char: session.char, build: session.build,
      expansion: session.expansion, flavor: session.flavor, account: session.account, events: session.events,
      event_count: session.events.length, machine, updated_at: now,
    }, { onConflict: 'user_id,id' }));
    return now;
  }

  async saveRecording(row) {
    const now = this.nowIso();
    const full = { ...row, user_id: this.userId, updated_at: now };
    check(await this.client.from('recordings').upsert(full, { onConflict: 'user_id,name' }));
    return full;
  }

  async addClockSample(machine, offset, rtt) {
    const row = { user_id: this.userId, machine, offset_ms: offset, rtt_ms: rtt, measured_at: new Date(Date.now() + offset).toISOString() };
    check(await this.client.from('clock_samples').insert(row));
    return row;
  }

  async saveSettings(data) {
    check(await this.client.from('settings').upsert({ user_id: this.userId, data, updated_at: this.nowIso() }, { onConflict: 'user_id' }));
  }

  // Server clock in epoch ms.
  async serverTime() {
    const { data, error } = await this.client.rpc('server_time');
    if (error) throw new Error(error.message);
    return Number(data);
  }
}

function fromRow(row) {
  return {
    id: row.id, started: row.started, char: row.char || {}, build: row.build || {}, expansion: row.expansion,
    flavor: row.flavor, account: row.account, events: row.events || [], machine: row.machine, updated_at: row.updated_at,
  };
}

// How far this computer's clock is from the server's: several round trips,
// keeping the fastest (least network noise). offset is what to add to
// Date.now() to get server time.
export async function measureClock(serverTime, rounds = 5, now = () => Date.now()) {
  let best = null;
  for (let i = 0; i < rounds; i++) {
    const t0 = now();
    const server = await serverTime();
    const t1 = now();
    const rtt = t1 - t0;
    const offset = server - (t0 + t1) / 2;
    if (!best || rtt < best.rtt) best = { offset, rtt };
  }
  return best;
}
