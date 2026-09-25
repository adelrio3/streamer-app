#!/usr/bin/env node
// Adds WoW interface versions to the addon's .toc so the game loads it
// without "out of date". In game, /dump select(4, GetBuildInfo()) shows the
// current number.
//
//   node tools/add-interface.js 11510 [more...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'addon', 'Chronicler', 'Chronicler.toc');
const wanted = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 10000);
if (!wanted.length) {
  console.error('Usage: node tools/add-interface.js <interface number> [...]   e.g. 11510');
  process.exit(1);
}
const text = fs.readFileSync(toc, 'utf8');
const line = /^## Interface:(.*)$/m.exec(text);
const current = line[1].split(',').map((s) => Number(s.trim())).filter(Boolean);
const added = wanted.filter((n) => !current.includes(n));
const next = [...added, ...current];
fs.writeFileSync(toc, text.replace(line[0], `## Interface: ${next.join(', ')}`));
console.log(added.length ? `Added ${added.join(', ')}. Copy addon/Chronicler into your AddOns folder again.` : 'Already listed.');
