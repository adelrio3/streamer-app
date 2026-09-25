// CloudStore against a small fake of the supabase-js query builder, and the
// Netlify config function.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudStore, measureClock } from '../web/lib/cloud.js';
import { projectUrl } from '../netlify/functions/config.mjs';

export function fakeClient() {
  const tables = { sessions: [], recordings: [], clock_samples: [], settings: [] };
  const keys = { sessions: ['user_id', 'id'], recordings: ['user_id', 'name'], settings: ['user_id'] };
  const query = (table) => {
    let rows = () => tables[table];
    const q = {
      select() { return q; },
      order(col, { ascending }) { const prev = rows; rows = () => [...prev()].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1)); return q; },
      gt(col, v) { const prev = rows; rows = () => prev().filter((r) => r[col] > v); return q; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      upsert(row, { onConflict }) {
        assert.equal(onConflict, keys[table].join(','));
        const i = tables[table].findIndex((r) => keys[table].every((k) => r[k] === row[k]));
        if (i >= 0) tables[table][i] = { ...tables[table][i], ...row }; else tables[table].push(row);
        return Promise.resolve({ error: null });
      },
      insert(row) { tables[table].push(row); return Promise.resolve({ error: null }); },
    };
    return q;
  };
  return { tables, from: query, rpc: async (name) => (name === 'server_time' ? { data: Date.now() + 5000, error: null } : { error: { message: 'no' } }) };
}

test('stores and reloads sessions, recordings, clock samples and settings', async () => {
  const client = fakeClient();
  const store = new CloudStore(client, 'u1');
  await store.saveSession({ id: 's1', started: 5, char: { name: 'A' }, build: {}, events: [{ e: 'kill', t: 1 }] }, 'Gaming PC');
  await store.saveSession({ id: 's1', started: 5, char: { name: 'A' }, build: {}, events: [{ e: 'kill', t: 1 }, { e: 'kill', t: 2 }] }, 'Gaming PC');
  await store.saveRecording({ name: 'a.mp4', start_ms: 1, end_ms: 2, source: 'obs' });
  await store.addClockSample('Gaming PC', 12, 40);
  await store.saveSettings({ fps: 30 });
  const all = await store.loadAll();
  assert.equal(all.sessions.length, 1);
  assert.equal(all.sessions[0].events.length, 2);
  assert.equal(all.sessions[0].machine, 'Gaming PC');
  assert.equal(client.tables.sessions[0].event_count, 2);
  assert.equal(all.recordings[0].user_id, 'u1');
  assert.equal(all.clock[0].offset_ms, 12);
  assert.deepEqual(all.settings, { fps: 30 });
  const changed = await store.changedSince('1970-01-01T00:00:00Z');
  assert.equal(changed.sessions.length, 1);
});

test('pages through more than 1000 rows', async () => {
  const client = fakeClient();
  for (let i = 0; i < 2500; i++) client.tables.clock_samples.push({ machine: 'm', offset_ms: i, measured_at: String(i).padStart(5, '0') });
  const all = await new CloudStore(client, 'u').loadAll();
  assert.equal(all.clock.length, 2500);
});

test('clock measurement keeps the fastest round trip', async () => {
  let t = 0;
  const trips = [30, 10, 50];
  let i = 0;
  const m = await measureClock(async () => { const server = t + 1000 + trips[i] / 2; t += trips[i++]; return server; }, 3, () => t);
  assert.equal(m.rtt, 10);
  assert.equal(m.offset, 1000);
});

test('config function turns any Supabase URL form into the project URL', () => {
  assert.equal(projectUrl('https://abcd.supabase.co/'), 'https://abcd.supabase.co');
  assert.equal(projectUrl('postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres'), 'https://abcd.supabase.co');
  assert.equal(projectUrl('postgresql://postgres.abcd:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres'), 'https://abcd.supabase.co');
  assert.equal(projectUrl(undefined), null);
});
