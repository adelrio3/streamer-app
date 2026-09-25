#!/usr/bin/env node
// Copies the addon into the website (web/addon) so the app's "Install addon"
// button can write it into your WoW folder. Netlify runs this on every deploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'addon', 'Chronicler');
const out = path.join(root, 'web', 'addon');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'Chronicler'), { recursive: true });
const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile());
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, 'Chronicler', f));
const version = /^## Version:\s*(\S+)/m.exec(fs.readFileSync(path.join(src, 'Chronicler.toc'), 'utf8'))[1];
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version, files }, null, 2));
console.log(`Addon ${version} copied to web/addon (${files.join(', ')})`);
