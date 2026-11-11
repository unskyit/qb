/**
 * QuadBeam Backpressure-Controlled Video Frame Capture Engine
 * Uses requestVideoFrameCallback where supported, reuses a single capture canvas
 * (`willReadFrequently: true`) to avoid GC pressure, and drops frame opportunities
 * whenever the decoder is still busy processing the previous frame.
 */

import { FpsCounter } from '../utils/timing.js';

export class VideoFrameCapture {
  constructor(onFrameCallback) {
    this.onFrameCallback = onFrameCallback;
    this.videoEl = null;
    this.captureCanvas = null;
    this.captureCtx = null;
    this.running = false;
    this.busy = false;
    this.rvfcHandle = null;
    this.rafHandle = null;
    this.captureFpsCounter = new FpsCounter(1000);
    this.maxDimension = 1080;
  }

  attachVideo(videoEl) {
    this.videoEl = videoEl;
  }

  _ensureCanvas(width, height) {
    if (!this.captureCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.captureCanvas = new OffscreenCanvas(width, height);
      } else if (typeof document !== 'undefined') {
        this.captureCanvas = document.createElement('canvas');
      }
    }
    if (this.captureCanvas.width !== width || this.captureCanvas.height !== height) {
      this.captureCanvas.width = width;
      this.captureCanvas.height = height;
      this.captureCtx = null;
    }
    if (!this.captureCtx) {
      this.captureCtx = this.captureCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  start() {
    if (!this.videoEl) return;
    this.running = true;
    this.busy = false;
    this.captureFpsCounter.reset();
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    if (
      this.rvfcHandle !== null &&
      this.videoEl &&
      typeof this.videoEl.cancelVideoFrameCallback === 'function'
    ) {
      try {
        this.videoEl.cancelVideoFrameCallback(this.rvfcHandle);
      } catch {
        // Ignore
      }
      this.rvfcHandle = null;
    }
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getMeasuredCaptureFps() {
    return this.captureFpsCounter.getFps();
  }

  _scheduleNext() {
    if (!this.running || !this.videoEl) return;
    if (typeof this.videoEl.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = this.videoEl.requestVideoFrameCallback((now) => this._captureFrame(now));
    } else if (typeof requestAnimationFrame === 'function') {
      this.rafHandle = requestAnimationFrame((now) => this._captureFrame(now));
    }
  }

  async _captureFrame(nowMs) {
    if (!this.running || !this.videoEl) return;

    if (!this.busy && this.videoEl.readyState >= 2 && this.videoEl.videoWidth > 0) {
      this.busy = true;
      try {
        const vw = this.videoEl.videoWidth;
        const vh = this.videoEl.videoHeight;
        const scale = Math.min(1, this.maxDimension / Math.max(vw, vh));
        const cw = Math.max(64, Math.round(vw * scale));
        const ch = Math.max(64, Math.round(vh * scale));

        this._ensureCanvas(cw, ch);
        this.captureCtx.drawImage(this.videoEl, 0, 0, cw, ch);
        const imageData = this.captureCtx.getImageData(0, 0, cw, ch);

        this.captureFpsCounter.tick(nowMs);
        await this.onFrameCallback(imageData, nowMs);
      } catch (err) {
        console.error('[QuadBeam FrameCapture] Frame processing error:', err);
      } finally {
        this.busy = false;
      }
    }

    this._scheduleNext();
  }
}
