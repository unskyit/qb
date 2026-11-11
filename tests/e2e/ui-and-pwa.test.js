/**
 * QuadBeam UI, Strict Square 1/2/4/6 QR Layout, Theme, & PWA Verification Tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeSafeQrLayout,
  resolveTransmissionSettings,
  getGridDimensionsForCount
} from '../../src/sender/transmission-settings.js';
import { DEFAULT_PREFERENCES } from '../../src/core/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

test('Strict 1:1 Square QR Layout supports 1, 2, 4, and 6 QR panels across desktop and small mobile viewports', () => {
  // Desktop 1440x900 -> 4 QR panels (2x2) and 6 QR panels (3x2)
  const desktop4 = computeSafeQrLayout({
    viewportWidth: 1440,
    viewportHeight: 900,
    requestedQrCount: 4,
    requestedBlockSize: 160,
    strictHonorCount: true
  });
  assert.equal(desktop4.qrCount, 4);
  assert.equal(desktop4.gridColumns, 2);
  assert.equal(desktop4.gridRows, 2);

  const desktop6 = computeSafeQrLayout({
    viewportWidth: 1440,
    viewportHeight: 900,
    requestedQrCount: 6,
    requestedBlockSize: 160,
    strictHonorCount: true
  });
  assert.equal(desktop6.qrCount, 6);
  assert.equal(desktop6.gridColumns, 3);
  assert.equal(desktop6.gridRows, 2);

  // Small / low-DPI mobile 340x560 honoring 1, 2, 4, and 6 QR codes with compact square sizing
  for (const cnt of [1, 2, 4, 6]) {
    const mobile = computeSafeQrLayout({
      viewportWidth: 340,
      viewportHeight: 560,
      requestedQrCount: cnt,
      requestedBlockSize: 160,
      strictHonorCount: true
    });
    assert.equal(mobile.qrCount, cnt);
    assert.ok(mobile.panelSizePx >= 68 && mobile.panelSizePx <= 320);
  }

  // Portrait 6 QR -> 2 columns x 3 rows
  const dims6Portrait = getGridDimensionsForCount(6, false);
  assert.deepEqual(dims6Portrait, { cols: 2, rows: 3 });

  // Manual override when autoMode is false
  const manualPrefs = { ...DEFAULT_PREFERENCES, autoMode: false, profile: 'custom', qrCount: 6, fps: 30 };
  const manual = resolveTransmissionSettings(manualPrefs, 360, 640, false);
  assert.equal(manual.qrCount, 6);
  assert.equal(manual.fps, 30);
});

test('Light and Dark AMOLED Theme tokens match exact specification colors', () => {
  const tokensCss = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');

  assert.match(tokensCss, /#F7F9FC/i);
  assert.match(tokensCss, /#FFFFFF/i);
  assert.match(tokensCss, /#EEF3FA/i);
  assert.match(tokensCss, /#17243A/i);
  assert.match(tokensCss, /#68768A/i);
  assert.match(tokensCss, /#477FDF/i);
  assert.match(tokensCss, /#E8F1FF/i);
  assert.match(tokensCss, /#DFE7F2/i);

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
