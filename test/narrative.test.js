// The Journal: short in-character entries from a character's logged events.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters } from '../web/lib/journey.js';
import { buildCodex } from '../web/lib/codex.js';
import { journalEntries, narrativeText } from '../web/lib/narrative.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: e.e === 'session_start' ? { rec: 'take.mp4', offset: 12 } : null });
const OUT_OF_WORLD = /\b(session|log|addon|footage|screenshot|recording|XP|note|timestamp|the game)s?\b|\d+%/i;
const sentencesOf = (text) => text.split(/(?<=[.?…]["”]?)\s+(?=[A-Z"“])/).filter(Boolean);
const wordsOf = (s) => s.trim().split(/\s+/).length;

const storyline = {
  id: 7, name: 'The Kobold Camp', zones: ['Elwynn Forest'], done: 1, total: 1,
  quests: [{ q: { id: 7, n: 'Kobold Camp Cleanup', l: 1, o: 'Kill 10 Kobold Vermin' }, state: 'done' }],
};

function journal(sex = 'male', storylines = [storyline]) {
  const world = buildWorld(sessions, log.items, moment);
  const codex = buildCodex(sessions);
  const [character] = buildCharacters(sessions, moment);
  character.info.sex = sex;
  return { character, result: journalEntries({ character, sessions, world, codex, storylines, moment }) };
}

test('journal: one short session entry, in his own words, with the things that mattered', () => {
  const { character, result } = journal();
  assert.equal(character.name, 'Aldric');
  assert.equal(result.title, 'The journal of Aldric');
  const entries = result.entries.filter((e) => e.kind === 'session');
  assert.equal(entries.length, 1, 'one entry per session');
  const [en] = entries;
  assert.equal(en.session, sessions[0].id);
  assert.equal(en.id, `s-${sessions[0].id}`);
  assert.ok(Number.isFinite(en.t));
  assert.deepEqual(en.footage, { rec: 'take.mp4', offset: 12 }, 'footage from the moment the entry opens on');
  assert.match(en.title, /Elwynn Forest/);
  const sentences = sentencesOf(en.text);
  assert.ok(sentences.length >= 2 && sentences.length <= 5, `2 to 5 sentences: ${sentences.length}\n${en.text}`);
  assert.match(sentences[0], /Northshire Valley, Elwynn Forest/, 'opens with where he was');
  assert.match(en.text, /Kobold Camp Cleanup/);
  assert.match(en.text, /Deputy Willem/);
  const death = sentences.find((s) => /Hogger/.test(s));
  assert.ok(death, 'Hogger is named');
  assert.match(death, /killed|fell to|got the better of/, 'in a death sentence');
  assert.match(en.text, /reached level 2|level 2 came|enough for level 2/i);
  assert.match(en.text, /\b(I|me|my)\b/, 'first person: his own account');
  assert.doesNotMatch(en.text, /\b(he|him|his|they|their|them)\b/i, 'never about him from outside');
  assert.doesNotMatch(en.text, /!/, 'no exclamation marks');
  assert.doesNotMatch(en.text, /\$[NCRG]/, 'no raw tokens');
  assert.match(sentences.at(-1), /Mother Fang was still out there|could wait|still waiting|still had|left .* to see to/, 'closes looking ahead');
});

test('journal: nothing from outside the world, sentences short, openers vary', () => {
  const { result } = journal();
  assert.ok(result.entries.length >= 2);
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
});

test('journal: a finished storyline gets its own entry after the session', () => {
  const { result } = journal();
  const kinds = result.entries.map((e) => e.kind);
  assert.deepEqual(kinds, ['session', 'storyline']);
  const story = result.entries[1];
  assert.equal(story.id, 'story-7');
  assert.equal(story.title, 'The end of The Kobold Camp');
  assert.ok(story.t >= result.entries[0].t, 'sorted by time, newest last');
  assert.equal(story.t, sessions[0].events.find((e) => e.e === 'quest_turnin').t, 'the time of the last turn-in');
  const sentences = sentencesOf(story.text);
  assert.ok(sentences.length >= 3 && sentences.length <= 6, `3 to 6 sentences: ${story.text}`);
  assert.match(sentences[0], /began|started|took up/);
  assert.match(sentences[0], /Northshire Valley/, 'where it began');
  assert.match(story.text, /Deputy Willem/);
  assert.match(story.text, /You have done well, Aldric/, 'the reward text, with the $N token filled in');
  // An unfinished storyline has no entry.
  const partial = journal('male', [{ ...storyline, done: 0, total: 1 }]).result;
  assert.deepEqual(partial.entries.map((e) => e.kind), ['session']);
});

test('journal: first person whatever the sex, the NPC lines still addressed to her', () => {
  const her = journal('female').result.entries.map((e) => e.text).join(' ');
  assert.match(her, /\b(I|me|my)\b/);
  assert.doesNotMatch(her, /\b(he|him|his|she|they|them|their)\b/i);
  const unknown = journal(null).result.entries[0].text;
  assert.match(unknown, /\b(I|me|my)\b/, 'the sex does not matter to a first-person account');
});

test('journal: quests carry over between days, kills fold into a count, a finished zone is noted', () => {
  const day = 1790000000;
  const ev = (t, extra) => ({ t: day + t, z: 'Elwynn Forest', ...extra });
  const quest = (id, title) => `${id}:${title}`;
  const s1 = { id: 'a', started: day, char: { name: 'Brann', realm: 'Mankrik', class: 'Warrior', sex: 3 }, events: [
    ev(0, { e: 'session_start', sz: 'Northshire Valley' }),
    ev(10, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(20, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(30, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(31, { e: 'loot', id: 1, name: 'Ornate Blade', n: 1, q: 3, src: 'loot' }),
    ev(40, { e: 'quest_accept', qid: 12, title: 'The Forgotten Heirloom' }),
    ev(41, { e: 'quest_accept', qid: 13, title: 'Wolves Across the Border' }),
    ev(50, { e: 'screenshot', reason: 'level' }),
  ] };
  const s2 = { id: 'b', started: day + 86400, char: { name: 'Brann', realm: 'Mankrik', sex: 3 }, events: [
    ev(86400, { e: 'session_start', sz: 'Goldshire' }),
    ev(86401, { e: 'vendor', npc: 'Innkeeper Farley' }),
    ev(86402, { e: 'money', delta: 150, total: 1150 }),
    ev(86403, { e: 'mystery_event', foo: 1 }),
  ] };
  const other = { id: 'c', started: day, char: { name: 'Aldric', realm: 'Mankrik' }, events: [ev(1, { e: 'kill', name: 'Wolf' })] };
  const character = { key: 'Brann-Mankrik', name: 'Brann', realm: 'Mankrik', info: { class: 'Warrior', sex: 'female' } };
  const result = journalEntries({ character, sessions: [other, s2, s1], moment });
  assert.deepEqual(result.entries.map((e) => e.id), ['s-a', 's-b']);
  const [d1, d2] = result.entries;
  assert.equal(d1.title, 'Day 1, Elwynn Forest');
  assert.equal(d2.title, 'Day 2, Elwynn Forest');
  assert.match(d1.text, /three Kobold Vermin/i, 'kills fold into one count');
  assert.equal((d1.text.match(/three Kobold Vermin/gi) || []).length, 1);
  assert.match(d1.text, /a rare Ornate Blade/, 'a quality-3 find is worth a line');
  assert.match(d1.text, /The Forgotten Heirloom and Wolves Across the Border/, 'the quests still to do close the entry');
  assert.match(d2.text, /The Forgotten Heirloom and Wolves Across the Border/, 'and are still open the next day');
  assert.match(d2.text, /Innkeeper Farley|silver/, 'a small thing is mentioned when nothing bigger happened');
  assert.ok(!(/Innkeeper Farley/.test(d2.text) && /silver/.test(d2.text)), 'but only one of them');
  assert.doesNotMatch(d1.text + d2.text, /Wolf\b|Aldric|mystery_event|150/);
  assert.doesNotMatch(d1.text + d2.text, /\b(he|him|his|she|they|them|their)\b/i);
  assert.match(d1.text + d2.text, /\b(I|me|my)\b/);

  // Five quests found and all done in a zone: a zone entry, dated by the last turn-in.
  const zoneEvents = [ev(200000, { e: 'session_start', z: 'Westfall', sz: 'Sentinel Hill' }), ev(200001, { e: 'explore', z: 'Westfall', area: 'Sentinel Hill' })];
  for (let i = 0; i < 5; i++) {
    zoneEvents.push(ev(200010 + i * 10, { e: 'quest_accept', z: 'Westfall', qid: 100 + i, title: `Westfall errand ${i + 1}` }));
    zoneEvents.push(ev(200015 + i * 10, { e: 'quest_turnin', z: 'Westfall', qid: 100 + i, title: `Westfall errand ${i + 1}` }));
  }
  zoneEvents.push(ev(200100, { e: 'death', z: 'Westfall', killer: 'Defias Pillager' }));
  const s3 = { id: 'd', started: day + 200000, char: { name: 'Brann', realm: 'Mankrik', sex: 3 }, events: zoneEvents };
  const withZone = journalEntries({ character, sessions: [s1, s2, s3], moment });
  const d3 = withZone.entries.find((e) => e.id === 's-d');
  assert.match(d3.text, /five quests/i, 'several turn-ins fold into one sentence');
  assert.ok(sentencesOf(d3.text).length <= 5, d3.text);
  const zone = withZone.entries.find((e) => e.kind === 'zone');
  assert.ok(zone, 'a zone entry');
  assert.equal(zone.id, 'zone-westfall');
  assert.equal(zone.t, day + 200055);
  assert.match(zone.text, /Westfall/);
  assert.match(zone.text, /five quests/);
  assert.match(zone.text, /Sentinel Hill/);
  assert.match(zone.text, /Defias Pillager/);
  const n = sentencesOf(zone.text).length;
  assert.ok(n >= 2 && n <= 4, zone.text);
  assert.equal(withZone.entries.at(-1).kind, 'zone', 'after the day it was finished on... or the same time, but never before');
  assert.ok(withZone.entries.at(-1).t >= withZone.entries.at(-2).t);
  assert.ok(!withZone.entries.some((e) => e.kind === 'zone' && /Elwynn/.test(e.title)), 'Elwynn Forest still has quests open');
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
