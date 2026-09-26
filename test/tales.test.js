// Tales: finished storylines told as storybook stories for the Lore page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { indexDB } from '../web/lib/questdb.js';
import { storylines } from '../web/lib/story.js';
import { buildCodex } from '../web/lib/codex.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters } from '../web/lib/journey.js';
import { tales, tellTale, taleText } from '../web/lib/tales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'data', 'classic', name), 'utf8'));
const db = indexDB({ quests: json('quests.json').quests, npcs: json('npcs.json').npcs, objects: json('objects.json').objects, items: json('items.json').items, zones: json('zones.json').zones });
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: null });
const codex = buildCodex(sessions);
const world = buildWorld(sessions, log.items, moment);
const characters = buildCharacters(sessions, moment);

const GAME_WORDS = /\b(quest|quests|NPC|NPCs|level|levels|XP|loot|looted|database|log|logs|player|players)\b/i;
const flat = (story) => taleText(story);
const sentences = (story) => story.parts.flatMap((p) => p.paragraphs).flatMap((p) => p.replace(/"[^"]*"/g, 'quote').split(/(?<=[.?])\s+/));

test("Galgar's Cactus Apple Surprise, told as a storybook tale", () => {
  const q = db.quests.get(4402);
  const tale = { id: 'q4402', kind: 'quest', title: q.n, zones: ['Durotar'], level: q.l, chapters: [{ q, state: 'ready' }], done: 0, total: 1, complete: false, heroes: [], startedAt: null, finishedAt: null };
  const story = tellTale(tale, { db, codex: { quests: [], characters: [] }, world: null, hero: { name: 'Zug', race: 'Troll', class: 'Hunter', sex: 'male' }, pretend: true });
  assert.equal(story.title, "Galgar's Cactus Apple Surprise");
  assert.equal(story.dedication, 'As lived by Zug');
  const text = flat(story);
  for (const word of ['Galgar', 'Durotar', 'Cactus Apple', 'Zug', 'troll', 'hunter']) assert.ok(text.includes(word), `mentions ${word}`);
  assert.ok(/\b(ten|10)\b/i.test(text), 'ten apples');
  assert.ok(story.parts[0].paragraphs[0].startsWith('Once'), 'opens like a storybook');
  assert.ok(/\bhe\b/.test(text) && !/\bthey\b/i.test(text), 'he, never they');
  assert.ok(story.ending.endsWith('The end.'));
  assert.ok(text.trimEnd().endsWith('The end.'));
  assert.ok(!GAME_WORDS.test(text), `no game words: ${text.match(GAME_WORDS)?.[0]}`);
  assert.ok(!text.includes('!'), 'no exclamation marks');
  for (const s of sentences(story)) assert.ok(s.split(/\s+/).length < 24, `short sentence: ${s}`);
  assert.ok(story.parts[0].paragraphs.length >= 2 && story.parts[0].paragraphs.length <= 4);
});

test('the Fargodeep Mine chain as a storyline, one part per chapter', () => {
  const s = storylines(db, {}).find((x) => x.quests.some((r) => r.q.id === 62));
  const tale = { id: `s${s.id}`, kind: 'storyline', title: s.name, zones: s.zones, level: s.minLevel, chapters: s.quests, done: 0, total: s.total, complete: false, heroes: [], startedAt: null, finishedAt: null };
  const story = tellTale(tale, { db, codex: { quests: [], characters: [] }, pretend: true });
  assert.ok(story.parts.length >= 2);
  assert.deepEqual(story.parts.map((p) => p.heading), s.quests.map((r) => r.q.n), 'chapter titles in order');
  const later = story.parts.slice(1).map((p) => p.paragraphs[0]).join(' ');
  assert.ok(/not the end of it|not all|more to do|story goes on/.test(later), 'a linking sentence between chapters');
  assert.equal(story.dedication, 'As it might be lived', 'no hero: as it might be lived');
  const text = flat(story);
  assert.ok(text.includes('Fargodeep Mine') && text.includes('Marshal Dughan'));
  assert.ok(!/\b(he|she|they)\b/.test(text), 'no pronouns without a hero');
  assert.ok(!GAME_WORDS.test(text), `no game words: ${text.match(GAME_WORDS)?.[0]}`);
  assert.ok(story.ending.endsWith('The end.'));
  for (const p of story.parts) assert.ok(p.paragraphs.length >= 2 && p.paragraphs.length <= 4, `${p.heading}: ${p.paragraphs.length} paragraphs`);
});

test('tales from the fixture: what Aldric has started, complete ones first', () => {
  const list = tales({ db, codex, world, characters });
  assert.ok(list.length >= 1);
  const kobold = list.find((t) => t.chapters.some((ch) => ch.q.id === 7));
  assert.ok(kobold, 'Kobold Camp Cleanup is a tale');
  assert.equal(list[0], kobold, 'appears first');
  assert.equal(kobold.heroes[0].name, 'Aldric');
  assert.equal(kobold.heroes[0].sex, 'male');
  assert.ok(kobold.done >= 1 && kobold.startedAt && kobold.finishedAt);
  assert.ok(list.every((t) => t.done >= 1), 'only started tales');
  // Only the one chapter is done, so the tale is not complete and its story stops there.
  assert.equal(kobold.chapters.find((ch) => ch.q.id === 7).state, 'done');
  const partial = tellTale(kobold, { db, codex, world });
  assert.equal(partial.parts.length, 1);
  assert.equal(partial.parts[0].heading, 'Kobold Camp Cleanup');
  assert.ok(!partial.ending.endsWith('The end.'));
  const text = taleText(partial);
  assert.ok(text.startsWith('# '));
  assert.ok(text.includes('Aldric') && text.includes('Kobold Vermin') && text.includes('Deputy Willem'), 'the giver as met, not the database one');
  assert.ok(text.includes('You have done well, Aldric'), 'the thanks as read, with the name filled in');
  assert.ok(text.includes('two of them') || text.includes('hunted'), 'how many were really hunted');
  assert.ok(!GAME_WORDS.test(text), `no game words: ${text.match(GAME_WORDS)?.[0]}`);
  // With every chapter turned in, the tale is complete and told to the end.
  const full = { ...codex, quests: codex.quests.concat(kobold.chapters.filter((ch) => ch.q.id !== 7).map((ch) => ({ key: `q${ch.q.id}`, qid: ch.q.id, status: 'done', characters: ['Aldric-Mankrik'], turnedIn: [{ t: 1790001000 }], accepted: [], offered: [] }))) };
  const done = tales({ db, codex: full, world, characters }).find((t) => t.id === kobold.id);
  assert.equal(done.complete, true);
  assert.equal(done.done, done.total);
  const whole = tellTale(done, { db, codex: full, world });
  assert.equal(whole.parts.length, kobold.chapters.length);
  assert.ok(whole.ending.endsWith('The end.'));
  assert.ok(!GAME_WORDS.test(taleText(whole)), `no game words: ${taleText(whole).match(GAME_WORDS)?.[0]}`);
});
