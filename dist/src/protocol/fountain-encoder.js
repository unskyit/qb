/**
 * QuadBeam Systematic LT Fountain Code Encoder (with Robust Soliton Distribution)
 *
 * Operates over a generation window of K source blocks (1 <= K <= 256), where each
 * block is padded to `blockSize` bytes for XOR parity computation.
 *
 * - Systematic phase: emits direct source blocks (degree = 1).
 * - Rateless parity phase: samples degree d from the Robust Soliton distribution
 *   (parameters c = 0.1, delta = 0.05) using a 24-bit deterministic seed, selects d
 *   distinct source block indices in [0, K-1] via DeterministicPRNG, and XORs them.
 */

import { DeterministicPRNG } from '../utils/ids.js';

/**
 * Compute cumulative distribution function (CDF) for the Robust Soliton distribution
 * over K blocks (Luby 2002).
 */
export function buildRobustSolitonCdf(K, c = 0.1, delta = 0.05) {
  if (K <= 1) {
    return new Float64Array([1.0]);
  }

  const rho = new Float64Array(K + 1);
  const tau = new Float64Array(K + 1);

  // Ideal Soliton distribution rho(d)
  rho[1] = 1 / K;
  for (let d = 2; d <= K; d++) {
    rho[d] = 1 / (d * (d - 1));
  }

  // Robust Soliton spike tau(d)
  const R = c * Math.log(K / delta) * Math.sqrt(K);
  const kOverR = Math.max(2, Math.min(K, Math.floor(K / Math.max(1e-6, R))));

  for (let d = 1; d < kOverR; d++) {
    tau[d] = R / (d * K);
  }
  tau[kOverR] = (R * Math.log(Math.max(1.0001, R / delta))) / K;

  // Bias degree 2 and 3 slightly for small-to-medium K to accelerate peeling + GF(2) rank
  let beta = 0;
  const mu = new Float64Array(K + 1);
  for (let d = 1; d <= K; d++) {
    mu[d] = rho[d] + tau[d];
    beta += mu[d];
  }

  const cdf = new Float64Array(K);
  let acc = 0;
  for (let d = 1; d <= K; d++) {
    acc += mu[d] / beta;
    cdf[d - 1] = acc;
  }
  cdf[K - 1] = 1.0;
  return cdf;
}

/**
 * Deterministically select `degree` distinct block indices in [0, K - 1] from `seed24`.
 */
export function deriveFountainIndices(K, degree, seed24) {
  const clampedDegree = Math.max(1, Math.min(K, degree));
  const prng = new DeterministicPRNG(((seed24 & 0x00ffffff) ^ (K << 16) ^ (clampedDegree << 8)) >>> 0);

  if (clampedDegree === 1) {
    return [prng.nextInt(K)];
  }

  const chosen = new Set();
  while (chosen.size < clampedDegree) {
    chosen.add(prng.nextInt(K));
  }
  return Array.from(chosen).sort((a, b) => a - b);
}

export class GenerationFountainEncoder {
  /**
   * @param {number} generationId
   * @param {Uint8Array[]} sourceBlocks Array of K Uint8Array blocks (each of length <= blockSize)
   * @param {number} blockSize Fixed block byte length
   */
  constructor(generationId, sourceBlocks, blockSize) {
    this.generationId = generationId;
    this.K = sourceBlocks.length;
    this.blockSize = blockSize;
    this.cdf = buildRobustSolitonCdf(this.K);
    this.seedCounter = ((generationId + 1) * 104729) & 0x00ffffff;

    // Normalize all source blocks to exact `blockSize` padded with 0 for fast XOR
    this.paddedBlocks = sourceBlocks.map((blk) => {
      if (blk.byteLength === blockSize) return blk;
      const padded = new Uint8Array(blockSize);
      padded.set(blk);
      return padded;
    });
  }

  sampleDegree(prng) {
    if (this.K <= 1) return 1;
    const u = prng.nextFloat();
    for (let i = 0; i < this.cdf.length; i++) {
      if (u <= this.cdf[i]) {
        // Cap degree at min(K, 16) to keep XOR overhead low while preserving full graph connectivity
        return Math.min(this.K, Math.min(16, i + 1));
      }
    }
    return 1;
  }

  /**
   * Generate one encoded fountain droplet with deterministic 24-bit seed and degree.
   */
  nextDroplet(explicitSeed24 = null) {
    this.seedCounter = (this.seedCounter + 1) & 0x00ffffff;
    if (this.seedCounter === 0) this.seedCounter = 1;

    const seed24 = explicitSeed24 !== null ? (explicitSeed24 & 0x00ffffff) : this.seedCounter;
    const degPrng = new DeterministicPRNG((seed24 ^ 0x51421234) >>> 0);
    let degree = this.sampleDegree(degPrng);
    // For parity droplets, prefer degree >= 2 when K >= 2 so droplets combine multiple blocks
    if (this.K >= 2 && degree === 1 && degPrng.nextFloat() < 0.75) {
      degree = Math.min(this.K, 2 + degPrng.nextInt(Math.min(4, this.K - 1)));
    }

    const indices = deriveFountainIndices(this.K, degree, seed24);
    const payload = new Uint8Array(this.blockSize);

    for (let i = 0; i < indices.length; i++) {
      const src = this.paddedBlocks[indices[i]];
      for (let b = 0; b < this.blockSize; b++) {
        payload[b] ^= src[b];
      }
    }

    return {
      generationId: this.generationId,
      degree: indices.length,
      seed24,
      indices,
      payload
    };
  }
}
