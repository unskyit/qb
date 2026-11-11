/**
 * QuadBeam Cryptographic Integrity & Checksum Module
 * Provides:
 * 1. IEEE 802.3 CRC32 for fast per-packet frame verification
 * 2. Streaming incremental SHA-256 (FIPS 180-4) for bounded-memory 50 MiB file verification
 * 3. Optional AES-256-GCM authenticated encryption via Web Crypto API
 */

// Precompute IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32(bytes, start = 0, end = bytes.length) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// FIPS 180-4 SHA-256 round constants
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * Streaming Incremental SHA-256 Hasher
 * Computes exact SHA-256 digests over arbitrarily large files (e.g., 50 MiB)
 * in bounded 64-byte blocks without holding the entire file in RAM.
 */
export class IncrementalSha256 {
  constructor() {
    this.W = new Uint32Array(64);
    this.reset();
  }

  reset() {
    this.H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesProcessed = 0;
    this.finalized = false;
    return this;
  }

  _compressBlock(block, offset) {
    const W = this.W;
    const H = this.H;

    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      W[i] = (
        (block[j] << 24) |
        (block[j + 1] << 16) |
        (block[j + 2] << 8) |
        block[j + 3]
      ) >>> 0;
    }

    for (let i = 16; i < 64; i++) {
      const v0 = W[i - 15];
      const s0 = (((v0 >>> 7) | (v0 << 25)) ^ ((v0 >>> 18) | (v0 << 14)) ^ (v0 >>> 3)) >>> 0;
      const v1 = W[i - 2];
      const s1 = (((v1 >>> 17) | (v1 << 15)) ^ ((v1 >>> 19) | (v1 << 13)) ^ (v1 >>> 10)) >>> 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K256[i] + W[i]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  update(chunk) {
    if (this.finalized) {
      throw new Error('IncrementalSha256 already finalized');
    }
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    let offset = 0;
    let remaining = data.length;
    this.bytesProcessed += remaining;

    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      if (remaining < needed) {
        this.buffer.set(data, this.bufferLength);
        this.bufferLength += remaining;
        return this;
      }
      this.buffer.set(data.subarray(0, needed), this.bufferLength);
      this._compressBlock(this.buffer, 0);
      this.bufferLength = 0;
      offset += needed;
      remaining -= needed;
    }

    while (remaining >= 64) {
      this._compressBlock(data, offset);
      offset += 64;
      remaining -= 64;
    }

    if (remaining > 0) {
      this.buffer.set(data.subarray(offset, offset + remaining), 0);
      this.bufferLength = remaining;
    }

    return this;
  }

  digest() {
    if (!this.finalized) {
      const totalBits = this.bytesProcessed * 8;
      const highBits = Math.floor(totalBits / 4294967296) >>> 0;
      const lowBits = (totalBits >>> 0);

      this.buffer[this.bufferLength++] = 0x80;
      if (this.bufferLength > 56) {
        this.buffer.fill(0, this.bufferLength, 64);
        this._compressBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
      this.buffer.fill(0, this.bufferLength, 56);
      const dv = new DataView(this.buffer.buffer);
      dv.setUint32(56, highBits, false);
      dv.setUint32(60, lowBits, false);
      this._compressBlock(this.buffer, 0);
      this.finalized = true;
    }

    const out = new Uint8Array(32);
    const dvOut = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) {
      dvOut.setUint32(i * 4, this.H[i], false);
    }
    return out;
  }

  digestHex() {
    return bytesToHex(this.digest());
  }
}

export function sha256Sync(bytes) {
  const hasher = new IncrementalSha256();
  hasher.update(bytes);
  return hasher.digest();
}

export async function sha256Async(bytes) {
  if (globalThis.crypto?.subtle && bytes.byteLength <= 16 * 1024 * 1024) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(buf);
  }
  return sha256Sync(bytes);
}

export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >>> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function digestsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Optional Password-Based Authenticated Encryption (AES-256-GCM + PBKDF2-SHA256)
 * Operates per-block or per-generation with deterministic nonce derivation so 50 MiB files
 * never need to be loaded into memory all at once.
 */
export async function deriveAesGcmKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function buildChunkIv(ivBase12, index) {
  const iv = new Uint8Array(12);
  iv.set(ivBase12.subarray(0, 12));
  const dv = new DataView(iv.buffer);
  const low = dv.getUint32(8, false);
  dv.setUint32(8, (low ^ (index >>> 0)) >>> 0, false);
  return iv;
}

export async function encryptChunkAesGcm(key, ivBase12, chunkIndex, plainBytes) {
  const iv = buildChunkIv(ivBase12, chunkIndex);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes
  );
  return new Uint8Array(ct);
}

export async function decryptChunkAesGcm(key, ivBase12, chunkIndex, cipherBytes) {
  const iv = buildChunkIv(ivBase12, chunkIndex);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );
  return new Uint8Array(pt);
}
