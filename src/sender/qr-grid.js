/**
 * QuadBeam Synchronized 1 / 2 / 4 / 6 Strict-Square QR Grid Display Component
 *
 * Guarantees:
 * - Every QR code is rendered and styled as an exact 1:1 square (`width === height`),
 *   preventing rectangular distortion on small or low-DPI mobile screens.
 * - Pure white quiet-zone framing (#FFFFFF) around each QR code.
 * - Atomic coordinated frame rendering across all active panels.
 */

import { encodeQrMatrix, renderQrToCanvas } from './qr-generator.js';
import { encodePacketWire } from '../protocol/encoding.js';

export class QrGridRenderer {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.panelCount = 4;
    this.panelSizePx = 180;
    this.ecLevel = 'M';
    this.wireEncoding = 'base45';
    this.canvases = [];
    this.panelWrappers = [];
    this.panelBadges = [];
  }

  configure({
    qrCount = 4,
    panelSizePx = 180,
    gridColumns = 2,
    gridRows = 2,
    gapPx = 8,
    ecLevel = 'M',
    wireEncoding = 'base45',
    highContrast = false
  }) {
    this.panelCount = qrCount;
    this.panelSizePx = Math.max(64, Math.floor(panelSizePx));
    this.ecLevel = ecLevel;
    this.wireEncoding = wireEncoding;

    if (!this.containerEl) return;

    this.containerEl.innerHTML = '';
    this.containerEl.className = `qb-qr-grid qb-qr-grid-${qrCount} ${highContrast ? 'qb-high-contrast' : ''}`;
    this.containerEl.style.setProperty('--qb-grid-cols', String(gridColumns));
    this.containerEl.style.setProperty('--qb-grid-rows', String(gridRows));
    this.containerEl.style.setProperty('--qb-grid-gap', `${gapPx}px`);
    this.containerEl.style.setProperty('--qb-panel-size', `${this.panelSizePx}px`);

    this.canvases = [];
    this.panelWrappers = [];
    this.panelBadges = [];

    for (let i = 0; i < qrCount; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'qb-qr-panel';
      wrapper.setAttribute('data-panel-index', String(i));

      const squareBox = document.createElement('div');
      squareBox.className = 'qb-qr-square';
      squareBox.style.width = `${this.panelSizePx}px`;
      squareBox.style.height = `${this.panelSizePx}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'qb-qr-canvas';
      canvas.width = this.panelSizePx;
      canvas.height = this.panelSizePx;
      canvas.style.width = `${this.panelSizePx}px`;
      canvas.style.height = `${this.panelSizePx}px`;
      canvas.setAttribute('aria-label', `Optical QR channel ${i + 1} of ${qrCount}`);

      const badge = document.createElement('div');
      badge.className = 'qb-qr-panel-meta';
      badge.textContent = `CH ${i + 1}`;

      squareBox.appendChild(canvas);
      wrapper.appendChild(squareBox);
      wrapper.appendChild(badge);
      this.containerEl.appendChild(wrapper);

      this.panelWrappers.push(wrapper);
      this.canvases.push(canvas);
      this.panelBadges.push(badge);
    }
  }

  /**
   * Render a synchronized batch of packets atomically across all active QR canvases.
   * Enforces strict 1:1 square CSS and pixel dimensions on every canvas.
   */
  renderFramePackets(packets, labels = null) {
    const t0 = performance.now();
    const count = Math.min(packets.length, this.canvases.length);
    const matrices = new Array(count);

    for (let i = 0; i < count; i++) {
      const wire = encodePacketWire(packets[i], this.wireEncoding);
      matrices[i] = encodeQrMatrix(wire.data, { ecLevel: this.ecLevel });
    }

    const versions = [];
    for (let i = 0; i < count; i++) {
      const mat = matrices[i];
      versions.push(mat.version);
      const canvas = this.canvases[i];
      renderQrToCanvas(canvas, mat, {
        size: this.panelSizePx,
        quietZone: 4
      });
      // Lock display CSS width and height to identical square pixels so mobile browsers never stretch it into a rectangle
      canvas.style.width = `${this.panelSizePx}px`;
      canvas.style.height = `${this.panelSizePx}px`;
      if (this.panelBadges[i]) {
        this.panelBadges[i].textContent =
          labels && labels[i] ? labels[i] : `CH ${i + 1} · V${mat.version}`;
      }
    }

    const renderDurationMs = performance.now() - t0;
    return { renderDurationMs, versions };
  }
}
