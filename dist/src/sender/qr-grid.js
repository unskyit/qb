/**
 * QuadBeam Synchronized 1 / 2 / 4 QR Grid Display Component
 *
 * Ensures:
 * - Pure white quiet-zone framing (#FFFFFF) around each QR code
 * - Sharp square modules with zero CSS crossfades, zero blur, and zero center logos
 * - Atomic coordinated frame rendering across all active panels
 */

import { encodeQrMatrix, renderQrToCanvas } from './qr-generator.js';
import { encodePacketWire } from '../protocol/encoding.js';

export class QrGridRenderer {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.panelCount = 4;
    this.panelSizePx = 280;
    this.ecLevel = 'M';
    this.wireEncoding = 'base45';
    this.canvases = [];
    this.panelWrappers = [];
    this.panelBadges = [];
  }

  configure({
    qrCount = 4,
    panelSizePx = 280,
    gridColumns = 2,
    gridRows = 2,
    ecLevel = 'M',
    wireEncoding = 'base45',
    highContrast = false
  }) {
    this.panelCount = qrCount;
    this.panelSizePx = panelSizePx;
    this.ecLevel = ecLevel;
    this.wireEncoding = wireEncoding;

    if (!this.containerEl) return;

    this.containerEl.innerHTML = '';
    this.containerEl.className = `qb-qr-grid qb-qr-grid-${qrCount} ${highContrast ? 'qb-high-contrast' : ''}`;
    this.containerEl.style.setProperty('--qb-grid-cols', String(gridColumns));
    this.containerEl.style.setProperty('--qb-grid-rows', String(gridRows));
    this.containerEl.style.setProperty('--qb-panel-size', `${panelSizePx}px`);

    this.canvases = [];
    this.panelWrappers = [];
    this.panelBadges = [];

    for (let i = 0; i < qrCount; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'qb-qr-panel';
      wrapper.setAttribute('data-panel-index', String(i));

      const canvas = document.createElement('canvas');
      canvas.className = 'qb-qr-canvas';
      canvas.width = panelSizePx;
      canvas.height = panelSizePx;
      canvas.setAttribute('aria-label', `Optical QR transmission channel ${i + 1} of ${qrCount}`);

      const badge = document.createElement('div');
      badge.className = 'qb-qr-panel-meta';
      badge.textContent = `CH ${i + 1}`;

      wrapper.appendChild(canvas);
      wrapper.appendChild(badge);
      this.containerEl.appendChild(wrapper);

      this.panelWrappers.push(wrapper);
      this.canvases.push(canvas);
      this.panelBadges.push(badge);
    }
  }

  /**
   * Render a synchronized batch of packets atomically across all active QR canvases.
   * Returns `{ renderDurationMs, versions }`.
   */
  renderFramePackets(packets, labels = null) {
    const t0 = performance.now();
    const matrices = new Array(Math.min(packets.length, this.canvases.length));

    // Step 1: Compute all QR matrices before touching the DOM/Canvas contexts
    // so that canvas pixel updates happen atomically together in < 1ms.
    for (let i = 0; i < matrices.length; i++) {
      const wire = encodePacketWire(packets[i], this.wireEncoding);
      matrices[i] = encodeQrMatrix(wire.data, { ecLevel: this.ecLevel });
    }

    // Step 2: Atomic paint across all panels
    const versions = [];
    for (let i = 0; i < matrices.length; i++) {
      const mat = matrices[i];
      versions.push(mat.version);
      renderQrToCanvas(this.canvases[i], mat, {
        size: this.panelSizePx,
        quietZone: 4
      });
      if (this.panelBadges[i]) {
        this.panelBadges[i].textContent =
          labels && labels[i] ? labels[i] : `CH ${i + 1} · V${mat.version}`;
      }
    }

    const renderDurationMs = performance.now() - t0;
    return { renderDurationMs, versions };
  }
}
