/**
 * QuadBeam Precision Optical Frame Scheduler & Wake Lock Manager
 * Coordinates atomic QR frame updates at configurable rates (5, 10, 15, 20, 30, 60 FPS)
 * without stacking frames when encoding takes longer than the frame interval.
 */

import { FpsCounter } from '../utils/timing.js';

export class OpticalFrameScheduler {
  constructor(onTickCallback) {
    this.onTickCallback = onTickCallback;
    this.targetFps = 15;
    this.running = false;
    this.paused = false;
    this.rafId = null;
    this.timerId = null;
    this.lastFrameTimeMs = 0;
    this.tickBusy = false;
    this.fpsCounter = new FpsCounter(1000);
    this.wakeLockSentinel = null;
  }

  setTargetFps(fps) {
    this.targetFps = Math.max(1, Math.min(60, Number(fps) || 15));
  }

  getMeasuredFps() {
    return this.fpsCounter.getFps();
  }

  async acquireWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock?.request) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Never rely on Wake Lock being granted
        this.wakeLockSentinel = null;
      }
    }
  }

  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {
        // Ignore release errors
      }
      this.wakeLockSentinel = null;
    }
  }

  start(fps = this.targetFps) {
    this.setTargetFps(fps);
    this.running = true;
    this.paused = false;
    this.lastFrameTimeMs = 0;
    this.fpsCounter.reset();
    this.acquireWakeLock();
    this._scheduleNext();
  }

  pause() {
    this.paused = true;
    this._cancelPending();
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.lastFrameTimeMs = performance.now();
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    this.paused = false;
    this._cancelPending();
    this.releaseWakeLock();
  }

  _cancelPending() {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  _scheduleNext() {
    if (!this.running || this.paused) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame((now) => this._onAnimationFrame(now));
    } else {
      const interval = 1000 / this.targetFps;
      this.timerId = setTimeout(() => this._onAnimationFrame(performance.now()), interval);
    }
  }

  async _onAnimationFrame(nowMs) {
    if (!this.running || this.paused) return;
    const intervalMs = 1000 / this.targetFps;

    // Tolerance of 1.5ms so 30/60 FPS align cleanly with 60Hz VSync
    if (this.lastFrameTimeMs === 0 || nowMs - this.lastFrameTimeMs >= intervalMs - 1.5) {
      if (!this.tickBusy) {
        this.tickBusy = true;
        this.lastFrameTimeMs = nowMs;
        try {
          await this.onTickCallback(nowMs);
          this.fpsCounter.tick(nowMs);
        } catch (err) {
          console.error('[QuadBeam FrameScheduler] Frame tick error:', err);
        } finally {
          this.tickBusy = false;
        }
      }
    }

    this._scheduleNext();
  }
}
