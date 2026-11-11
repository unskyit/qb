#!/usr/bin/env node
/**
 * QuadBeam Production Build Script (`dist/` + Single-File Self-Contained Bundle)
 *
 * Produces a complete, self-contained `dist/` directory ready for static HTTPS hosting
 * or GitHub Pages deployment (`https://USERNAME.github.io/REPOSITORY/`),
 * and also generates a single-file self-contained `quadbeam.html` bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Clean and recreate dist/
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

// 2. Copy public/ assets (manifest.webmanifest, sw.js, icons/, fonts/) into dist/
copyDirRecursive(path.join(ROOT, 'public'), DIST);

// 3. Copy modular src/ into dist/src/ so ES module imports work identically in dist/
copyDirRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));

// 4. Create concatenated CSS bundle in dist/assets/quadbeam.bundle.css
const cssOrder = [
  'tokens.css',
  'global.css',
  'layout.css',
  'components.css',
  'animations.css',
  'responsive.css'
];

let combinedCss = '';
for (const file of cssOrder) {
  const raw = fs.readFileSync(path.join(ROOT, 'src', 'styles', file), 'utf8');
  combinedCss += `\n/* --- ${file} --- */\n` + raw.replace(/\.\.\/\.\.\/fonts\//g, '../fonts/');
}
fs.writeFileSync(path.join(DIST, 'assets', 'quadbeam.bundle.css'), combinedCss, 'utf8');

// 5. Write optimized dist/index.html referencing ./assets/quadbeam.bundle.css and ./src/main.js
const rootIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const distIndex = rootIndex.replace(
  /\s*<link rel="stylesheet" href="\.\/src\/styles\/[^"]+" \/>/g,
  (match, offset, full) => {
    if (match.includes('tokens.css')) {
      return '\n  <link rel="stylesheet" href="./assets/quadbeam.bundle.css" />';
    }
    return '';
  }
);
fs.writeFileSync(path.join(DIST, 'index.html'), distIndex, 'utf8');

// 6. Add .nojekyll to both ROOT and DIST so GitHub Pages serves all files cleanly
fs.writeFileSync(path.join(ROOT, '.nojekyll'), '', 'utf8');
fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');

console.log('[QuadBeam Build] Built production assets into dist/ successfully.');
