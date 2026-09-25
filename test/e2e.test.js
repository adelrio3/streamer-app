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
  assert.equal(ingest.files[0].events, 25);

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
  assert.equal(recs[0].events, 25);
  assert.equal(recs[0].source, 'filename');
  const rec = await getJSON(`/api/recordings/${recs[0].id}`);
  assert.equal(rec.events[0].e, 'session_start');
  assert.equal(rec.events[0].offset, 10);

  const xml = await get(`/api/recordings/${recs[0].id}/export/xml`);
  assert.equal(xml.status, 200);
  assert.match(xml.headers.get('content-disposition'), /\.xml"/);
  assert.match(xml.text, /<timebase>30<\/timebase>/);
  assert.equal((xml.text.match(/<marker>/g) || []).length, 25);
  const onlyMarks = await get(`/api/recordings/${recs[0].id}/export/xml?only=mark`);
  assert.equal((onlyMarks.text.match(/<marker>/g) || []).length, 3);
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
