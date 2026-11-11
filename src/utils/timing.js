/**
 * QuadBeam Timing & Throughput Smoothing Utilities
 * Provides Exponentially Weighted Moving Average (EWMA) throughput and ETA calculation.
 */

export class ThroughputEstimator {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.22;
    this.minObservations = options.minObservations ?? 4;
    this.minElapsedMs = options.minElapsedMs ?? 800;
    this.reset();
  }

  reset() {
    this.startTimeMs = 0;
    this.lastSampleTimeMs = 0;
    this.lastBytes = 0;
    this.smoothedBytesPerSec = 0;
    this.observations = 0;
    this.history = [];
  }

  record(totalVerifiedBytes, nowMs = performance.now()) {
    if (this.startTimeMs === 0) {
      this.startTimeMs = nowMs;
      this.lastSampleTimeMs = nowMs;
      this.lastBytes = totalVerifiedBytes;
      return;
    }

    const dtMs = nowMs - this.lastSampleTimeMs;
    if (dtMs < 150) return;

    const deltaBytes = Math.max(0, totalVerifiedBytes - this.lastBytes);
    const instantRate = (deltaBytes * 1000) / dtMs;

    if (deltaBytes > 0) {
      this.observations += 1;
    }

    if (this.smoothedBytesPerSec === 0 && instantRate > 0) {
      this.smoothedBytesPerSec = instantRate;
    } else {
      this.smoothedBytesPerSec =
        this.alpha * instantRate + (1 - this.alpha) * this.smoothedBytesPerSec;
    }

    this.history.push({ timeMs: nowMs, bytes: totalVerifiedBytes, rate: this.smoothedBytesPerSec });
    if (this.history.length > 40) {
      this.history.shift();
    }

    this.lastSampleTimeMs = nowMs;
    this.lastBytes = totalVerifiedBytes;
  }

  getThroughput() {
    return this.smoothedBytesPerSec;
  }

  getEtaSeconds(remainingBytes, nowMs = performance.now()) {
    if (remainingBytes <= 0) return 0;
    if (
      this.observations < this.minObservations ||
      nowMs - this.startTimeMs < this.minElapsedMs ||
      this.smoothedBytesPerSec < 64
    ) {
      return null; // Signals caller to display "Calibrating..." or "Calculating..."
    }
    return remainingBytes / this.smoothedBytesPerSec;
  }
}

export class FpsCounter {
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  tick(nowMs = performance.now()) {
    this.timestamps.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  getFps(nowMs = performance.now()) {
    const cutoff = nowMs - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    return (this.timestamps.length * 1000) / this.windowMs;
  }

  reset() {
    this.timestamps.length = 0;
  }
}
