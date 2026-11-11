/**
 * QuadBeam Cryptographic & Deterministic ID Utilities
 */

export function generateUint32Id() {
  const arr = new Uint32Array(1);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(arr);
  } else {
    arr[0] = Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  return (arr[0] === 0 ? 0x51420001 : arr[0]) >>> 0;
}

export function generateSessionId() {
  return generateUint32Id();
}

export function generateFileId() {
  return generateUint32Id();
}

export function formatHexId(uint32) {
  return (uint32 >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Deterministic 32-bit PRNG (Mulberry32 / Xorshift32 hybrid)
 * Used by the LT Fountain Encoder and Decoder so both sides derive the exact
 * same degree and source block indices from a compact 32-bit packet seed.
 */
export class DeterministicPRNG {
  constructor(seed) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  nextUint32() {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0);
  }

  nextFloat() {
    return this.nextUint32() / 4294967296;
  }

  nextInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    return this.nextUint32() % maxExclusive;
  }
}
