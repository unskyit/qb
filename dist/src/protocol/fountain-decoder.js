/**
 * QuadBeam Hybrid LT Peeling + GF(2) Gaussian Elimination Fountain Decoder
 *
 * Reconstructs a generation of K source blocks (1 <= K <= 256) from any combination of:
 * 1. Direct systematic source blocks (degree = 1)
 * 2. Rateless LT fountain droplets (degree >= 1)
 *
 * Uses iterative belief-propagation peeling first (O(1) per reduced edge), and automatically
 * performs incremental GF(2) row reduction over unresolved variables so that as soon as K
 * linearly independent equations arrive, all K blocks are solved immediately with zero stall.
 */

import { deriveFountainIndices } from './fountain-encoder.js';

function xorBytesInPlace(target, source) {
  const len = target.length;
  for (let i = 0; i < len; i++) {
    target[i] ^= source[i];
  }
}

export class GenerationFountainDecoder {
  /**
   * @param {number} generationId
   * @param {number} K Number of source blocks in this generation (1..256)
   * @param {number} blockSize Standard block size in bytes
   * @param {number} lastBlockActualSize Actual byte length of block K-1 (for final file block)
   */
  constructor(generationId, K, blockSize, lastBlockActualSize = blockSize) {
    this.generationId = generationId;
    this.K = K;
    this.blockSize = blockSize;
    this.lastBlockActualSize = lastBlockActualSize;

    // Resolved source blocks (padded to blockSize during decoding)
    this.resolvedBlocks = new Array(K).fill(null);
    this.resolvedCount = 0;

    // Incremental GF(2) upper-triangular pivot table for unresolved variables:
    // pivots[col] = { indices: Set<number> sorted/bitset, payload: Uint8Array }
    this.pivots = new Array(K).fill(null);
    this.pivotCount = 0;
  }

  isComplete() {
    return this.resolvedCount === this.K;
  }

  getMissingBlockIndices() {
    const missing = [];
    for (let i = 0; i < this.K; i++) {
      if (this.resolvedBlocks[i] === null) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Add a direct systematic source block (index in [0, K-1]).
   * Returns number of newly resolved source blocks.
   */
  addSourceBlock(localIndex, payloadBytes) {
    if (localIndex < 0 || localIndex >= this.K) return 0;
    if (this.resolvedBlocks[localIndex] !== null) return 0; // Duplicate

    const padded = new Uint8Array(this.blockSize);
    padded.set(payloadBytes.subarray(0, Math.min(this.blockSize, payloadBytes.byteLength)));

    const before = this.resolvedCount;
    this._recordResolvedBlock(localIndex, padded);
    this._tryBackSubstituteAll();
    return this.resolvedCount - before;
  }

  /**
   * Add a fountain droplet defined by (degree, seed24, payloadBytes).
   * Returns number of newly resolved source blocks.
   */
  addFountainDroplet(degree, seed24, payloadBytes) {
    if (this.isComplete()) return 0;
    if (payloadBytes.byteLength !== this.blockSize) return 0;

    const rawIndices = deriveFountainIndices(this.K, degree, seed24);
    const payload = new Uint8Array(payloadBytes);

    // 1. Peel already-resolved source blocks out of this equation
    const activeIndices = [];
    for (let i = 0; i < rawIndices.length; i++) {
      const idx = rawIndices[i];
      if (this.resolvedBlocks[idx] !== null) {
        xorBytesInPlace(payload, this.resolvedBlocks[idx]);
      } else {
        activeIndices.push(idx);
      }
    }

    if (activeIndices.length === 0) {
      return 0; // Linearly dependent / redundant droplet
    }

    const before = this.resolvedCount;

    if (activeIndices.length === 1) {
      this._recordResolvedBlock(activeIndices[0], payload);
      this._tryBackSubstituteAll();
      return this.resolvedCount - before;
    }

    // 2. Insert into incremental GF(2) Gaussian elimination basis
    this._insertEquation(activeIndices, payload);
    this._tryBackSubstituteAll();

    return this.resolvedCount - before;
  }

  _recordResolvedBlock(idx, paddedPayload) {
    if (this.resolvedBlocks[idx] !== null) return;
    this.resolvedBlocks[idx] = paddedPayload;
    this.resolvedCount += 1;

    // If there was a pivot at `idx`, clear it and propagate
    if (this.pivots[idx] !== null) {
      this.pivots[idx] = null;
      this.pivotCount -= 1;
    }

    // Eliminate `idx` from all existing pivots
    for (let r = 0; r < this.K; r++) {
      const piv = this.pivots[r];
      if (!piv) continue;
      const pos = piv.indices.indexOf(idx);
      if (pos !== -1) {
        piv.indices.splice(pos, 1);
        xorBytesInPlace(piv.payload, paddedPayload);
      }
    }
  }

  _insertEquation(indices, payload) {
    let curIndices = indices.slice().sort((a, b) => a - b);
    const curPayload = payload;

    while (curIndices.length > 0) {
      const lead = curIndices[0];
      if (this.resolvedBlocks[lead] !== null) {
        curIndices.shift();
        xorBytesInPlace(curPayload, this.resolvedBlocks[lead]);
        continue;
      }

      if (curIndices.length === 1) {
        this._recordResolvedBlock(lead, curPayload);
        return;
      }

      const existing = this.pivots[lead];
      if (!existing) {
        this.pivots[lead] = {
          indices: curIndices,
          payload: curPayload
        };
        this.pivotCount += 1;
        return;
      }

      // XOR symmetric difference of sorted index arrays
      curIndices = symmetricDiffSorted(curIndices, existing.indices);
      xorBytesInPlace(curPayload, existing.payload);
    }
  }

  _tryBackSubstituteAll() {
    // Check if any pivot row was reduced to degree 1 (or 0) during elimination
    let progress = true;
    while (progress && this.resolvedCount < this.K) {
      progress = false;
      for (let r = 0; r < this.K; r++) {
        const piv = this.pivots[r];
        if (!piv) continue;

        if (piv.indices.length === 0) {
          this.pivots[r] = null;
          this.pivotCount -= 1;
          continue;
        }

        if (piv.indices.length === 1) {
          const solvedIdx = piv.indices[0];
          const solvedPayload = piv.payload;
          this.pivots[r] = null;
          this.pivotCount -= 1;
          this._recordResolvedBlock(solvedIdx, solvedPayload);
          progress = true;
          break;
        }
      }
    }

    // If remaining unresolved count equals active pivotCount, upper-triangular back-substitution solves everything!
    const unresolved = this.K - this.resolvedCount;
    if (unresolved > 0 && this.pivotCount === unresolved) {
      for (let r = this.K - 1; r >= 0; r--) {
        const piv = this.pivots[r];
        if (!piv) continue;
        // Reduce any higher-index variables that were just solved
        const remaining = [];
        for (const col of piv.indices) {
          if (this.resolvedBlocks[col] !== null) {
            xorBytesInPlace(piv.payload, this.resolvedBlocks[col]);
          } else {
            remaining.push(col);
          }
        }
        if (remaining.length === 1) {
          const solvedIdx = remaining[0];
          const solvedPayload = piv.payload;
          this.pivots[r] = null;
          this.pivotCount -= 1;
          this._recordResolvedBlock(solvedIdx, solvedPayload);
        }
      }
    }
  }

  /**
   * Export the K reconstructed blocks with exact byte lengths (trimming padding on block K-1).
   */
  exportBlocks() {
    if (!this.isComplete()) {
      return null;
    }
    return this.resolvedBlocks.map((blk, idx) => {
      if (idx === this.K - 1 && this.lastBlockActualSize < this.blockSize) {
        return blk.subarray(0, this.lastBlockActualSize);
      }
      return blk;
    });
  }
}

function symmetricDiffSorted(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) {
      out.push(a[i++]);
    } else if (a[i] > b[j]) {
      out.push(b[j++]);
    } else {
      i++;
      j++;
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}
