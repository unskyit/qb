#!/usr/bin/env node
/**
 * QuadBeam Zero-Dependency Local Development & Preview Server
 * Serves either the root workspace (`npm run dev`) or `dist/` (`npm run preview`)
 * with proper ES module and WOFF2 MIME types.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const serveDist = process.argv.includes('--dist');
const BASE_DIR = serveDist ? path.join(ROOT, 'dist') : ROOT;
const PORT = serveDist ? 4173 : 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relPath = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(BASE_DIR, safePath);

  if (!fullPath.startsWith(BASE_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(fullPath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  QuadBeam ${serveDist ? 'Production Preview (dist/)' : 'Development Server'} running at:`);
  console.log(`  > Local: http://localhost:${PORT}/\n`);
});
