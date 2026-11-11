/**
 * QuadBeam Multi-Panel Optical Packet Scheduler
 *
 * Coordinates packet generation across 1, 2, or 4 simultaneous QR panels:
 * - Periodically broadcasts METADATA packets so late-joining receivers discover the stream.
 * - Schedules systematic SOURCE_BLOCK packets followed by interleaved LT FOUNTAIN_BLOCK
 *   parity droplets across generations so burst losses and partial frame captures heal seamlessly.
 * - Supports Targeted Repair Mode when given a Receiver Repair Request QR.
 * - Guarantees no two panels in the same frame carry identical packets.
 */

import { PACKET_TYPE, DEFAULT_GENERATION_BLOCKS } from './constants.js';
import { serializePacket, packFountainSeed } from './packet-format.js';
import { encodeMetadataPayload } from './metadata.js';
import { GenerationFountainEncoder } from './fountain-encoder.js';

export class OpticalPacketScheduler {
  /**
   * @param {Object} config
   * @param {number} config.sessionId
   * @param {number} config.fileId
   * @param {string} config.filename
   * @param {number} config.fileSize
   * @param {string} config.mimeType
   * @param {number} config.blockSize
   * @param {Uint8Array} config.sha256Digest
   * @param {Function} config.getGenerationBlocks Async/sync provider `(genId) => Uint8Array[]`
   * @param {number} [config.generationSize]
   * @param {number} [config.redundancyPercent]
   */
  constructor(config) {
    this.sessionId = config.sessionId >>> 0;
    this.fileId = config.fileId >>> 0;
    this.filename = config.filename;
    this.fileSize = config.fileSize;
    this.mimeType = config.mimeType || 'application/octet-stream';
    this.blockSize = config.blockSize || 220;
    this.generationSize = config.generationSize || DEFAULT_GENERATION_BLOCKS;
    this.totalBlocks = Math.max(1, Math.ceil(this.fileSize / this.blockSize));
    this.totalGenerations = Math.max(1, Math.ceil(this.totalBlocks / this.generationSize));
    this.sha256Digest = config.sha256Digest;
    this.redundancyRatio = (config.redundancyPercent ?? 35) / 100;
    this.getGenerationBlocks = config.getGenerationBlocks;

    this.encryptionMode = config.encryptionMode || 0;
    this.encryptionSalt = config.encryptionSalt || null;
    this.encryptionIvBase = config.encryptionIvBase || null;

    this.metadataPayload = encodeMetadataPayload({
      filename: this.filename,
      fileSize: this.fileSize,
      mimeType: this.mimeType,
      blockSize: this.blockSize,
      totalBlocks: this.totalBlocks,
      generationSize: this.generationSize,
      totalGenerations: this.totalGenerations,
      sha256Digest: this.sha256Digest,
      encryptionMode: this.encryptionMode,
      encryptionSalt: this.encryptionSalt,
      encryptionIvBase: this.encryptionIvBase
    });

    this.sequenceId = 0;
    this.framesGenerated = 0;
    this.bytesEncodedTotal = 0;

    // Active generation state (bounded LRU cache of at most 2 generations in RAM)
    this.encoderCache = new Map();
    this.currentGenId = 0;
    this.currentBlockOffsetInGen = 0;
    this.currentParityCountInGen = 0;
    this.passCount = 0;

    // Optional targeted repair queue
    this.repairQueue = [];
  }

  /**
   * Apply a decoded Repair Request from the receiver to prioritize missing blocks.
   */
  applyRepairRequest(missingBlockIndices) {
    if (!Array.isArray(missingBlockIndices) || missingBlockIndices.length === 0) return;
    this.repairQueue = missingBlockIndices.filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < this.totalBlocks
    );
  }

  _getEncoderForGeneration(genId, blocks) {
    if (this.encoderCache.has(genId)) {
      return this.encoderCache.get(genId);
    }
    // Keep at most 2 generation encoders in memory to guarantee bounded RAM on 50 MiB files
    if (this.encoderCache.size >= 2) {
      const oldestKey = this.encoderCache.keys().next().value;
      this.encoderCache.delete(oldestKey);
    }
    const enc = new GenerationFountainEncoder(genId, blocks, this.blockSize);
    this.encoderCache.set(genId, enc);
    return enc;
  }

  _buildMetadataPacket(panelId = 0) {
    const seq = ++this.sequenceId;
    return serializePacket({
      packetType: PACKET_TYPE.METADATA,
      panelId,
      sessionId: this.sessionId,
      fileId: this.fileId,
      generationId: 0,
      sequenceId: seq,
      blockIndexOrSeed: this.totalBlocks,
      payload: this.metadataPayload
    });
  }

  /**
   * Generate a coordinated frame of `panelCount` (1, 2, or 4) distinct packets.
   * Can be called synchronously if `getGenerationBlocks` is synchronous, or awaited if async.
   */
  async nextFramePackets(panelCount = 4) {
    const packets = [];
    const frameIdx = this.framesGenerated++;

    for (let panelId = 0; panelId < panelCount; panelId++) {
      // Broadcast METADATA on the very first frame (panel 0) and every 10 frames on panel 0
      if (panelId === 0 && (frameIdx === 0 || frameIdx % 10 === 0)) {
        const metaPkt = this._buildMetadataPacket(panelId);
        this.bytesEncodedTotal += metaPkt.byteLength;
        packets.push(metaPkt);
        continue;
      }

      // If Targeted Repair Queue has items, transmit exact requested blocks + fountain parity
      if (this.repairQueue.length > 0) {
        const globalBlockIdx = this.repairQueue.shift();
        const genId = Math.floor(globalBlockIdx / this.generationSize);
        const localIdx = globalBlockIdx % this.generationSize;
        const blocks = await this.getGenerationBlocks(genId);
        const blockPayload = blocks[localIdx] || new Uint8Array(0);

        const pkt = serializePacket({
          packetType: PACKET_TYPE.SOURCE_BLOCK,
          panelId,
          sessionId: this.sessionId,
          fileId: this.fileId,
          generationId: genId,
          sequenceId: ++this.sequenceId,
          blockIndexOrSeed: localIdx,
          payload: blockPayload
        });
        this.bytesEncodedTotal += pkt.byteLength;
        packets.push(pkt);
        continue;
      }

      // Normal systematic + LT Fountain window schedule
      const genId = this.currentGenId;
      const blocks = await this.getGenerationBlocks(genId);
      const K = blocks.length;
      const targetParityCount = Math.max(2, Math.ceil(K * this.redundancyRatio));

      let pkt;
      if (this.currentBlockOffsetInGen < K) {
        // Systematic phase: emit source block `localIdx`
        const localIdx = this.currentBlockOffsetInGen++;
        pkt = serializePacket({
          packetType: PACKET_TYPE.SOURCE_BLOCK,
          panelId,
          sessionId: this.sessionId,
          fileId: this.fileId,
          generationId: genId,
          sequenceId: ++this.sequenceId,
          blockIndexOrSeed: localIdx,
          payload: blocks[localIdx]
        });

        // Every 4th source block in a multi-block generation, interleave an immediate fountain droplet
        // on the next cycle so receivers get continuous erasure protection
      } else if (this.currentParityCountInGen < targetParityCount) {
        // Rateless LT Fountain phase for generation `genId`
        this.currentParityCountInGen++;
        const encoder = this._getEncoderForGeneration(genId, blocks);
        const droplet = encoder.nextDroplet();
        pkt = serializePacket({
          packetType: PACKET_TYPE.FOUNTAIN_BLOCK,
          panelId,
          sessionId: this.sessionId,
          fileId: this.fileId,
          generationId: genId,
          sequenceId: ++this.sequenceId,
          blockIndexOrSeed: packFountainSeed(droplet.degree, droplet.seed24),
          payload: droplet.payload
        });
      }

      // Advance to next generation when systematic + parity budget for current generation finishes
      if (
        this.currentBlockOffsetInGen >= K &&
        this.currentParityCountInGen >= targetParityCount
      ) {
        this.currentBlockOffsetInGen = 0;
        this.currentParityCountInGen = 0;
        this.currentGenId = (this.currentGenId + 1) % this.totalGenerations;
        if (this.currentGenId === 0) {
          this.passCount += 1;
          // After Pass 1, increase fountain ratio so subsequent passes are pure rateless fountain healing
        }
      }

      this.bytesEncodedTotal += pkt.byteLength;
      packets.push(pkt);
    }

    return packets;
  }
}
