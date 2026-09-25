// Runs the real addon Lua against a fake WoW client (test/addon/harness.lua)
// and checks what it logged. Skipped when no Lua 5.1 interpreter is installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '../web/lib/luasv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lua = ['lua5.1', 'luajit', 'lua'].find((bin) => spawnSync(bin, ['-v']).status === 0);

test('addon logs a full play session', { skip: !lua && 'no Lua interpreter installed' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chron-')), 'Chronicler.lua');
  const run = spawnSync(lua, [path.join(root, 'test/addon/harness.lua'), path.join(root, 'addon/Chronicler'), out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const db = parseSavedVariables(fs.readFileSync(out, 'utf8')).ChroniclerDB;
  assert.equal(db.sessions.length, 1);
  const s = db.sessions[0];
  assert.equal(s.char.name, 'Aldric');
  assert.equal(s.char.classToken, 'PALADIN');
  assert.equal(s.build.interface, 11507);

  const events = s.events;
  const kinds = events.map((e) => e.e);
  assert.deepEqual(kinds, [
    'session_start', 'quest_detail', 'quest_accept', 'kill', 'kill', 'objective', 'loot', 'loot', 'speech',
    'gossip', 'book', 'quest_progress', 'quest_complete', 'quest_turnin', 'level', 'learn', 'skill',
    'zone', 'explore', 'sync', 'mark', 'mark', 'mark', 'quest_abandon', 'death', 'session_end',
  ]);

  // Timestamps are calibrated to sub-second precision after the first tick
  // and never go backwards.
  assert.ok(events.slice(1).some((e) => e.t % 1 !== 0));
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t);

  const detail = events.find((e) => e.e === 'quest_detail');
  assert.equal(detail.qid, 7);
  assert.equal(detail.npc, 'Deputy Willem');
  assert.equal(detail.npcId, 823);
  assert.match(detail.text, /cleansing\.\nA clan/);
  assert.equal(detail.z, 'Elwynn Forest');
  assert.equal(detail.x, 48);

  assert.equal(events.find((e) => e.e === 'quest_accept').title, 'Kobold Camp Cleanup');
  assert.equal(events.find((e) => e.e === 'quest_turnin').title, 'Kobold Camp Cleanup');
  assert.equal(events.find((e) => e.e === 'quest_abandon').title, 'Kobold Camp Cleanup');

  const kills = events.filter((e) => e.e === 'kill');
  assert.equal(kills.length, 2, 'killing blow + DoT kill, not the stranger kill');
  assert.equal(kills[0].blow, true);
  assert.equal(kills[1].blow, undefined);
  assert.equal(kills[0].npcId, 6);

  const loot = events.filter((e) => e.e === 'loot');
  assert.equal(loot[0].name, 'Ragged Leather Vest');
  assert.equal(loot[0].q, 0);
  assert.equal(loot[0].icon, 135009);
  assert.equal(loot[1].id, 2589);
  assert.equal(loot[1].n, 2);
  assert.equal(loot[1].q, 1, 'quality from link colour when item info is not cached');

  const speech = events.find((e) => e.e === 'speech');
  assert.equal(speech.speaker, 'Marshal McBride');
  assert.equal(speech.npcId, 197);
  assert.equal(speech.kind, 'say');

  assert.deepEqual(events.find((e) => e.e === 'book').pages, ['Here lie the brave.', 'May they rest.']);
  assert.deepEqual(events.find((e) => e.e === 'gossip').options, ['I would like to train.']);
  assert.equal(events.find((e) => e.e === 'learn').what, 'Holy Light');
  assert.equal(events.find((e) => e.e === 'learn').spellId, 635);
  assert.equal(events.find((e) => e.e === 'explore').area, 'Goldshire');
  assert.equal(events.find((e) => e.e === 'zone').sz, 'Goldshire');

  const marks = events.filter((e) => e.e === 'mark');
  assert.deepEqual(marks.map((m) => [m.kind, m.note]), [['lore', undefined], ['shot', 'sunset over the lake'], ['mark', 'wolf pathing weird']]);

  const sync = events.find((e) => e.e === 'sync');
  assert.ok(sync.t % 1 !== 0, 'sync has sub-second precision');

  assert.equal(events.find((e) => e.e === 'death').x, undefined, 'no coordinates when the map has none');
});

test('the .toc loads on the current Classic Era client (1.15.9)', () => {
  const toc = fs.readFileSync(path.join(root, 'addon/Chronicler/Chronicler.toc'), 'utf8');
  const versions = /^## Interface:(.*)$/m.exec(toc)[1].split(',').map((s) => Number(s.trim()));
  assert.ok(versions.includes(11509));
  assert.ok(/^Boot\.lua\s*$/m.test(toc) && toc.indexOf('Boot.lua') < toc.indexOf('Chronicler.lua'));
});
