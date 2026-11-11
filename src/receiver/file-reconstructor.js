/**
 * QuadBeam Bounded-Memory File Reconstruction & Cryptographic Verification Engine
 *
 * Reconstructs files up to 50+ MiB from any arrival order of:
 * - METADATA packets (even if the receiver joins mid-stream!)
 * - SOURCE_BLOCK packets (systematic degree-1 blocks)
 * - FOUNTAIN_BLOCK packets (Luby Transform Robust Soliton droplets)
 *
 * Uses bounded per-generation decoders (`GenerationFountainDecoder`) and flushes each
 * completed generation to `TemporaryStorageManager` (OPFS disk or consolidated staging)
 * so memory remains bounded regardless of total file size.
 * Never marks a file complete until its full-file SHA-256 digest matches the announced digest.
 */

import { PACKET_TYPE, DEFAULT_MAX_FILE_SIZE } from '../protocol/constants.js';
import { unpackFountainSeed } from '../protocol/packet-format.js';
import { decodeMetadataPayload } from '../protocol/metadata.js';
import { GenerationFountainDecoder } from '../protocol/fountain-decoder.js';
import { encodeRepairRequest } from '../protocol/recovery.js';
import {
  IncrementalSha256,
  digestsEqual,
  bytesToHex,
  deriveAesGcmKey,
  decryptChunkAesGcm
} from '../protocol/integrity.js';
import { TemporaryStorageManager } from '../storage/temporary-storage.js';
import { ThroughputEstimator } from '../utils/timing.js';
import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

export class FileReconstructor {
  constructor(options = {}) {
    this.maxAllowedFileSize = options.maxAllowedFileSize || DEFAULT_MAX_FILE_SIZE;
    this.storage = options.storage || new TemporaryStorageManager({ preferOpfs: options.preferOpfs !== false });
    this.throughputEstimator = new ThroughputEstimator();
    this.reset();
  }

  reset() {
    this.sessionId = null;
    this.fileId = null;
    this.metadata = null;

    // Buffered packets that arrived BEFORE the first METADATA packet (for late-joining receivers)
    this.preMetadataQueue = [];

    // Active generation decoders: Map<generationId, GenerationFountainDecoder>
    this.generationDecoders = new Map();
    // Completed generations bitset / Set<generationId>
    this.completedGenerations = new Set();
    // Count of resolved blocks per generation: Uint16Array(totalGenerations)
    this.resolvedBlocksByGen = null;

    this.totalResolvedBlocks = 0;
    this.fountainRecoveredBlocks = 0;
    this.verifiedSourceBytes = 0;
    this.packetsReceived = 0;

    this.state = 'waiting-metadata'; // 'waiting-metadata' | 'receiving' | 'verifying' | 'completed' | 'failed'
    this.verificationResult = null;
    this.reconstructedBlob = null;
    this.error = null;
    this.throughputEstimator.reset();

    // Queue of async generation flushes to ensure all generations are persisted before SHA-256 check
    this.pendingFlushPromises = [];
  }

  /**
   * Process a validated, deduplicated packet from PacketCollector.
   */
  async processPacket(packet, nowMs = performance.now()) {
    if (this.state === 'completed' || this.state === 'failed') {
      return this.getProgressSnapshot(nowMs);
    }

    this.packetsReceived += 1;

    if (packet.packetType === PACKET_TYPE.METADATA) {
      await this._handleMetadataPacket(packet, nowMs);
      return this.getProgressSnapshot(nowMs);
    }

    if (!this.metadata) {
      // Receiver joined mid-stream before seeing a METADATA packet: buffer up to 128 packets
      if (this.preMetadataQueue.length < 128) {
        this.preMetadataQueue.push(packet);
      }
      return this.getProgressSnapshot(nowMs);
    }

    await this._ingestDataPacket(packet, nowMs);

    if (this.isAllBlocksResolved() && this.state === 'receiving') {
      await this.finalizeAndVerify();
    }

    return this.getProgressSnapshot(nowMs);
  }

  async _handleMetadataPacket(packet, nowMs) {
    if (this.metadata) {
      return; // Already initialized
    }

    const meta = decodeMetadataPayload(packet.payload, this.maxAllowedFileSize);
    await this.storage.checkQuotaForSize(meta.fileSize);

    this.sessionId = packet.sessionId;
    this.fileId = packet.fileId;
    this.metadata = meta;
    this.resolvedBlocksByGen = new Uint16Array(meta.totalGenerations);
    this.state = 'receiving';

    // Replay any packets captured before metadata arrived
    if (this.preMetadataQueue.length > 0) {
      const queued = this.preMetadataQueue.splice(0, this.preMetadataQueue.length);
      for (const pkt of queued) {
        if (pkt.sessionId === this.sessionId && pkt.fileId === this.fileId) {
          await this._ingestDataPacket(pkt, nowMs);
        }
      }
      if (this.isAllBlocksResolved() && this.state === 'receiving') {
        await this.finalizeAndVerify();
      }
    }
  }

  _getExpectedGenerationBlockCount(genId) {
    const startBlock = genId * this.metadata.generationSize;
    const endBlock = Math.min(this.metadata.totalBlocks, startBlock + this.metadata.generationSize);
    return Math.max(1, endBlock - startBlock);
  }

  _getBlockActualByteSize(globalBlockIndex) {
    if (this.metadata.fileSize === 0) return 0;
    const startByte = globalBlockIndex * this.metadata.blockSize;
    const endByte = Math.min(this.metadata.fileSize, startByte + this.metadata.blockSize);
    const plainSize = Math.max(0, endByte - startByte);
    // If AES-GCM encrypted, each block carries a 16-byte authentication tag
    return this.metadata.encryptionMode === 1 ? plainSize + 16 : plainSize;
  }

  _getOrCreateGenDecoder(genId) {
    if (this.generationDecoders.has(genId)) {
      return this.generationDecoders.get(genId);
    }
    const K = this._getExpectedGenerationBlockCount(genId);
    const lastGlobalIdx = genId * this.metadata.generationSize + (K - 1);
    const lastBlockActualSize = this._getBlockActualByteSize(lastGlobalIdx);
    const effectiveBlockSize =
      this.metadata.encryptionMode === 1 ? this.metadata.blockSize + 16 : this.metadata.blockSize;

    const dec = new GenerationFountainDecoder(
      genId,
      K,
      effectiveBlockSize,
      lastBlockActualSize
    );
    this.generationDecoders.set(genId, dec);
    return dec;
  }

  async _ingestDataPacket(packet, nowMs) {
    const genId = packet.generationId;
    if (genId < 0 || genId >= this.metadata.totalGenerations) return;
    if (this.completedGenerations.has(genId)) return;

    const decoder = this._getOrCreateGenDecoder(genId);
    let newlyResolved = 0;

    if (packet.packetType === PACKET_TYPE.SOURCE_BLOCK) {
      const localIdx = packet.blockIndexOrSeed;
      newlyResolved = decoder.addSourceBlock(localIdx, packet.payload);
      if (newlyResolved > 1) {
        // Solving this source block cascaded and peeled pending fountain equations!
        this.fountainRecoveredBlocks += newlyResolved - 1;
      }
    } else if (packet.packetType === PACKET_TYPE.FOUNTAIN_BLOCK) {
      const { degree, seed } = unpackFountainSeed(packet.blockIndexOrSeed);
      newlyResolved = decoder.addFountainDroplet(degree, seed, packet.payload);
      if (newlyResolved > 0) {
        this.fountainRecoveredBlocks += newlyResolved;
      }
    }

    if (newlyResolved > 0) {
      this.resolvedBlocksByGen[genId] = decoder.resolvedCount;
      this.totalResolvedBlocks += newlyResolved;

      // Update verified byte count accurately
      const ratio = Math.min(1, this.totalResolvedBlocks / this.metadata.totalBlocks);
      this.verifiedSourceBytes = Math.min(
        this.metadata.fileSize,
        Math.round(ratio * this.metadata.fileSize)
      );
      this.throughputEstimator.record(this.verifiedSourceBytes, nowMs);
    }

    if (decoder.isComplete() && !this.completedGenerations.has(genId)) {
      this.completedGenerations.add(genId);
      const blocks = decoder.exportBlocks();
      // Free generation decoder immediately to bound RAM
      this.generationDecoders.delete(genId);

      // Consolidate generation blocks into a single contiguous Uint8Array and flush to storage
      const totalGenBytes = blocks.reduce((acc, b) => acc + b.byteLength, 0);
      const contiguous = new Uint8Array(totalGenBytes);
      let off = 0;
      for (const b of blocks) {
        contiguous.set(b, off);
        off += b.byteLength;
      }

      const flushPromise = this.storage.writeGeneration(
        this.sessionId,
        this.fileId,
        genId,
        contiguous
      );
      this.pendingFlushPromises.push(flushPromise);
    }
  }

  isAllBlocksResolved() {
    return Boolean(this.metadata && this.totalResolvedBlocks >= this.metadata.totalBlocks);
  }

  /**
   * Return all missing global block indices across incomplete generations (for Repair QR).
   */
  getMissingGlobalBlockIndices() {
    if (!this.metadata) return [];
    const missing = [];
    for (let g = 0; g < this.metadata.totalGenerations; g++) {
      if (this.completedGenerations.has(g)) continue;
      const startGlobal = g * this.metadata.generationSize;
      const K = this._getExpectedGenerationBlockCount(g);
      const dec = this.generationDecoders.get(g);
      if (!dec) {
        for (let i = 0; i < K; i++) missing.push(startGlobal + i);
      } else {
        const localMissing = dec.getMissingBlockIndices();
        for (const idx of localMissing) missing.push(startGlobal + idx);
      }
    }
    return missing;
  }

  /**
   * Generate a compact Repair Request QR code payload for any missing blocks.
   */
  generateRepairQr() {
    if (!this.metadata) return null;
    const missingBlockIndices = this.getMissingGlobalBlockIndices();
    return encodeRepairRequest({
      sessionId: this.sessionId,
      fileId: this.fileId,
      missingBlockIndices
    });
  }

  /**
   * Finalize all staged generations, optionally decrypt if encrypted, and verify
   * full-file byte length and SHA-256 cryptographic digest.
   */
  async finalizeAndVerify(password = '') {
    if (!this.metadata) {
      throw new QuadBeamError(ERROR_CODES.RECONSTRUCTION_INCOMPLETE, 'Metadata not received');
    }
    if (!this.isAllBlocksResolved()) {
      throw new QuadBeamError(
        ERROR_CODES.RECONSTRUCTION_INCOMPLETE,
        `Reconstruction incomplete (${this.totalResolvedBlocks}/${this.metadata.totalBlocks} blocks)`
      );
    }

    this.state = 'verifying';
    await Promise.all(this.pendingFlushPromises);
    this.pendingFlushPromises = [];

    let aesKey = null;
    if (this.metadata.encryptionMode === 1) {
      if (!password) {
        throw new QuadBeamError(
          ERROR_CODES.DECRYPTION_FAILED,
          'This transfer is encrypted. Enter the sender password to decrypt and verify the file.'
        );
      }
      aesKey = await deriveAesGcmKey(password, this.metadata.encryptionSalt);
    }

    const hasher = new IncrementalSha256();
    let totalBytesVerified = 0;

    for (let g = 0; g < this.metadata.totalGenerations; g++) {
      let genBytes = await this.storage.readGeneration(this.sessionId, this.fileId, g);

      if (this.metadata.encryptionMode === 1 && aesKey) {
        // Decrypt each block in generation g
        const K = this._getExpectedGenerationBlockCount(g);
        const startGlobal = g * this.metadata.generationSize;
        const plainChunks = [];
        let offset = 0;
        for (let i = 0; i < K; i++) {
          const encBlkLen = this._getBlockActualByteSize(startGlobal + i);
          const cipherSlice = genBytes.subarray(offset, offset + encBlkLen);
          offset += encBlkLen;
          try {
            const plainBlk = await decryptChunkAesGcm(
              aesKey,
              this.metadata.encryptionIvBase,
              startGlobal + i,
              cipherSlice
            );
            plainChunks.push(plainBlk);
          } catch {
            this.state = 'failed';
            throw new QuadBeamError(
              ERROR_CODES.DECRYPTION_FAILED,
              'AES-256-GCM decryption failed: incorrect password or tampered ciphertext.'
            );
          }
        }
        const totalPlain = plainChunks.reduce((acc, c) => acc + c.byteLength, 0);
        const mergedPlain = new Uint8Array(totalPlain);
        let pOff = 0;
        for (const c of plainChunks) {
          mergedPlain.set(c, pOff);
          pOff += c.byteLength;
        }
        genBytes = mergedPlain;
        await this.storage.writeGeneration(this.sessionId, this.fileId, g, genBytes);
      }

      hasher.update(genBytes);
      totalBytesVerified += genBytes.byteLength;
    }

    if (totalBytesVerified !== this.metadata.fileSize) {
      this.state = 'failed';
      this.error = new QuadBeamError(
        ERROR_CODES.INTEGRITY_HASH_MISMATCH,
        `Reconstructed byte length (${totalBytesVerified}) does not match announced file size (${this.metadata.fileSize}).`
      );
      throw this.error;
    }

    const computedDigest = hasher.digest();
    const matches = digestsEqual(computedDigest, this.metadata.sha256Digest);

    this.verificationResult = {
      verified: matches,
      expectedSha256Hex: bytesToHex(this.metadata.sha256Digest),
      actualSha256Hex: bytesToHex(computedDigest),
      fileSize: totalBytesVerified
    };

    if (!matches) {
      this.state = 'failed';
      this.error = new QuadBeamError(
        ERROR_CODES.INTEGRITY_HASH_MISMATCH,
        'SHA-256 cryptographic digest mismatch! The reconstructed file did not pass integrity verification.',
        'Use the Recovery QR to request retransmission of corrupted generations.'
      );
      throw this.error;
    }

    this.reconstructedBlob = await this.storage.assembleFileBlob(
      this.sessionId,
      this.fileId,
      this.metadata.totalGenerations,
      this.metadata.mimeType
    );

    this.verifiedSourceBytes = this.metadata.fileSize;
    this.state = 'completed';
    return this.verificationResult;
  }

  /**
   * Read the entire reconstructed file as a single Uint8Array (useful for automated tests and small previews).
   */
  async exportReconstructedBytes() {
    if (this.state !== 'completed') {
      throw new Error('Cannot export unverified file bytes');
    }
    const chunks = [];
    let totalLen = 0;
    for (let g = 0; g < this.metadata.totalGenerations; g++) {
      const genBytes = await this.storage.readGeneration(this.sessionId, this.fileId, g);
      chunks.push(genBytes);
      totalLen += genBytes.byteLength;
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  getProgressSnapshot(nowMs = performance.now()) {
    const totalBlocks = this.metadata ? this.metadata.totalBlocks : 0;
    const progressRatio = totalBlocks > 0 ? Math.min(1, this.totalResolvedBlocks / totalBlocks) : 0;
    const remainingBytes = this.metadata
      ? Math.max(0, this.metadata.fileSize - this.verifiedSourceBytes)
      : 0;

    return {
      state: this.state,
      sessionId: this.sessionId,
      fileId: this.fileId,
      filename: this.metadata ? this.metadata.filename : null,
      fileSize: this.metadata ? this.metadata.fileSize : 0,
      mimeType: this.metadata ? this.metadata.mimeType : null,
      encrypted: Boolean(this.metadata && this.metadata.encryptionMode === 1),
      totalBlocks,
      resolvedBlocks: this.totalResolvedBlocks,
      fountainRecoveredBlocks: this.fountainRecoveredBlocks,
      completedGenerations: this.completedGenerations.size,
      totalGenerations: this.metadata ? this.metadata.totalGenerations : 0,
      progressRatio,
      verifiedSourceBytes: this.verifiedSourceBytes,
      packetsReceived: this.packetsReceived,
      throughputBytesPerSec: this.throughputEstimator.getThroughput(),
      etaSeconds: this.throughputEstimator.getEtaSeconds(remainingBytes, nowMs),
      verificationResult: this.verificationResult
    };
  }
}
