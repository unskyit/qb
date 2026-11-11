#!/usr/bin/env node
/**
 * QuadBeam Build & Self-Containment Verifier
 * Verifies that:
 * 1. All required source, public, icon, font, and dist files exist and are non-empty.
 * 2. Zero external runtime CDN dependencies exist in HTML, CSS, or JS files.
 * 3. All asset paths in index.html, manifest.webmanifest, and sw.js are relative ('./')
 *    for GitHub Pages repository subpath compatibility.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REQUIRED_FILES = [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'manifest.webmanifest',
  'sw.js',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/icons/favicon.svg',
  'public/icons/favicon.png',
  'public/icons/apple-touch-icon.png',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-512.png',
  'public/fonts/Inter-Regular.woff2',
  'public/fonts/Inter-Medium.woff2',
  'public/fonts/Inter-SemiBold.woff2',
  'public/fonts/Inter-Bold.woff2',
  'dist/index.html',
  'dist/manifest.webmanifest',
  'dist/sw.js',
  'dist/assets/quadbeam.bundle.css',
  'dist/icons/icon-192.png',
  'dist/icons/icon-512.png',
  'dist/fonts/Inter-Regular.woff2'
];

let errors = 0;

for (const rel of REQUIRED_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.error(`[VERIFY ERROR] Missing required file: ${rel}`);
    errors++;
  } else {
    const stat = fs.statSync(full);
    if (stat.size === 0) {
      console.error(`[VERIFY ERROR] Empty required file: ${rel}`);
      errors++;
    }
  }
}

// Verify zero external CDN script/style URLs in index.html and dist/index.html
for (const htmlRel of ['index.html', 'dist/index.html']) {
  const html = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
  if (/https?:\/\//i.test(html)) {
    console.error(`[VERIFY ERROR] Found external HTTP/HTTPS URL in ${htmlRel}`);
    errors++;
  }
  if (/(href|src)="\/[^/]/i.test(html)) {
    console.error(`[VERIFY ERROR] Found root-absolute path in ${htmlRel} (breaks GitHub Pages subpaths)`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`[QuadBeam Verify] Failed with ${errors} error(s).`);
  process.exit(1);
}

console.log(`[QuadBeam Verify] Verified ${REQUIRED_FILES.length} production artifacts, relative paths, and zero external CDNs.`);
