/**
 * QuadBeam Receiver Packet Collector, Validator & Deduplicator
 *
 * Enforces:
 * - Strict CRC32 & protocol header validation
 * - Session & File ID isolation (prevents mixing packets from another session)
 * - Bounded sliding deduplication window so repeated camera frames are ignored in O(1)
 * - Calibration probe measurement and profile recommendation
 */

import { PACKET_TYPE } from '../protocol/constants.js';
import { parsePacket } from '../protocol/packet-parser.js';
import { decodePacketWire } from '../protocol/encoding.js';
import { FpsCounter } from '../utils/timing.js';

export class PacketCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.activeSessionId = null;
    this.activeFileId = null;
    this.seenRing = new Uint32Array(4096);
    this.seenSet = new Set();
    this.seenRingPos = 0;

    this.validPacketsCount = 0;
    this.duplicatePacketsCount = 0;
    this.corruptPacketsCount = 0;
    this.foreignSessionCount = 0;
    this.validPacketRateCounter = new FpsCounter(1000);

    // Calibration tracking
    this.calibrationSamples = [];
    this.calibrationStartTimeMs = 0;
  }

  _makeDedupKey(parsed) {
    // Combine packetType, generationId, sequenceId, and blockIndexOrSeed
    return `${parsed.packetType}:${parsed.generationId}:${parsed.sequenceId}:${parsed.blockIndexOrSeed}`;
  }

  /**
   * Ingest a raw QR scan result (`{ rawValue, rawBytes, cornerPoints, panelIndex }`)
   * or a raw packet Uint8Array directly.
   */
  ingestRawScan(scanItem, nowMs = performance.now()) {
    let packetBytes;
    try {
      packetBytes =
        scanItem instanceof Uint8Array
          ? scanItem
          : decodePacketWire(scanItem);
    } catch {
      this.corruptPacketsCount += 1;
      return { status: 'corrupt', reason: 'Wire decoding failed' };
    }

    let parsed;
    try {
      parsed = parsePacket(packetBytes);
    } catch (err) {
      this.corruptPacketsCount += 1;
      return { status: 'corrupt', reason: err?.message || 'Packet parse failed' };
    }

    // Calibration packets are handled separately
    if (parsed.packetType === PACKET_TYPE.CALIBRATION) {
      return this._handleCalibrationPacket(parsed, nowMs);
    }

    // Lock onto sessionId + fileId on first valid transfer packet
    if (this.activeSessionId === null) {
      this.activeSessionId = parsed.sessionId;
      this.activeFileId = parsed.fileId;
    } else if (parsed.sessionId !== this.activeSessionId || parsed.fileId !== this.activeFileId) {
      this.foreignSessionCount += 1;
      return {
        status: 'foreign-session',
        sessionId: parsed.sessionId,
        fileId: parsed.fileId
      };
    }

    // Deduplicate
    const dedupKey = this._makeDedupKey(parsed);
    if (this.seenSet.has(dedupKey)) {
      this.duplicatePacketsCount += 1;
      return { status: 'duplicate', packet: parsed };
    }

    // Bounded deduplication set (max 8192 keys)
    if (this.seenSet.size >= 8192) {
      const oldest = this.seenSet.values().next().value;
      this.seenSet.delete(oldest);
    }
    this.seenSet.add(dedupKey);

    this.validPacketsCount += 1;
    this.validPacketRateCounter.tick(nowMs);

    return {
      status: 'valid',
      packet: parsed
    };
  }

  _handleCalibrationPacket(parsed, nowMs) {
    if (this.calibrationStartTimeMs === 0) {
      this.calibrationStartTimeMs = nowMs;
    }
    const dedupKey = `cal:${parsed.sequenceId}:${parsed.panelId}`;
    if (this.seenSet.has(dedupKey)) {
      this.duplicatePacketsCount += 1;
      return { status: 'duplicate-calibration', packet: parsed };
    }
    this.seenSet.add(dedupKey);
    this.validPacketsCount += 1;
    this.validPacketRateCounter.tick(nowMs);

    const targetFps = (parsed.blockIndexOrSeed >>> 16) & 0xff;
    const qrCount = (parsed.blockIndexOrSeed >>> 8) & 0xff;
    const probeBlockSize = parsed.payloadLength;

    this.calibrationSamples.push({
      timeMs: nowMs,
      sequenceId: parsed.sequenceId,
      panelId: parsed.panelId,
      targetFps,
      qrCount,
      probeBlockSize
    });

    return {
      status: 'calibration',
      packet: parsed,
      summary: this.getCalibrationRecommendation(nowMs)
    };
  }

  getCalibrationRecommendation(nowMs = performance.now()) {
    const count = this.calibrationSamples.length;
    if (count < 3) {
      return {
        ready: false,
        samples: count,
        measuredPacketsPerSec: 0,
        measuredBytesPerSec: 0,
        recommendedProfile: 'balanced'
      };
    }

    const elapsedSec = Math.max(0.25, (nowMs - this.calibrationStartTimeMs) / 1000);
    const packetsPerSec = count / elapsedSec;
    const avgBlockSize =
      this.calibrationSamples.reduce((acc, s) => acc + s.probeBlockSize, 0) / count;
    const measuredBytesPerSec = packetsPerSec * avgBlockSize;

    const distinctPanels = new Set(this.calibrationSamples.map((s) => s.panelId)).size;
    let recommendedProfile = 'balanced';
    if (packetsPerSec >= 32 && distinctPanels >= 3) {
      recommendedProfile = 'turbo';
    } else if (packetsPerSec < 8 || distinctPanels === 1) {
      recommendedProfile = 'reliable';
    }

    return {
      ready: true,
      samples: count,
      distinctPanelsSeen: distinctPanels,
      measuredPacketsPerSec: Number(packetsPerSec.toFixed(1)),
      measuredBytesPerSec: Math.round(measuredBytesPerSec),
      recommendedProfile
    };
  }
}
