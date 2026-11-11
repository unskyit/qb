/**
 * QuadBeam UI, Adaptive Layout, Theme, & PWA Verification Tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeSafeQrLayout, resolveTransmissionSettings } from '../../src/sender/transmission-settings.js';
import { DEFAULT_PREFERENCES } from '../../src/core/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

test('Adaptive QR Layout switches from 4 panels on desktop to 2 or 1 panel on small mobile viewports', () => {
  // Desktop 1440x900 -> 4 QR panels
  const desktop = computeSafeQrLayout({
    viewportWidth: 1440,
    viewportHeight: 900,
    requestedQrCount: 4,
    requestedBlockSize: 220
  });
  assert.equal(desktop.qrCount, 4);
  assert.equal(desktop.gridColumns, 2);
  assert.equal(desktop.gridRows, 2);

  // Compact mobile 340x560 -> automatically reduces to fewer panels or lower density for safe module size
  const smallMobile = computeSafeQrLayout({
    viewportWidth: 340,
    viewportHeight: 560,
    requestedQrCount: 4,
    requestedBlockSize: 320
  });
  assert.ok(smallMobile.qrCount <= 2, `Expected <= 2 panels on 340px viewport, got ${smallMobile.qrCount}`);
  assert.equal(smallMobile.landscapeRecommended, true);

  // Manual override when autoMode is false
  const manualPrefs = { ...DEFAULT_PREFERENCES, autoMode: false, profile: 'custom', qrCount: 4, fps: 30 };
  const manual = resolveTransmissionSettings(manualPrefs, 360, 640, false);
  assert.equal(manual.qrCount, 4);
  assert.equal(manual.fps, 30);
});

test('Light and Dark AMOLED Theme tokens match exact specification colors', () => {
  const tokensCss = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');

  // Light theme colors
  assert.match(tokensCss, /#F7F9FC/i);
  assert.match(tokensCss, /#FFFFFF/i);
  assert.match(tokensCss, /#EEF3FA/i);
  assert.match(tokensCss, /#17243A/i);
  assert.match(tokensCss, /#68768A/i);
  assert.match(tokensCss, /#477FDF/i);
  assert.match(tokensCss, /#E8F1FF/i);
  assert.match(tokensCss, /#DFE7F2/i);

  // Dark AMOLED theme colors
  assert.match(tokensCss, /#050608/i);
  assert.match(tokensCss, /#10131A/i);
  assert.match(tokensCss, /#181D27/i);
  assert.match(tokensCss, /#E3EAF4/i);
  assert.match(tokensCss, /#98A6B8/i);
  assert.match(tokensCss, /#77AAEF/i);
  assert.match(tokensCss, /#142338/i);
  assert.match(tokensCss, /#282F3D/i);
});

test('PWA manifest and Service Worker use relative paths compatible with GitHub Pages subpaths', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'QuadBeam — Transfer files through light');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./icons/'), `Icon path ${icon.src} must be relative`);
  }

  const swCode = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  assert.match(swCode, /\.\/index\.html/);
  assert.match(swCode, /\.\/manifest\.webmanifest/);
});
