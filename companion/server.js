#!/usr/bin/env node
// Chronicler companion.
//
//   node companion/server.js [--port 4050] [--host 127.0.0.1] [--data ./data] [--open]
//   node companion/server.js ingest        ingest once and print a summary
//   node companion/server.js export        ingest, then write every export to data/exports

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { App } from './src/app.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'serve';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(flag('data', process.env.CHRONICLER_DATA || path.join(root, 'data')));
const app = new App({ dataDir });

if (command === 'ingest' || command === 'export') {
  const result = app.ingest();
  if (result.files.length === 0) console.log('No Chronicler SavedVariables found. Set your WoW folder on the Setup page first.');
  for (const f of result.files) {
    console.log(f.error ? `${f.file}: ERROR ${f.error}` : `${f.file}: ${f.sessions} sessions, ${f.events} events (${f.added} new, ${f.updated} updated)`);
  }
  if (command === 'export') {
    const out = app.exportAll();
    console.log(`Wrote ${out.files} files for ${out.recordings} recordings to ${out.dir}`);
  }
} else {
  const port = Number(flag('port', process.env.PORT || 4050));
  const host = flag('host', '127.0.0.1');
  const server = http.createServer((req, res) => app.handle(req, res));
  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
    console.log(`Chronicler companion running at ${url}`);
    console.log(`Data folder: ${dataDir}`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.log('Warning: listening beyond this PC. Anyone on your network can open the companion and stream your recordings.');
    }
    app.start();
    if (args.includes('--open')) openBrowser(url);
  });
  const shutdown = () => { app.stop(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* print the URL instead */ }
}
