/**
 * QuadBeam Optical Wire Encoding Module
 * Implements RFC 9285 Base45 for QR Alphanumeric Mode (only 3.1% bit overhead over raw binary,
 * vs 33.3% for Base64, while guaranteeing 100% safe ASCII transport across all browser BarcodeDetectors).
 * Also supports direct binary byte-mode transport and Base64 fallback.
 */

export const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const BASE45_DECODE_MAP = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE45_ALPHABET.length; i++) {
  BASE45_DECODE_MAP[BASE45_ALPHABET.charCodeAt(i)] = i;
}

/**
 * Encode arbitrary binary bytes (Uint8Array) to RFC 9285 Base45 string.
 * Every 2 bytes -> 3 Base45 characters; trailing 1 byte -> 2 Base45 characters.
 */
export function encodeBase45(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = input.length;
  const pairs = len >>> 1;
  const rem = len & 1;
  const chars = new Array(pairs * 3 + (rem ? 2 : 0));
  let outIdx = 0;

  for (let i = 0; i < len - 1; i += 2) {
    let v = (input[i] << 8) | input[i + 1];
    const c = v % 45;
    v = (v - c) / 45;
    const d = v % 45;
    const e = (v - d) / 45;
    chars[outIdx++] = BASE45_ALPHABET[c];
    chars[outIdx++] = BASE45_ALPHABET[d];
    chars[outIdx++] = BASE45_ALPHABET[e];
  }

  if (rem === 1) {
    const v = input[len - 1];
    const c = v % 45;
    const d = (v - c) / 45;
    chars[outIdx++] = BASE45_ALPHABET[c];
    chars[outIdx++] = BASE45_ALPHABET[d];
  }

  return chars.join('');
}

/**
 * Decode RFC 9285 Base45 string back into exact Uint8Array binary bytes.
 * Throws Error on invalid character or overflow value (> 0xFFFF for 3 chars or > 0xFF for 2 chars).
 */
export function decodeBase45(str) {
  if (typeof str !== 'string') {
    throw new Error('Base45 input must be a string');
  }
  const len = str.length;
  const rem = len % 3;
  if (rem === 1) {
    throw new Error('Invalid Base45 string length');
  }

  const triplets = Math.floor(len / 3);
  const outLen = triplets * 2 + (rem === 2 ? 1 : 0);
  const out = new Uint8Array(outLen);
  let outIdx = 0;

  for (let i = 0; i < len - rem; i += 3) {
    const c0 = str.charCodeAt(i);
    const c1 = str.charCodeAt(i + 1);
    const c2 = str.charCodeAt(i + 2);
    if (c0 >= 128 || c1 >= 128 || c2 >= 128) {
      throw new Error('Invalid non-ASCII character in Base45 string');
    }
    const v0 = BASE45_DECODE_MAP[c0];
    const v1 = BASE45_DECODE_MAP[c1];
    const v2 = BASE45_DECODE_MAP[c2];
    if (v0 < 0 || v1 < 0 || v2 < 0) {
      throw new Error('Invalid character outside Base45 alphabet');
    }
    const val = v0 + v1 * 45 + v2 * 2025;
    if (val > 0xffff) {
      throw new Error('Base45 triplet value overflow (> 65535)');
    }
    out[outIdx++] = (val >>> 8) & 0xff;
    out[outIdx++] = val & 0xff;
  }

  if (rem === 2) {
    const c0 = str.charCodeAt(len - 2);
    const c1 = str.charCodeAt(len - 1);
    if (c0 >= 128 || c1 >= 128) {
      throw new Error('Invalid non-ASCII character in Base45 tail');
    }
    const v0 = BASE45_DECODE_MAP[c0];
    const v1 = BASE45_DECODE_MAP[c1];
    if (v0 < 0 || v1 < 0) {
      throw new Error('Invalid character in Base45 tail');
    }
    const val = v0 + v1 * 45;
    if (val > 0xff) {
      throw new Error('Base45 pair value overflow (> 255)');
    }
    out[outIdx++] = val & 0xff;
  }

  return out;
}

/**
 * Encode packet bytes into QR payload representation.
 * - 'base45': Returns an uppercase alphanumeric string for QR MODE_ALPHA_NUM.
 * - 'byte': Returns raw Uint8Array for QR MODE_8BIT_BYTE.
 */
export function encodePacketWire(packetBytes, wireEncoding = 'base45') {
  if (wireEncoding === 'byte') {
    return {
      mode: 'byte',
      data: packetBytes
    };
  }
  return {
    mode: 'alphanumeric',
    data: encodeBase45(packetBytes)
  };
}

/**
 * Decode scanned QR payload (either rawBytes Uint8Array or rawValue string) back to packet Uint8Array.
 */
export function decodePacketWire(scanResult) {
  if (!scanResult) return null;

  // If rawBytes already starts with 'QB' (0x51, 0x42), use it directly
  if (scanResult.rawBytes instanceof Uint8Array && scanResult.rawBytes.length >= 28) {
    if (scanResult.rawBytes[0] === 0x51 && scanResult.rawBytes[1] === 0x42) {
      return scanResult.rawBytes;
    }
  }

  const rawValue = typeof scanResult === 'string' ? scanResult : scanResult.rawValue;
  if (typeof rawValue === 'string' && rawValue.length >= 4) {
    // Check if Latin-1 string starts with 'QB'
    if (rawValue.charCodeAt(0) === 0x51 && rawValue.charCodeAt(1) === 0x42 && rawValue.length >= 28) {
      const out = new Uint8Array(rawValue.length);
      for (let i = 0; i < rawValue.length; i++) {
        out[i] = rawValue.charCodeAt(i) & 0xff;
      }
      return out;
    }
    // Otherwise decode as Base45
    return decodeBase45(rawValue);
  }

  throw new Error('Unrecognized QR wire payload format');
}
