#!/usr/bin/env node
/**
 * Builds a single-file, self-contained HTML version of QuadBeam (`quadbeam.html`)
 * for instant interactive preview in Canvas while preserving 100% of the modular
 * optical engine, computer vision QR decoder, LT fountain coder, and UI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_HTML = path.resolve(ROOT, '../../output/quadbeam.html');

const MODULE_ORDER = [
  'src/utils/formatters.js',
  'src/utils/timing.js',
  'src/utils/ids.js',
  'src/utils/sanitization.js',
  'src/core/errors.js',
  'src/core/events.js',
  'src/core/capability-detector.js',
  'src/core/state.js',
  'src/protocol/constants.js',
  'src/protocol/integrity.js',
  'src/protocol/encoding.js',
  'src/protocol/packet-format.js',
  'src/protocol/packet-parser.js',
  'src/protocol/metadata.js',
  'src/protocol/fountain-encoder.js',
  'src/protocol/fountain-decoder.js',
  'src/protocol/recovery.js',
  'src/protocol/packet-scheduler.js',
  'src/sender/qr-generator.js',
  'src/sender/file-reader.js',
  'src/sender/transmission-settings.js',
  'src/sender/qr-grid.js',
  'src/sender/frame-scheduler.js',
  'src/sender/sender-controller.js',
  'src/storage/temporary-storage.js',
  'src/storage/cleanup.js',
  'src/storage/download-manager.js',
  'src/receiver/camera-capabilities.js',
  'src/receiver/camera-manager.js',
  'src/receiver/frame-capture.js',
  'src/receiver/qr-detector.js',
  'src/receiver/packet-collector.js',
  'src/receiver/file-reconstructor.js',
  'src/receiver/file-writer.js',
  'src/receiver/scanner-controller.js',
  'src/ui/notifications.js',
  'src/ui/modals.js',
  'src/ui/home.js',
  'src/ui/camera-picker.js',
  'src/ui/progress.js',
  'src/ui/completion.js',
  'src/ui/settings.js',
  'src/ui/send-view.js',
  'src/ui/receive-view.js',
  'src/app.js',
  'src/main.js'
];

const cssOrder = [
  'tokens.css',
  'global.css',
  'layout.css',
  'components.css',
  'animations.css',
  'responsive.css'
];

let combinedCss = '';
for (const c of cssOrder) {
  let raw = fs.readFileSync(path.join(ROOT, 'src/styles', c), 'utf8');
  raw = raw.replace(/@font-face\s*\{[^}]+\}/g, '');
  combinedCss += `\n/* ${c} */\n` + raw;
}

let combinedJs = `'use strict';\n`;
for (const modPath of MODULE_ORDER) {
  let code = fs.readFileSync(path.join(ROOT, modPath), 'utf8');
  code = code.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^\s*export\s+default\s+app;\s*$/gm, 'window.__quadBeamApp = app;');
  code = code.replace(/^\s*export\s+(async\s+function|function|class|const|let|var)\s+/gm, '$1 ');
  combinedJs += `\n// === ${modPath} ===\n` + code + '\n';
}

const svgIconB64 = Buffer.from(
  fs.readFileSync(path.join(ROOT, 'public/icons/favicon.svg'), 'utf8')
).toString('base64');
const svgDataUri = `data:image/svg+xml;base64,${svgIconB64}`;

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

html = html.replace(/<link rel="icon"[^>]+>/g, () => `<link rel="icon" type="image/svg+xml" href="${svgDataUri}" />`);
html = html.replace(/<link rel="apple-touch-icon"[^>]+>/g, () => '');
html = html.replace(/<link rel="manifest"[^>]+>/g, () => '');
html = html.replace(/<link rel="stylesheet" href="\.\/src\/styles\/[^"]+"\s*\/>/g, () => '');
html = html.replace('</head>', () => `  <style>${combinedCss}</style>\n</head>`);
html = html.replace('src="./icons/favicon.svg"', () => `src="${svgDataUri}"`);
html = html.replace(
  '<script type="module" src="./src/main.js"></script>',
  () => `<script type="module">\n${combinedJs}\n</script>`
);

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`[QuadBeam Single-File Builder] Wrote ${OUT_HTML} (${fs.statSync(OUT_HTML).size} bytes)`);
