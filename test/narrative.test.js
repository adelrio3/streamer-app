// The Journal: a character's logged events told as a story.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters } from '../web/lib/journey.js';
import { buildCodex } from '../web/lib/codex.js';
import { narrate, narrativeText } from '../web/lib/narrative.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: e.e === 'kill' ? { rec: 'take.mp4', offset: 12 } : null });

function journal() {
  const world = buildWorld(sessions, log.items, moment);
  const codex = buildCodex(sessions);
  const [character] = buildCharacters(sessions, moment);
  return { character, result: narrate({ character, sessions, world, codex, moment }) };
}

test('journal: chapters of prose from the simulated session', () => {
  const { character, result } = journal();
  assert.equal(character.name, 'Aldric');
  assert.ok(result.chapters.length >= 1, 'at least one chapter');
  const [ch] = result.chapters;
  assert.equal(ch.zone, 'Elwynn Forest');
  assert.equal(ch.title, 'Elwynn Forest, the first day');
  assert.ok(ch.started <= ch.ended);
  for (const c of result.chapters) {
    assert.ok(c.paragraphs.length >= 1, `${c.title} has paragraphs`);
    for (const p of c.paragraphs) {
      assert.equal(typeof p.text, 'string');
      assert.ok(p.text.trim().length > 0, 'paragraph is not empty');
      assert.match(p.text, /[.!?…]["”]?$/, `ends with punctuation: ${p.text.slice(-30)}`);
      assert.ok(Number.isFinite(p.t), 'paragraph has a numeric t');
      assert.equal(p.session, sessions[0].id);
    }
  }
  const text = result.chapters.flatMap((c) => c.paragraphs.map((p) => p.text)).join('\n');
  assert.match(text, /\b2 Kobold Vermin\b/, 'the kobold kills fold into a count');
  assert.doesNotMatch(text, /a Kobold Vermin.*a Kobold Vermin/s, 'not listed twice');
  assert.match(text, /Ragged Leather Vest/, 'the loot is mentioned');
  assert.match(text, /level 2/i, 'the level-up is mentioned');
  assert.match(text, /Hogger/, 'the death names the killer');
  assert.match(text, /Mother Fang/, 'the rare is called out');
  assert.match(text, /Goldshire/, 'the discovery names the area');
  assert.match(text, /Brother Danil/, 'the vendor is mentioned');
  assert.equal((text.match(/Brother Danil's/g) || []).length, 1, 'the shop is mentioned once');
  assert.match(text, /Deputy Willem/, 'the quest giver is named');
  assert.match(text, /You have done well, Aldric/, 'the reward text, with the $N token filled in');
  assert.match(text, /bought|coming away with 200 Rough Arrow/, 'bought items say so');
  assert.match(text, /25c/, 'money is summarized');
  assert.equal((text.match(/25c/g) || []).length, 1, 'once per chapter, not per event');
  assert.doesNotMatch(text, /\$[NCRG]/, 'no raw tokens');
  assert.doesNotMatch(text, /\b(he|she|his|her)\b/i, 'no assumed pronouns');
});

test('journal: the quest is mentioned when taken and when handed in', () => {
  const { result } = journal();
  const paragraphs = result.chapters.flatMap((c) => c.paragraphs);
  const taken = paragraphs.find((p) => p.kinds.includes('quest_accept'));
  const done = paragraphs.find((p) => p.kinds.includes('quest_turnin'));
  assert.ok(taken && done);
  assert.match(taken.text, /Kobold Camp Cleanup/);
  assert.match(done.text, /Kobold Camp Cleanup/);
  assert.notEqual(taken, done);
});

test('journal: footage from the paragraph-opening event, facts per chapter', () => {
  const { result } = journal();
  const [ch] = result.chapters;
  assert.deepEqual(ch.facts, { kills: 3, quests: 1, drops: 3, deaths: 1, levels: [2] });
  const withKill = ch.paragraphs.find((p) => p.kinds[0] === 'kill');
  if (withKill) assert.deepEqual(withKill.footage, { rec: 'take.mp4', offset: 12 });
  const paragraphs = ch.paragraphs;
  for (let i = 1; i < paragraphs.length; i++) assert.ok(paragraphs[i].t >= paragraphs[i - 1].t, 'in time order');
  for (let i = 1; i < paragraphs.length; i++) {
    assert.notEqual(paragraphs[i].text.split(' ').slice(0, 2).join(' '), paragraphs[i - 1].text.split(' ').slice(0, 2).join(' '), 'paragraphs do not open the same way twice running');
  }
});

test('journal: chapters split on a new zone and on a long break; other characters are left out', () => {
  const day = 1790000000;
  const ev = (t, extra) => ({ t: day + t, z: 'Elwynn Forest', ...extra });
  const s1 = { id: 'a', started: day, char: { name: 'Aldric', realm: 'Mankrik', class: 'Paladin' }, events: [
    ev(0, { e: 'session_start', sz: 'Northshire Valley' }),
    ev(10, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(20, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(30, { e: 'kill', name: 'Kobold Vermin', npcId: 6 }),
    ev(31, { e: 'loot', id: 1, name: 'Ornate Blade', n: 1, q: 3, src: 'loot' }),
    ev(100, { e: 'zone', z: 'Westfall', sz: 'Sentinel Hill' }),
    ev(101, { e: 'explore', z: 'Westfall', area: 'Sentinel Hill' }),
    ev(102, { e: 'money', z: 'Westfall', delta: 150, total: 1150 }),
    ev(103, { e: 'money', z: 'Westfall', delta: -50, total: 1100 }),
    ev(104, { e: 'quest_accept', z: 'Westfall', qid: 12, title: 'The Forgotten Heirloom' }),
  ] };
  const s2 = { id: 'b', started: day + 8 * 3600, char: { name: 'Aldric', realm: 'Mankrik' }, events: [
    ev(8 * 3600, { e: 'session_start', z: 'Westfall', sz: 'Moonbrook' }),
    ev(8 * 3600 + 5, { e: 'zone', z: 'Elwynn Forest', sz: 'Goldshire' }),
    ev(8 * 3600 + 6, { e: 'gossip', npc: 'Innkeeper Farley', text: 'Welcome, $C, to Goldshire.' }),
    ev(8 * 3600 + 7, { e: 'mystery_event', foo: 1 }),
    ev(8 * 3600 + 8, { e: 'level', level: 3 }),
  ] };
  const other = { id: 'c', started: day, char: { name: 'Brann', realm: 'Mankrik' }, events: [ev(1, { e: 'kill', name: 'Wolf' })] };
  const character = { key: 'Aldric-Mankrik', name: 'Aldric', realm: 'Mankrik', info: { class: 'Paladin' } };
  const result = narrate({ character, sessions: [other, s2, s1], moment });
  assert.deepEqual(result.chapters.map((c) => c.title), ['Elwynn Forest, the first day', 'On to Westfall', 'Another day in Westfall', 'Back to Elwynn Forest']);
  assert.deepEqual(result.chapters.map((c) => c.zone), ['Elwynn Forest', 'Westfall', 'Westfall', 'Elwynn Forest']);
  const all = result.chapters.flatMap((c) => c.paragraphs.map((p) => p.text)).join('\n');
  assert.match(all, /3 Kobold Vermin/);
  assert.match(all, /a rare Ornate Blade/, 'quality 3 gets its adjective');
  assert.match(all, /1s ?(heavier|richer)/, 'net money for the chapter');
  assert.match(all, /Welcome, paladin, to Goldshire/, 'gossip quoted with the class filled in');
  assert.match(all, /level 3/);
  assert.doesNotMatch(all, /Wolf|Brann/, 'the other character is not in this journal');
  assert.doesNotMatch(all, /mystery_event/, 'unknown kinds are ignored');
  assert.equal(result.chapters[1].facts.quests, 0);
  for (const c of result.chapters) for (const p of c.paragraphs) assert.ok(Number.isFinite(p.t));
});

test('journal: markdown export', () => {
  const { result } = journal();
  const md = narrativeText(result);
  assert.ok(md.startsWith('# '), 'starts with a heading');
  assert.match(md, /\n## Elwynn Forest, the first day\n/);
  assert.ok(md.includes(result.chapters[0].paragraphs[0].text));
  assert.equal(narrativeText({ chapters: [] }), '# Journal\n');
});
