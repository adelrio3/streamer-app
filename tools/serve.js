#!/usr/bin/env node
// Serves web/ locally for development: npm run serve, then open
// http://127.0.0.1:8888. Paste your Supabase URL and anon key on the page
// that appears (Netlify provides them automatically when deployed).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.lua': 'text/plain', '.toc': 'text/plain', '.xml': 'text/xml' };
const port = Number(process.env.PORT || 8888);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ url: process.env.SUPABASE_URL ?? null, anonKey: process.env.SUPABASE_ANON_KEY ?? null }));
  }
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Chronicler web app at http://127.0.0.1:${port}`));
