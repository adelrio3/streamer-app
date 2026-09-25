// Full path: addon SavedVariables in a fake WoW install + an OBS recording in
// a fake videos folder -> ingest -> codex, timelines, exports and media over
// the real HTTP API.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { App } from '../companion/src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function obsName(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.mp4`;
}

test('ingest, align and export through the HTTP API', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chron-e2e-'));
  const wow = path.join(tmp, 'World of Warcraft');
  const svDir = path.join(wow, '_classic_era_', 'WTF', 'Account', 'ACCOUNT1', 'SavedVariables');
  fs.mkdirSync(svDir, { recursive: true });
  fs.copyFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), path.join(svDir, 'Chronicler.lua'));

  // The fixture session runs from 1790000000 to ~1790000042. Recording
  // started 10 seconds before login and stopped 5 minutes later.
  const videos = path.join(tmp, 'Videos');
  fs.mkdirSync(videos);
  const recStart = (1790000000 - 10) * 1000;
  const video = path.join(videos, obsName(recStart));
  fs.writeFileSync(video, Buffer.alloc(4096, 7));
  fs.utimesSync(video, new Date(recStart + 300_000), new Date(recStart + 300_000));

  const app = new App({ dataDir: path.join(tmp, 'data') });
  app.store.saveConfig({ wowPaths: [wow], recordingsDir: videos, fps: 30 });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { app.stop(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers) => {
    const res = await fetch(base + p, { headers });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  const getJSON = async (p) => JSON.parse((await get(p)).text);

  const ingest = await (await fetch(`${base}/api/ingest`, { method: 'POST' })).json();
  assert.equal(ingest.files.length, 1);
  assert.equal(ingest.files[0].added, 1);
  assert.equal(ingest.files[0].events, 26);

  // Ingesting the same file again changes nothing.
  const again = await (await fetch(`${base}/api/ingest`, { method: 'POST' })).json();
  assert.equal(again.files[0].unchanged, 1);

  const status = await getJSON('/api/status');
  assert.equal(status.sessions, 1);
  assert.equal(status.recordings, 1);
  assert.equal(status.latestExpansion, 'classic');
  assert.equal(status.savedVariables[0].flavor, '_classic_era_');

  const codex = await getJSON('/api/codex');
  const quest = codex.quests.find((q) => q.qid === 7);
  assert.equal(quest.status, 'done');
  assert.equal(quest.giver.name, 'Deputy Willem');
  assert.equal(quest.reward, 'You have done well, $N.');
  assert.equal(quest.abandoned.length, 1, 'title-only abandon joins the same quest');
  assert.equal(quest.accepted[0].footage.offset > 12, true);
  const kobold = codex.creatures.find((c) => c.npcId === 6);
  assert.equal(kobold.kills, 2);
  assert.ok(codex.npcs.find((n) => n.name === 'Marshal McBride').lines[0].text.startsWith('Gnolls'));
  assert.equal(codex.books[0].pages.length, 2);
  assert.equal(codex.marks.length, 3);
  assert.equal(codex.characters[0].name, 'Aldric');
  assert.equal(codex.characters[0].level, 2);

  const recs = await getJSON('/api/recordings');
  assert.equal(recs[0].events, 26);
  assert.equal(recs[0].source, 'filename');
  const rec = await getJSON(`/api/recordings/${recs[0].id}`);
  assert.equal(rec.events[0].e, 'session_start');
  assert.equal(rec.events[0].offset, 10);

  const xml = await get(`/api/recordings/${recs[0].id}/export/xml`);
  assert.equal(xml.status, 200);
  assert.match(xml.headers.get('content-disposition'), /\.xml"/);
  assert.match(xml.text, /<timebase>30<\/timebase>/);
  assert.equal((xml.text.match(/<marker>/g) || []).length, 26);
  const onlyMarks = await get(`/api/recordings/${recs[0].id}/export/xml?only=mark`);
  assert.equal((onlyMarks.text.match(/<marker>/g) || []).length, 4, 'three marks and the sync flash');
  assert.match((await get(`/api/recordings/${recs[0].id}/export/srt`)).text, /^1\n00:00:10,000 --> /);
  assert.match((await get(`/api/recordings/${recs[0].id}/export/kills`)).text, /Kobold Vermin,6,2,2,2/);
  assert.match((await get(`/api/recordings/${recs[0].id}/export/chapters`)).text, /^00:00:00 Elwynn Forest/);

  const session = await getJSON(`/api/sessions/${encodeURIComponent(codex.marks[0].session)}`);
  assert.equal(session.events.every((e) => e.footage?.rec === recs[0].id), true);

  // Media streams with range requests; unknown ids are refused.
  const part = await get(`/media/${recs[0].id}`, { Range: 'bytes=100-199' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/4096');
  assert.equal((await get('/media/../../etc/passwd')).status, 404);
  assert.equal((await get('/media/deadbeef0000')).status, 404);

  // Static files cannot escape the public folder.
  assert.equal((await get('/index.html')).status, 200);
  assert.equal((await get('/..%2f..%2fpackage.json')).status, 404);

  const all = await (await fetch(`${base}/api/export-all`, { method: 'POST' })).json();
  assert.equal(all.files, 5);
});

test('a shorter copy of a session in the addon never loses stored events', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chron-merge-'));
  const app = new App({ dataDir: tmp });
  const base = { id: 'R-C-1', char: {}, build: {}, events: [{ e: 'kill', t: 1, name: 'A' }, { e: 'kill', t: 2, name: 'B' }] };
  assert.equal(app.store.putSession(base), 'added');
  assert.equal(app.store.putSession({ ...base, events: [{ name: 'A', t: 1, e: 'kill' }] }), 'unchanged', 'key order does not matter');
  assert.equal(app.store.putSession({ ...base, events: [{ e: 'kill', t: 3, name: 'C' }] }), 'updated');
  assert.deepEqual(app.store.session('R-C-1').events.map((e) => e.name), ['A', 'B', 'C']);
});

test('recording on a second PC: sync flash lines up footage and carries over', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chron-sync-'));
  const wow = path.join(tmp, 'wow');
  const svDir = path.join(wow, '_classic_era_', 'WTF', 'Account', 'A', 'SavedVariables');
  fs.mkdirSync(svDir, { recursive: true });
  const fixture = fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8');
  fs.writeFileSync(path.join(svDir, 'Chronicler.lua'), fixture);
  const { parseSavedVariables } = await import('../companion/src/luasv.js');
  const syncT = parseSavedVariables(fixture).ChroniclerDB.sessions[0].events.find((e) => e.e === 'sync').t;

  // The recording PC's clock runs 10 minutes behind the game PC, and the capture
  // pipeline adds 0.2 s. Recording truly started 20 s before login.
  const skew = -600_000;
  const trueStart = (1790000000 - 20) * 1000;
  const videos = path.join(tmp, 'Videos');
  fs.mkdirSync(videos);
  const mk = (startMs, lengthMs) => {
    const file = path.join(videos, obsName(startMs + skew));
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, new Date(startMs + skew + lengthMs), new Date(startMs + skew + lengthMs));
    return file;
  };
  mk(trueStart, 120_000);
  mk(trueStart + 3_600_000, 60_000); // a later recording, never synced

  const app = new App({ dataDir: path.join(tmp, 'data') });
  app.store.saveConfig({ wowPaths: [wow], recordingsDir: videos });
  app.ingest();
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { app.stop(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, opts) => (await fetch(base + p, opts)).json();

  let recs = await call('/api/recordings');
  const first = recs.sort((a, b) => a.start - b.start)[0];
  assert.equal(first.source, 'filename');
  assert.equal(first.events, 0, 'with a 10 minute clock gap nothing lines up yet');

  // Where the flash shows in the video: true offset plus capture latency.
  const flashAt = (syncT * 1000 - trueStart + 200) / 1000;
  const candidates = await call(`/api/recordings/${first.id}/sync-candidates?at=${flashAt}`);
  assert.equal(candidates[0].t, syncT);
  assert.ok(Math.abs(candidates[0].distance - 600) < 1, 'distance shows the clock gap');

  await call(`/api/recordings/${first.id}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: syncT, videoTime: flashAt }),
  });
  recs = (await call('/api/recordings')).sort((a, b) => a.start - b.start);
  assert.equal(recs[0].source, 'sync');
  assert.equal(recs[1].source, 'sync-inferred');
  assert.equal(recs[1].start - recs[0].start, 3_600_000, 'same clock gap applied to the later recording');

  const synced = await call(`/api/recordings/${recs[0].id}`);
  assert.equal(synced.events.length, 26);
  const syncEvent = synced.events.find((e) => e.e === 'sync');
  assert.ok(Math.abs(syncEvent.offset - flashAt) < 0.001, 'the flash event sits exactly on the flash frame');
  assert.equal(syncEvent.label, 'Sync flash');
  // Session start was at 1790000000: 20 s in, plus the 0.2 s pipeline delay.
  assert.ok(Math.abs(synced.events[0].offset - 20.2) < 0.001);

  // The browser reports the real length when file dates were lost in a copy.
  await call(`/api/recordings/${recs[0].id}/duration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: 300 }) });
  assert.equal((await call(`/api/recordings/${recs[0].id}`)).duration, 300);

  await call(`/api/recordings/${recs[0].id}/sync`, { method: 'DELETE' });
  recs = await call('/api/recordings');
  assert.ok(recs.every((r) => r.source === 'filename'));
});
