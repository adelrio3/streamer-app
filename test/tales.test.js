// Tales: storylines retold as one story each for the Lore page. Not about
// any character, told in acts rather than chapter by chapter, in a
// young-adult narrator's voice.

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
import { tales, tellTale, taleText, rollUp } from '../web/lib/tales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'data', 'classic', name), 'utf8'));
const db = indexDB({ quests: json('quests.json').quests, npcs: json('npcs.json').npcs, objects: json('objects.json').objects, items: json('items.json').items, zones: json('zones.json').zones });
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Compendium.lua'), 'utf8'));
const sessions = log.sessions;
const moment = (s, e) => ({ session: s.id, t: e.t, footage: null });
const codex = buildCodex(sessions);
const world = buildWorld(sessions, log.items, moment);
const characters = buildCharacters(sessions, moment);
const empty = { quests: [], characters: [] };

const GAME_WORDS = /\b(quest|quests|NPC|NPCs|level|levels|XP|loot|looted|database|log|logs|player|players)\b/i;
const FORMULA = /was (?:satisfied|glad|happy|pleased)|called it a job well done|once upon|long ago|and that was that|The end\.|a little taller|very glad/i;
const flat = (story) => taleText(story);
const sentences = (story) => [...story.parts.flatMap((p) => p.paragraphs), story.ending].flatMap((p) => p.replace(/"[^"]*"/g, 'quote').split(/(?<=[.?])\s+/)).filter(Boolean);
const chainTale = (qid) => {
  const s = storylines(db, {}).find((x) => x.quests.some((r) => r.q.id === qid));
  return { id: `s${s.id}`, kind: 'storyline', title: s.name, zones: s.zones, level: s.minLevel, chapters: s.quests, done: 0, total: s.total, complete: false, heroes: [], startedAt: null, finishedAt: null };
};

// What every tale must hold to, whoever lived it.
function wellTold(story, { sex = 'male' } = {}) {
  const text = flat(story);
  assert.ok(!GAME_WORDS.test(text), `no game words: ${text.match(GAME_WORDS)?.[0]}`);
  assert.ok(!FORMULA.test(text), `no nursery formula: ${text.match(FORMULA)?.[0]}`);
  assert.ok(!text.replace(/^# .*\n/, '').includes('!'), 'no exclamation marks (the title is the game\'s own)');
  assert.ok(!/\bthey\b/i.test(text.replace(/"[^"]*"/g, '')), 'never they for the adventurer');
  assert.ok(!/the traveler\b/.test(text), 'no "the traveler" stand-in');
  const prose = text.replace(/"[^"]*"/g, '');
  if (sex === 'female') assert.ok(/\b(she|her)\b/i.test(prose) && !/\b(he|him|himself)\b/i.test(prose), 'she, never he');
  else assert.ok(/\b(he|him|his)\b/i.test(prose) && !/\b(she|herself)\b/i.test(prose), 'he, never she');
  for (const s of sentences(story)) assert.ok(s.split(/\s+/).length <= 32, `sentence under the cap: ${s}`);
  for (const p of story.parts) {
    assert.ok(p.heading, 'every act has a heading');
    const openers = new Set(sentences({ parts: [p], ending: '' }).map((s) => s.split(/\s+/)[0]));
    assert.ok(openers.size >= 2, `${p.heading}: varied sentence openers`);
    for (const para of p.paragraphs) assert.ok(para.split(/(?<=[.?])\s+/).length >= 2, `paragraphs are more than a line: ${para}`);
  }
  assert.ok(story.ending && !/\bthey\b/.test(story.ending));
  return text;
}

test('a lone errand told as a small tale, not a chapter', () => {
  const q = db.quests.get(4402);
  const tale = { id: 'q4402', kind: 'quest', title: q.n, zones: ['Durotar'], level: q.l, chapters: [{ q, state: 'ready' }], done: 0, total: 1, complete: false, heroes: [], startedAt: null, finishedAt: null };
  const story = tellTale(tale, { db, codex: empty, world: null, hero: { name: 'Zug', race: 'Troll', class: 'Hunter', sex: 'male' }, pretend: true });
  assert.equal(story.title, "Galgar's Cactus Apple Surprise");
  const text = wellTold(story);
  assert.ok(!text.includes('Zug') && !/As lived by/i.test(text), 'the hero passed in is ignored: nobody is named');
  assert.ok(!/\b(troll|hunter)\b/i.test(text), 'no race or craft when the story is for everyone');
  for (const word of ['Galgar', 'Durotar', 'cactus apples']) assert.ok(text.includes(word), `mentions ${word}`);
  assert.ok(/\bten\b/i.test(text), 'ten apples, as asked');
  assert.ok(story.parts.length >= 1 && story.parts.length <= 2, 'a lone tale is one or two parts');
  assert.ok(story.dedication && !/Zug|lived by/i.test(story.dedication), `a subtitle, not a name: ${story.dedication}`);
});

test('the Elwynn chain is one arc in a few acts, not a part per chapter', () => {
  const tale = chainTale(7);
  assert.ok(tale.chapters.length >= 14, `${tale.chapters.length} chapters in the chain`);
  const story = tellTale(tale, { db, codex: empty, pretend: true, defaultSex: 'female' });
  const text = wellTold(story, { sex: 'female' });
  assert.ok(story.parts.length >= 3 && story.parts.length < 7, `${story.parts.length} acts for ${tale.chapters.length} chapters`);
  assert.notDeepEqual(story.parts.map((p) => p.heading), tale.chapters.map((ch) => ch.q.n), 'headings are acts, not chapter titles');
  assert.ok(/kobolds/.test(text), 'the kobolds are the trouble');
  assert.ok(text.includes('Marshal McBride') && text.includes('Deputy Willem'), 'the people who asked');
  assert.ok(/vermin.*workers.*laborers/s.test(text), 'the kobold errands fold into one escalating campaign');
  assert.equal(text.match(/kobolds came in kinds|First the vermin|It went by stages/g)?.length, 1, 'told once, not three times');
  assert.ok(/every newcomer/i.test(text) && text.match(/letter/g).length <= 3, 'the six letters are one event');
  assert.ok(!/Simple Letter|Consecrated Letter|Encrypted Letter/.test(text), 'no variant titles');
  assert.ok(!/\b(warrior|paladin|rogue|priest|mage|warlock)\b/i.test(text), 'no craft named');
  assert.ok(text.includes('Garrick Padfoot') && text.includes('Goldshire'), 'the bounty and the road out');
  assert.ok(story.parts.at(-1).paragraphs.length >= 2, 'the last act carries the resolution');
  assert.ok(!/for now|not happened yet/.test(story.ending), 'told to the end');
  const his = flat(tellTale(tale, { db, codex: empty, pretend: true }));
  assert.ok(/\bhe\b/i.test(his) && !/\bshe\b/i.test(his), 'male by default');
  assert.equal(flat(tellTale(tale, { db, codex: empty, pretend: true })), his, 'stable output');
});

test('the Durotar chain: the letters are one event, told for no craft in particular', () => {
  const tale = chainTale(788);
  const story = tellTale(tale, { db, codex: empty, hero: { name: 'Vesch', race: 'Troll', class: 'Hunter', sex: 'male' }, pretend: true });
  const text = wellTold(story);
  assert.ok(!text.includes('Vesch') && !/\b(troll|hunter)\b/i.test(text), 'no name, no race, no craft');
  assert.ok(story.parts.length >= 2 && story.parts.length <= 5);
  assert.ok(text.includes('Gornek') && text.includes('Galgar') && /boars/.test(text), 'Gornek, the boars, Galgar');
  assert.ok(/every newcomer/i.test(text) && !/Jen'shan|Rwag|Shikrik|Frang/.test(text), 'one sealed message for whichever teacher, no teacher named');
  assert.ok(!/Etched Tablet|Simple Parchment|Rune-Inscribed/.test(text), 'the variant titles never appear');
  assert.ok(/Valley of Trials|the Den/.test(text), 'the place is named');
});

test('a class-locked chain may name the craft, and a female voice says she', () => {
  const s = storylines(db, {}).find((x) => x.quests.length >= 2 && x.quests.every((r) => r.q.cl === 4));
  if (!s) return; // no hunter-only chain in the data
  const tale = { id: `s${s.id}`, kind: 'storyline', title: s.name, zones: s.zones, level: s.minLevel, chapters: s.quests, done: 0, total: s.total, complete: false, heroes: [] };
  const text = wellTold(tellTale(tale, { db, codex: empty, pretend: true, defaultSex: 'female' }), { sex: 'female' });
  assert.ok(/\bhunter\b/.test(text), 'the hunter, because the whole story is a hunter\'s');
});

test('tales from the fixture: what has been started, complete ones first, told as far as lived', () => {
  const list = tales({ db, codex, world, characters });
  assert.ok(list.length >= 1);
  const kobold = list.find((t) => t.chapters.some((ch) => ch.q.id === 7));
  assert.ok(kobold, 'Kobold Camp Cleanup is a tale');
  assert.equal(list[0], kobold, 'appears first');
  assert.equal(kobold.heroes[0].name, 'Aldric', 'the shelf still knows who lived it');
  assert.equal(kobold.heroes[0].sex, 'male');
  assert.ok(kobold.done >= 1 && kobold.startedAt && kobold.finishedAt);
  assert.ok(list.every((t) => t.done >= 1), 'only started tales');
  assert.equal(kobold.chapters.find((ch) => ch.q.id === 7).state, 'done');
  // Only the one chapter is done: the tale goes that far and stays open.
  const partial = tellTale(kobold, { db, codex, world });
  const text = wellTold(partial);
  assert.equal(partial.parts.length, 1);
  assert.ok(!text.includes('Aldric') && !/As lived by/.test(text), 'nobody is named');
  assert.ok(!/Aldric/.test(partial.dedication));
  assert.ok(/kobold vermin/i.test(text) && text.includes('Deputy Willem'), 'the giver as met, not the database one');
  assert.ok(text.includes('"Your first task is one of cleansing."'), 'the words as read');
  assert.ok(text.includes('"You have done well,"'), 'the thanks as read, without the name');
  assert.ok(/for now|not happened yet|did not know either/.test(partial.ending), 'left open');
  // With every chapter turned in, the tale is complete and told to the end.
  const full = { ...codex, quests: codex.quests.concat(kobold.chapters.filter((ch) => ch.q.id !== 7).map((ch) => ({ key: `q${ch.q.id}`, qid: ch.q.id, status: 'done', characters: ['Aldric-Mankrik'], turnedIn: [{ t: 1790001000 }], accepted: [], offered: [] }))) };
  const done = tales({ db, codex: full, world, characters }).find((t) => t.id === kobold.id);
  assert.equal(done.complete, true);
  assert.equal(done.done, done.total);
  const whole = tellTale(done, { db, codex: full, world });
  const wholeText = wellTold(whole);
  assert.ok(whole.parts.length >= 3 && whole.parts.length < 7, `${whole.parts.length} acts`);
  assert.ok(!/for now|not happened yet/.test(whole.ending), 'told to the end');
  assert.ok(!wholeText.includes('Aldric'));
  assert.ok(taleText(whole).startsWith('# '));
});

test('class-only chapters roll into one event and count once', () => {
  const s = storylines(db, {}).find((x) => x.quests.some((r) => r.q.id === 788));
  const chapters = rollUp(s.quests);
  const letters = chapters.find((ch) => ch.variants);
  assert.ok(letters, 'a rolled-up chapter');
  assert.ok(letters.variants.length >= 5 && letters.variants.every((v) => v.q.cl), 'every variant is for some classes only');
  assert.ok(chapters.length < s.quests.length - 3);
  assert.ok(chapters.some((ch) => ch.q.id === 4402) && chapters.some((ch) => ch.q.id === 789), 'the shared chapters stay');
  const kobold = tales({ db, codex, world, characters }).find((t) => t.chapters.some((ch) => ch.q.id === 7));
  assert.ok(kobold.chapters.some((ch) => ch.variants), 'rolled up in tales() too');
  assert.equal(kobold.total, kobold.chapters.length, 'the total counts the letters once');
  assert.ok(kobold.chapters.length <= 13, `${kobold.chapters.length} chapters, the six letters as one`);
});

test('many storylines, told ahead of time, all hold to the voice', () => {
  const list = storylines(db, {}).filter((s) => s.quests.length >= 2).slice(0, 60);
  for (const s of list) {
    const tale = { id: `s${s.id}`, kind: 'storyline', title: s.name, zones: s.zones, level: s.minLevel, chapters: s.quests, done: 0, total: s.total, complete: false, heroes: [] };
    const story = tellTale(tale, { db, codex: empty, pretend: true });
    wellTold(story);
    assert.ok(story.parts.length <= Math.max(2, Math.ceil(s.quests.length / 2)), `${s.name}: ${story.parts.length} acts for ${s.quests.length} chapters`);
    assert.ok(!/As lived by|As it might be lived/.test(story.dedication));
  }
});
