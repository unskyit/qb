/**
 * QuadBeam Streaming & Bounded-Chunk File Reader
 * Reads browser File/Blob objects (up to 50+ MiB) or Uint8Array buffers in bounded slices
 * so the entire 50 MiB file never needs to reside in memory at once.
 */

import { IncrementalSha256, encryptChunkAesGcm } from '../protocol/integrity.js';
import { DEFAULT_GENERATION_BLOCKS } from '../protocol/constants.js';
import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

const HASH_SLICE_SIZE = 1024 * 1024; // 1 MiB streaming slice for SHA-256 computation

export class ChunkedFileSource {
  /**
   * @param {File|Blob|Uint8Array} source
   * @param {Object} options
   * @param {string} [options.filename]
   * @param {string} [options.mimeType]
   * @param {number} [options.blockSize=220]
   * @param {number} [options.generationSize=256]
   * @param {CryptoKey} [options.encryptionKey=null]
   * @param {Uint8Array} [options.encryptionIvBase=null]
   */
  constructor(source, options = {}) {
    this.source = source;
    this.isByteBuffer = source instanceof Uint8Array;
    this.fileSize = this.isByteBuffer ? source.byteLength : Number(source.size || 0);
    this.filename = options.filename || (source && source.name) || 'transfer.bin';
    this.mimeType = options.mimeType || (source && source.type) || 'application/octet-stream';
    this.blockSize = options.blockSize || 220;
    this.generationSize = options.generationSize || DEFAULT_GENERATION_BLOCKS;

    this.encryptionKey = options.encryptionKey || null;
    this.encryptionIvBase = options.encryptionIvBase || null;

    this.totalBlocks = Math.max(1, Math.ceil(this.fileSize / this.blockSize));
    this.totalGenerations = Math.max(1, Math.ceil(this.totalBlocks / this.generationSize));
    this.sha256Digest = null;

    // Bounded LRU cache of at most 2 generation block arrays in memory
    this.generationCache = new Map();
  }

  async readSlice(start, end) {
    const clampedStart = Math.max(0, Math.min(this.fileSize, start));
    const clampedEnd = Math.max(clampedStart, Math.min(this.fileSize, end));
    if (clampedEnd === clampedStart) {
      return new Uint8Array(0);
    }
    if (this.isByteBuffer) {
      return this.source.subarray(clampedStart, clampedEnd);
    }
    try {
      const blobSlice = this.source.slice(clampedStart, clampedEnd);
      const ab = await blobSlice.arrayBuffer();
      return new Uint8Array(ab);
    } catch (err) {
      throw new QuadBeamError(
        ERROR_CODES.FILE_READ_FAILED,
        `Failed to read file slice [${clampedStart}..${clampedEnd}]: ${err?.message || err}`,
        'Ensure the selected file has not been moved or deleted from disk.'
      );
    }
  }

  /**
   * Compute full-file SHA-256 digest incrementally in 1 MiB slices.
   * Calls `onProgress(bytesHashed, totalBytes)` if provided.
   */
  async computeSha256(onProgress = null) {
    const hasher = new IncrementalSha256();
    let offset = 0;

    while (offset < this.fileSize) {
      const nextEnd = Math.min(this.fileSize, offset + HASH_SLICE_SIZE);
      const chunk = await this.readSlice(offset, nextEnd);
      hasher.update(chunk);
      offset = nextEnd;
      if (onProgress) {
        onProgress(offset, this.fileSize);
      }
      // Yield briefly on huge files in browser main thread to keep UI responsive
      if (!this.isByteBuffer && offset < this.fileSize && offset % (8 * HASH_SLICE_SIZE) === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    this.sha256Digest = hasher.digest();
    return this.sha256Digest;
  }

  /**
   * Read and split all blocks belonging to `generationId` (up to `generationSize` blocks).
   */
  async getGenerationBlocks(generationId) {
    if (this.generationCache.has(generationId)) {
      return this.generationCache.get(generationId);
    }

    const startBlock = generationId * this.generationSize;
    const endBlock = Math.min(this.totalBlocks, startBlock + this.generationSize);
    const blockCount = Math.max(1, endBlock - startBlock);

    const byteStart = startBlock * this.blockSize;
    const byteEnd = Math.min(this.fileSize, endBlock * this.blockSize);
    const genBytes = await this.readSlice(byteStart, byteEnd);

    const blocks = new Array(blockCount);
    if (this.fileSize === 0) {
      blocks[0] = new Uint8Array(0);
    } else {
      for (let i = 0; i < blockCount; i++) {
        const localStart = i * this.blockSize;
        const localEnd = Math.min(genBytes.byteLength, localStart + this.blockSize);
        let blk = genBytes.subarray(localStart, localEnd);
        if (this.encryptionKey && this.encryptionIvBase) {
          blk = await encryptChunkAesGcm(
            this.encryptionKey,
            this.encryptionIvBase,
            startBlock + i,
            blk
          );
        }
        blocks[i] = blk;
      }
    }

    if (this.generationCache.size >= 2) {
      const oldest = this.generationCache.keys().next().value;
      this.generationCache.delete(oldest);
    }
    this.generationCache.set(generationId, blocks);
    return blocks;
  }
}
