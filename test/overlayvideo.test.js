import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionsFromSavedVariables } from '../web/lib/sessions.js';
import { OverlayScene, overlayEvents, firstTimes, hms, avcCodec, themeFor } from '../web/lib/overlayvideo.js';

const sessions = sessionsFromSavedVariables(readFileSync(new URL('./fixtures/Compendium.lua', import.meta.url), 'utf8'));

// A recording over the first two minutes of the fixture session.
function recording(seconds = 120) {
  const s = sessions[0];
  const start = s.events[0].t * 1000;
  const timeline = s.events.filter((e) => e.t * 1000 - start <= seconds * 1000).map((e) => ({ ...e, offset: (e.t * 1000 - start) / 1000 }));
  return { rec: { id: 'r1', name: '2026-09-25 20-15-42.mkv', duration: seconds, start }, timeline };
}

// A 2D context that measures but draws nothing, counting the calls.
function fakeContext() {
  const calls = {};
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'calls') return calls;
      return () => { calls[k] = (calls[k] || 0) + 1; };
    },
    set: () => true,
  });
  return ctx;
}

test('overlayEvents: the timeline becomes the live link\'s events, new things flagged', () => {
  const { rec, timeline } = recording();
  const events = overlayEvents(rec, timeline, { firsts: firstTimes(sessions), character: { name: 'Aldric', race: 'Human', level: 1 } });
  assert.equal(events[0].kind, 'begin');
  assert.equal(events[0].name, 'Aldric');
  assert.ok(events.some((e) => e.kind === 'session' && e.action === 'start' && e.at === 0));
  const stop = events.at(-1);
  assert.equal(stop.kind, 'session');
  assert.equal(stop.action, 'stop');
  assert.equal(stop.at, 120000);
  const loot = events.filter((e) => e.kind === 'loot');
  assert.ok(loot.length > 0);
  assert.ok(loot.every((e) => e.novel === true), 'the account\'s first drops of each item are new');
  const kills = events.filter((e) => e.kind === 'kill');
  assert.ok(kills.length > 1);
  assert.equal(kills.filter((e) => e.novel).length, new Set(kills.map((e) => e.name)).size, 'one FIRST HUNT per creature');
  assert.ok(events.some((e) => e.kind === 'quest' && e.action === 'progress' && /\d+\/\d+/.test(e.text)));
  assert.ok(events.some((e) => e.kind === 'quest' && e.action === 'turnin'));
  for (let i = 1; i < events.length; i++) assert.ok(events[i].at >= events[i - 1].at, 'in time order');
});

test('overlayEvents: without the account history nothing is new; bought and made items do not toast', () => {
  const rec = { name: 'x.mkv', duration: 10 };
  const events = overlayEvents(rec, [
    { e: 'loot', id: 1, name: 'A', q: 1, n: 1, offset: 1, t: 1 },
    { e: 'loot', id: 2, name: 'B', q: 1, n: 1, offset: 2, t: 2, src: 'bought' },
    { e: 'loot', id: 3, name: 'C', q: 1, n: 1, offset: 3, t: 3, src: 'created' },
    { e: 'kill', name: 'Boar', npcId: 5, offset: 4, t: 4 },
  ]);
  assert.deepEqual(events.filter((e) => e.kind === 'loot').map((e) => e.id), [1]);
  assert.equal(events.find((e) => e.kind === 'loot').novel, false);
  assert.equal(events.find((e) => e.kind === 'kill').novel, false);
});

test('scene: steps through the recording, the totals match the live link, frames are marked dirty only when something moves', () => {
  const { rec, timeline } = recording();
  const events = overlayEvents(rec, timeline, { firsts: firstTimes(sessions), character: { name: 'Aldric', race: 'Human', level: 1 } });
  const ctx = fakeContext();
  const scene = new OverlayScene({ width: 3840, height: 2160, race: 'Human', counters: [{ id: 1372, name: 'Ragged Leather Vest', mode: 'ongoing', base: 2 }] });
  scene.load(events);
  assert.equal(scene.k, 2);
  assert.equal(scene.W, 1920);
  let dirty = 0;
  const fps = 30;
  for (let i = 0; i < 120 * fps; i++) { if (scene.step((i * 1000) / fps)) { dirty++; scene.draw(ctx); } }
  const kills = events.filter((e) => e.kind === 'kill').length;
  assert.equal(scene.live.kills, kills);
  assert.equal(scene.live.questsDone, events.filter((e) => e.kind === 'quest' && e.action === 'turnin').length);
  assert.ok(dirty < 120 * fps, 'quiet stretches reuse the previous frame');
  assert.ok(dirty >= 120, 'the timer changes every second');
  assert.ok(ctx.calls.fillText > 0 && ctx.calls.fillRect > 0);
  // A long quiet stretch after the last event: only the timer ticks.
  const s2 = new OverlayScene({ width: 1920, height: 1080 });
  s2.load([{ at: 0, kind: 'begin', name: 'A' }]);
  let d2 = 0;
  for (let i = 0; i < 10 * fps; i++) if (s2.step((i * 1000) / fps)) d2++;
  assert.equal(d2, 10);
});

test('scene: the session stop callout carries the totals, and the widgets follow the layout', () => {
  const scene = new OverlayScene({ width: 1920, height: 1080, layout: { show: ['kills', 'callouts', 'timer'], kills: 'tr', timer: 'bc' } });
  scene.load([
    { at: 0, kind: 'begin', name: 'A' },
    { at: 100, kind: 'kill', name: 'Boar', npcId: 1 },
    { at: 200, kind: 'kill', name: 'Boar', npcId: 1 },
    { at: 300, kind: 'quest', action: 'turnin', qid: 1, title: 'Q' },
    { at: 5000, kind: 'session', action: 'stop', name: 'x', seconds: 5 },
  ]);
  for (let t = 0; t <= 5100; t += 100) scene.step(t);
  const stop = scene.events.find((e) => e.kind === 'session' && e.action === 'stop');
  assert.equal(stop.kills, 2);
  assert.equal(stop.questsDone, 1);
  // callouts queue in order; the first (session start is not in this list) is the quest
  assert.ok(scene.callout || scene.queue.length);
  const ctx = fakeContext();
  scene.draw(ctx);
  assert.ok(ctx.calls.fillText > 0);
  assert.equal(scene.show.has('toasts'), false);
});

test('helpers: clock text, H.264 levels, race themes', () => {
  assert.equal(hms(0), '00:00:00');
  assert.equal(hms(3723000), '01:02:03');
  assert.equal(avcCodec(1920, 1080, 30), 'avc1.640028');
  assert.equal(avcCodec(1920, 1080, 60), 'avc1.64002a');
  assert.equal(avcCodec(3840, 2160, 30), 'avc1.640033');
  assert.equal(avcCodec(3840, 2160, 60), 'avc1.640034');
  assert.equal(themeFor('orc').name, 'Orc');
  assert.equal(themeFor(null).name, null);
  assert.equal(themeFor('Scourge').gold, '#8dff7b');
});
