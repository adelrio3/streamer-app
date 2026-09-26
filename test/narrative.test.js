// The Journal: one first-person entry per outing, built from a character's logged events.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters } from '../web/lib/journey.js';
import { buildCodex } from '../web/lib/codex.js';
import { indexDB } from '../web/lib/questdb.js';
import { journalEntries, narrativeText } from '../web/lib/narrative.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'data', 'classic', name), 'utf8'));
const db = indexDB({ quests: json('quests.json').quests, npcs: json('npcs.json').npcs, objects: json('objects.json').objects, items: json('items.json').items, zones: json('zones.json').zones });
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: e.e === 'session_start' ? { rec: 'take.mp4', offset: 12 } : null });
const OUT_OF_WORLD = /\b(session|log|addon|footage|screenshot|recording|XP|note|timestamp|the game|quest|quests|completed)s?\b|\d+%/i;
const sentencesOf = (text) => text.split(/(?<=[.?…]["”]?)\s+(?=[A-Z"“])/).filter(Boolean);
const wordsOf = (s) => s.trim().split(/\s+/).length;

function journal(sex = 'male') {
  const world = buildWorld(sessions, log.items, moment);
  const codex = buildCodex(sessions);
  const [character] = buildCharacters(sessions, moment);
  character.info.sex = sex;
  return { character, result: journalEntries({ character, sessions, world, codex, db, moment }) };
}

test('journal: one entry per outing, in his own words, the errand retold and never named', () => {
  const { character, result } = journal();
  assert.equal(character.name, 'Aldric');
  assert.equal(result.title, 'The journal of Aldric');
  assert.equal(result.entries.length, 1, 'one entry per outing, nothing else');
  const [en] = result.entries;
  assert.equal(en.kind, 'session');
  assert.equal(en.session, sessions[0].id);
  assert.equal(en.id, `s-${sessions[0].id}`);
  assert.deepEqual(en.footage, { rec: 'take.mp4', offset: 12 }, 'footage from the moment the entry opens on');
  assert.match(en.title, /Elwynn Forest/);
  assert.equal(en.paragraphs.length, 1, 'a short outing is one paragraph');
  const sentences = sentencesOf(en.text);
  assert.ok(sentences.length >= 2 && sentences.length <= 5, `2 to 5 sentences: ${sentences.length}\n${en.text}`);
  assert.match(sentences[0], /Northshire Valley, Elwynn Forest/, 'opens with where he was');
  assert.doesNotMatch(en.text, /Kobold Camp Cleanup/, 'the errand is not named like a list entry');
  assert.match(en.text, /For Deputy Willem I thinned ten Kobold Vermin|Deputy Willem sent me to thin ten Kobold Vermin|thinned ten Kobold Vermin for Deputy Willem/, 'the errand retold as a deed');
  assert.match(en.text, /Hogger/, 'the death is named');
  assert.match(en.text, /\b(I|me|my)\b/, 'first person');
  assert.doesNotMatch(en.text, /\b(he|him|his|they|their|them)\b/i, 'never about him from outside');
  assert.doesNotMatch(en.text, /!/, 'no exclamation marks');
  assert.doesNotMatch(en.text, /\$[NCRG]/, 'no raw tokens');
});

test('journal: nothing from outside the world, sentences short, openers vary', () => {
  const { result } = journal();
  let prev = null;
  for (const en of result.entries) {
    assert.doesNotMatch(en.text, OUT_OF_WORLD, `${en.kind}: ${en.text}`);
    assert.doesNotMatch(en.title, OUT_OF_WORLD);
    for (const s of sentencesOf(en.text)) {
      assert.ok(wordsOf(s) <= 28, `no sentence over 28 words: ${s}`);
      const first = s.split(/\s+/)[0].toLowerCase();
      assert.notEqual(first, prev, `consecutive sentences open differently: ${s}`);
      prev = first;
    }
  }
  const her = journal('female').result.entries[0].text;
  assert.match(her, /\b(I|me|my)\b/);
  assert.doesNotMatch(her, /\b(he|him|his|she|they|them|their)\b/i);
});

test('journal: the length follows the outing; quiet days get a line, busy days a few paragraphs', () => {
  const day = 1790000000;
  const ev = (t, extra) => ({ t: day + t, z: 'Durotar', ...extra });
  const character = { key: 'Vesch-Mankrik', name: 'Vesch', realm: 'Mankrik', info: { class: 'Hunter', sex: 'male' } };
  const quest = (t, id) => {
    const q = db.quests.get(id);
    return [ev(t, { e: 'quest_detail', qid: id, title: q.n, npc: db.npc(q.s?.[0])?.n, obj: q.o }), ev(t + 1, { e: 'quest_accept', qid: id, title: q.n }), ev(t + 2, { e: 'quest_complete', qid: id, title: q.n, npc: db.npc((q.e || q.s)?.[0])?.n }), ev(t + 3, { e: 'quest_turnin', qid: id, title: q.n })];
  };
  // A long, mostly idle outing with one errand: one paragraph.
  const idle = { id: 'idle', started: day, char: { name: 'Vesch', realm: 'Mankrik' }, events: [ev(0, { e: 'session_start', sz: 'Valley of Trials' }), ...quest(10, 4641), ev(7200, { e: 'vendor', npc: 'Duokna' }), ev(7300, { e: 'money', delta: 150 }), ev(7400, { e: 'session_end' })] };
  const one = journalEntries({ character, sessions: [idle], db, moment }).entries[0];
  assert.equal(one.paragraphs.length, 1);
  assert.ok(sentencesOf(one.text).length <= 4, one.text);
  assert.match(one.text, /carried word to Gornek/, 'the errand as a deed');
  // Nothing done at all: a quiet line.
  const nothing = { id: 'nil', started: day + 86400, char: { name: 'Vesch', realm: 'Mankrik' }, events: [ev(86400, { e: 'session_start', sz: 'Razor Hill' }), ev(86500, { e: 'vendor', npc: 'Duokna' })] };
  const none = journalEntries({ character, sessions: [nothing], db, moment }).entries[0];
  assert.match(none.text, /Not much came of|quiet|little came of it/i);
  assert.ok(sentencesOf(none.text).length <= 3, none.text);
  // A busy outing: seven errands, a death and a level: up to three paragraphs, deeds grouped by who asked.
  const events = [ev(0, { e: 'session_start', sz: 'Valley of Trials' })];
  let t = 1;
  for (const id of [4641, 788, 789, 4402, 3082, 6394, 6002]) { events.push(...quest(t, id)); t += 10; }
  events.push(ev(t++, { e: 'level', level: 4 }), ev(t++, { e: 'death', killer: 'Sarkoth', sz: 'Hidden Path' }), ev(t++, { e: 'quest_detail', qid: 790, npc: 'Zureetha Fargaze' }), ev(t++, { e: 'quest_accept', qid: 790, title: 'Vile Familiars' }));
  const busy = { id: 'busy', started: day + 2 * 86400, char: { name: 'Vesch', realm: 'Mankrik' }, events };
  const en = journalEntries({ character, sessions: [busy], db, moment }).entries[0];
  assert.ok(en.paragraphs.length >= 2 && en.paragraphs.length <= 3, `${en.paragraphs.length} paragraphs`);
  assert.match(en.text, /For Gornek I|Gornek sent me to|for Gornek\.|Gornek had work for me/, 'deeds grouped by who asked');
  assert.match(en.text, /brought back ten Scorpid Worker Tails|brought Gornek ten Scorpid Worker Tails/);
  assert.match(en.text, /Galgar/);
  assert.doesNotMatch(en.text, /Galgar ten Cactus Apples for Galgar/, 'no doubled name');
  assert.doesNotMatch(en.text, /Sting of the Scorpid|Cactus Apple Surprise|Your Place In The World/, 'never a title');
  assert.match(en.text, /Sarkoth/);
  assert.match(en.text, /level 4/);
  assert.match(en.paragraphs.at(-1), /Zureetha Fargaze/, 'closes on who still has work for me');
  assert.doesNotMatch(en.text, OUT_OF_WORLD, en.text);
  assert.equal(en.title, 'Day 1, Durotar');
  // Kills fold into a count when no errand tells of them, and only sessions of this character count.
  const other = { id: 'c', started: day, char: { name: 'Aldric', realm: 'Mankrik' }, events: [ev(1, { e: 'kill', name: 'Wolf' })] };
  const hunt = { id: 'h', started: day + 3 * 86400, char: { name: 'Vesch', realm: 'Mankrik' }, events: [ev(3 * 86400, { e: 'session_start', sz: 'Razor Hill' }), ev(3 * 86400 + 1, { e: 'kill', name: 'Scorpid Worker' }), ev(3 * 86400 + 2, { e: 'kill', name: 'Scorpid Worker' }), ev(3 * 86400 + 3, { e: 'kill', name: 'Scorpid Worker' }), ev(3 * 86400 + 4, { e: 'loot', id: 1, name: 'Ornate Blade', n: 1, q: 3, src: 'loot' })] };
  const r = journalEntries({ character, sessions: [other, hunt], db, moment });
  assert.deepEqual(r.entries.map((e) => e.id), ['s-h']);
  assert.match(r.entries[0].text, /three Scorpid Worker/i);
  assert.match(r.entries[0].text, /a rare Ornate Blade/);
  assert.doesNotMatch(r.entries[0].text, /Wolf\b|Aldric/);
});

test('journal: markdown export', () => {
  const { result } = journal();
  const md = narrativeText(result);
  assert.ok(md.startsWith('# The journal of Aldric\n'), 'starts with the journal heading');
  for (const en of result.entries) {
    assert.ok(md.includes(`\n## ${en.title}\n`));
    assert.ok(md.includes(en.text));
  }
  assert.equal(narrativeText({ entries: [] }), '# Journal\n');
});
