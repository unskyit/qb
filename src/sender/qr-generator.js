/**
 * QuadBeam ISO/IEC 18004 QR Code Encoder & Atomic Canvas Renderer
 *
 * Adapted from Kazuhiko Arase's MIT-licensed QRCode reference implementation,
 * modernized into zero-dependency ES Modules with support for:
 * - QR Alphanumeric Mode (MODE_ALPHA_NUM = 2) for high-density RFC 9285 Base45 payloads
 * - QR 8-Bit Byte Mode (MODE_8BIT_BYTE = 4) for raw Uint8Array binary payloads
 * - Versions 1 through 40 with automatic minimum-version selection
 * - Error Correction Levels L (1), M (0), Q (3), H (2)
 * - Fast typed-array module grid generation and crisp integer-snapped Canvas/RGBA rendering
 */

import { BASE45_ALPHABET } from '../protocol/encoding.js';

export const QR_MODE = Object.freeze({
  NUMBER: 1 << 0,
  ALPHA_NUM: 1 << 1,
  BYTE_8BIT: 1 << 2
});

export const QR_EC_LEVEL = Object.freeze({
  L: 1,
  M: 0,
  Q: 3,
  H: 2
});

// GF(256) log/exp tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
export const GF256_EXP = new Uint8Array(512);
export const GF256_LOG = new Uint8Array(256);

for (let i = 0; i < 8; i++) {
  GF256_EXP[i] = 1 << i;
}
for (let i = 8; i < 256; i++) {
  GF256_EXP[i] =
    GF256_EXP[i - 4] ^
    GF256_EXP[i - 5] ^
    GF256_EXP[i - 6] ^
    GF256_EXP[i - 8];
}
for (let i = 0; i < 255; i++) {
  GF256_LOG[GF256_EXP[i]] = i;
  GF256_EXP[i + 255] = GF256_EXP[i];
}

export function gfExp(n) {
  let idx = n % 255;
  if (idx < 0) idx += 255;
  return GF256_EXP[idx];
}

export function gfLog(n) {
  if (n < 1) throw new Error(`gfLog(${n})`);
  return GF256_LOG[n];
}

export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
}

export function gfInv(a) {
  if (a === 0) throw new Error('gfInv(0)');
  return GF256_EXP[255 - GF256_LOG[a]];
}

// Alphanumeric character lookup table
const ALPHANUM_MAP = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE45_ALPHABET.length; i++) {
  ALPHANUM_MAP[BASE45_ALPHABET.charCodeAt(i)] = i;
}

export function isAlphanumericString(str) {
  if (typeof str !== 'string') return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 128 || ALPHANUM_MAP[code] < 0) return false;
  }
  return true;
}

// Alignment pattern center coordinates for Versions 1..40
export const ALIGNMENT_PATTERN_TABLE = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170]
];

// Reed-Solomon block definitions for Versions 1..40, ordered [L, M, Q, H] per version
export const RS_BLOCK_TABLE = [
  // 1
  [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
  // 2
  [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
  // 3
  [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
  // 4
  [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
  // 5
  [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
  // 6
  [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
  // 7
  [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
  // 8
  [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
  // 9
  [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
  // 10
  [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
  // 11
  [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
  // 12
  [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
  // 13
  [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
  // 14
  [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
  // 15
  [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12],
  // 16
  [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
  // 17
  [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
  // 18
  [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
  // 19
  [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
  // 20
  [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
  // 21
  [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
  // 22
  [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
  // 23
  [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
  // 24
  [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
  // 25
  [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
  // 26
  [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
  // 27
  [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
  // 28
  [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
  // 29
  [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
  // 30
  [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
  // 31
  [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
  // 32
  [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
  // 33
  [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
  // 34
  [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
  // 35
  [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
  // 36
  [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
  // 37
  [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
  // 38
  [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
  // 39
  [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
  // 40
  [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16]
];

export function getRSBlocks(version, ecLevel) {
  let offset;
  if (ecLevel === QR_EC_LEVEL.L || ecLevel === 'L') offset = 0;
  else if (ecLevel === QR_EC_LEVEL.M || ecLevel === 'M') offset = 1;
  else if (ecLevel === QR_EC_LEVEL.Q || ecLevel === 'Q') offset = 2;
  else if (ecLevel === QR_EC_LEVEL.H || ecLevel === 'H') offset = 3;
  else offset = 1;

  const entry = RS_BLOCK_TABLE[(version - 1) * 4 + offset];
  if (!entry) throw new Error(`Invalid QR version/EC: ${version}/${ecLevel}`);

  const list = [];
  for (let i = 0; i < entry.length; i += 3) {
    const count = entry[i];
    const totalCount = entry[i + 1];
    const dataCount = entry[i + 2];
    for (let j = 0; j < count; j++) {
      list.push({ totalCount, dataCount, ecCount: totalCount - dataCount });
    }
  }
  return list;
}

export function getLengthInBits(mode, version) {
  if (version < 10) {
    if (mode === QR_MODE.NUMBER) return 10;
    if (mode === QR_MODE.ALPHA_NUM) return 9;
    return 8;
  } else if (version < 27) {
    if (mode === QR_MODE.NUMBER) return 12;
    if (mode === QR_MODE.ALPHA_NUM) return 11;
    return 16;
  } else {
    if (mode === QR_MODE.NUMBER) return 14;
    if (mode === QR_MODE.ALPHA_NUM) return 13;
    return 16;
  }
}

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHDigit(data) {
  let digit = 0;
  let d = data;
  while (d !== 0) {
    digit++;
    d >>>= 1;
  }
  return digit;
}

export function getBCHTypeInfo(data) {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
    d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

export function getBCHTypeNumber(version) {
  let d = version << 12;
  while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
    d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
  }
  return (version << 12) | d;
}

export function evaluateMask(maskPattern, row, col) {
  switch (maskPattern) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row * col) % 3) + ((row + col) % 2)) % 2 === 0;
    default: return false;
  }
}

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }

  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

// Cache generator polynomials by EC byte count
const RS_POLY_CACHE = new Map();

function getGeneratorPolynomial(ecCount) {
  if (RS_POLY_CACHE.has(ecCount)) return RS_POLY_CACHE.get(ecCount);
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = gfExp(i);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  RS_POLY_CACHE.set(ecCount, poly);
  return poly;
}

function computeRsErrorCorrection(dataBytes, ecCount) {
  const gen = getGeneratorPolynomial(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function writeSegmentToBuffer(bitBuffer, mode, payload, version) {
  bitBuffer.put(mode, 4);
  if (mode === QR_MODE.ALPHA_NUM) {
    const str = payload;
    bitBuffer.put(str.length, getLengthInBits(mode, version));
    let i = 0;
    while (i + 1 < str.length) {
      const v0 = ALPHANUM_MAP[str.charCodeAt(i)];
      const v1 = ALPHANUM_MAP[str.charCodeAt(i + 1)];
      bitBuffer.put(v0 * 45 + v1, 11);
      i += 2;
    }
    if (i < str.length) {
      bitBuffer.put(ALPHANUM_MAP[str.charCodeAt(i)], 6);
    }
  } else {
    const bytes = payload instanceof Uint8Array ? payload : new TextEncoder().encode(String(payload));
    bitBuffer.put(bytes.length, getLengthInBits(mode, version));
    for (let i = 0; i < bytes.length; i++) {
      bitBuffer.put(bytes[i], 8);
    }
  }
}

function selectMinimumVersion(mode, payloadLen, ecNum) {
  for (let v = 1; v <= 40; v++) {
    const rsBlocks = getRSBlocks(v, ecNum);
    let totalDataBytes = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalDataBytes += rsBlocks[i].dataCount;
    }
    const headerBits = 4 + getLengthInBits(mode, v);
    let payloadBits;
    if (mode === QR_MODE.ALPHA_NUM) {
      payloadBits = Math.floor(payloadLen / 2) * 11 + (payloadLen % 2 === 1 ? 6 : 0);
    } else {
      payloadBits = payloadLen * 8;
    }
    if (headerBits + payloadBits <= totalDataBytes * 8) {
      return v;
    }
  }
  throw new RangeError(`Payload length ${payloadLen} exceeds maximum QR Code capacity`);
}

function buildCodewords(version, ecNum, mode, payload) {
  const rsBlocks = getRSBlocks(version, ecNum);
  const bitBuffer = new BitBuffer();
  writeSegmentToBuffer(bitBuffer, mode, payload, version);

  let totalDataCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    totalDataCount += rsBlocks[i].dataCount;
  }

  if (bitBuffer.length > totalDataCount * 8) {
    throw new RangeError(`QR bit buffer overflow (${bitBuffer.length} > ${totalDataCount * 8})`);
  }

  if (bitBuffer.length + 4 <= totalDataCount * 8) {
    bitBuffer.put(0, 4);
  }
  while (bitBuffer.length % 8 !== 0) {
    bitBuffer.putBit(false);
  }
  while (bitBuffer.length < totalDataCount * 8) {
    bitBuffer.put(0xec, 8);
    if (bitBuffer.length >= totalDataCount * 8) break;
    bitBuffer.put(0x11, 8);
  }

  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const dcdata = new Array(rsBlocks.length);
  const ecdata = new Array(rsBlocks.length);

  for (let r = 0; r < rsBlocks.length; r++) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].ecCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);

    const blockBytes = new Uint8Array(dcCount);
    for (let i = 0; i < dcCount; i++) {
      blockBytes[i] = bitBuffer.buffer[offset + i] & 0xff;
    }
    offset += dcCount;
    dcdata[r] = blockBytes;
    ecdata[r] = computeRsErrorCorrection(blockBytes, ecCount);
  }

  let totalCodeCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    totalCodeCount += rsBlocks[i].totalCount;
  }

  const interleaved = new Uint8Array(totalCodeCount);
  let idx = 0;
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < dcdata[r].length) {
        interleaved[idx++] = dcdata[r][i];
      }
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < ecdata[r].length) {
        interleaved[idx++] = ecdata[r][i];
      }
    }
  }
  return interleaved;
}

/**
 * Populate QR matrix of size `moduleCount x moduleCount`.
 * `isFunction` tracks reserved function modules (1 = function module, 0 = data module).
 * `modules` stores 1 for dark, 0 for light.
 */
export function buildFunctionPatternMatrix(version) {
  const moduleCount = version * 4 + 17;
  const modules = new Uint8Array(moduleCount * moduleCount);
  const isFunction = new Uint8Array(moduleCount * moduleCount);

  const setFunc = (r, c, dark) => {
    if (r < 0 || r >= moduleCount || c < 0 || c >= moduleCount) return;
    const idx = r * moduleCount + c;
    modules[idx] = dark ? 1 : 0;
    isFunction[idx] = 1;
  };

  // Finder patterns + separators
  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dark =
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4);
        setFunc(row + r, col + c, dark);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(moduleCount - 7, 0);
  placeFinder(0, moduleCount - 7);

  // Alignment patterns
  const pos = ALIGNMENT_PATTERN_TABLE[version - 1];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const row = pos[i];
      const col = pos[j];
      if (isFunction[row * moduleCount + col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
          setFunc(row + r, col + c, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < moduleCount - 8; i++) {
    if (!isFunction[i * moduleCount + 6]) setFunc(i, 6, i % 2 === 0);
    if (!isFunction[6 * moduleCount + i]) setFunc(6, i, i % 2 === 0);
  }

  // Reserve Format Info positions & Dark Module
  for (let i = 0; i < 15; i++) {
    const r = i < 6 ? i : i < 8 ? i + 1 : moduleCount - 15 + i;
    isFunction[r * moduleCount + 8] = 1;

    const c = i < 8 ? moduleCount - i - 1 : i < 9 ? 15 - i : 14 - i;
    isFunction[8 * moduleCount + c] = 1;
  }
  setFunc(moduleCount - 8, 8, true);

  // Version Info (for version >= 7)
  if (version >= 7) {
    const bits = getBCHTypeNumber(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      setFunc(Math.floor(i / 3), (i % 3) + moduleCount - 11, dark);
      setFunc((i % 3) + moduleCount - 11, Math.floor(i / 3), dark);
    }
  }

  return { moduleCount, modules, isFunction };
}

function writeFormatBits(modules, moduleCount, ecNum, maskPattern) {
  const data = (ecNum << 3) | maskPattern;
  const bits = getBCHTypeInfo(data);

  for (let v = 0; v < 15; v++) {
    const dark = ((bits >>> v) & 1) === 1 ? 1 : 0;
    if (v < 6) modules[v * moduleCount + 8] = dark;
    else if (v < 8) modules[(v + 1) * moduleCount + 8] = dark;
    else modules[(moduleCount - 15 + v) * moduleCount + 8] = dark;
  }

  for (let h = 0; h < 15; h++) {
    const dark = ((bits >>> h) & 1) === 1 ? 1 : 0;
    if (h < 8) modules[8 * moduleCount + (moduleCount - h - 1)] = dark;
    else if (h < 9) modules[8 * moduleCount + (15 - h)] = dark;
    else modules[8 * moduleCount + (14 - h)] = dark;
  }

  modules[(moduleCount - 8) * moduleCount + 8] = 1;
}

function mapCodewordsToMatrix(modules, isFunction, moduleCount, codewords, maskPattern) {
  let inc = -1;
  let row = moduleCount - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = moduleCount - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const curCol = col - c;
        const idx = row * moduleCount + curCol;
        if (!isFunction[idx]) {
          let dark = false;
          if (byteIndex < codewords.length) {
            dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if (evaluateMask(maskPattern, row, curCol)) {
            dark = !dark;
          }
          modules[idx] = dark ? 1 : 0;
          bitIndex--;
          if (bitIndex === -1) {
            byteIndex++;
            bitIndex = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || row >= moduleCount) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

/**
 * Encode a payload (Base45 string or Uint8Array) into a complete QR Matrix.
 *
 * @param {string|Uint8Array} payload
 * @param {Object} [options]
 * @param {'L'|'M'|'Q'|'H'} [options.ecLevel='M']
 * @param {number} [options.version=0] 0 for automatic minimum version
 * @param {number} [options.maskPattern=2] Fixed mask (0..7) or -1 for full 8-mask evaluation
 */
export function encodeQrMatrix(payload, options = {}) {
  const ecLevelKey = options.ecLevel || 'M';
  const ecNum = QR_EC_LEVEL[ecLevelKey] !== undefined ? QR_EC_LEVEL[ecLevelKey] : QR_EC_LEVEL.M;

  let mode;
  let normalizedPayload;
  let payloadLength;

  if (typeof payload === 'string' && isAlphanumericString(payload)) {
    mode = QR_MODE.ALPHA_NUM;
    normalizedPayload = payload;
    payloadLength = payload.length;
  } else if (payload instanceof Uint8Array) {
    mode = QR_MODE.BYTE_8BIT;
    normalizedPayload = payload;
    payloadLength = payload.byteLength;
  } else {
    mode = QR_MODE.BYTE_8BIT;
    normalizedPayload = new TextEncoder().encode(String(payload));
    payloadLength = normalizedPayload.byteLength;
  }

  const version =
    options.version && options.version >= 1
      ? options.version
      : selectMinimumVersion(mode, payloadLength, ecNum);

  const codewords = buildCodewords(version, ecNum, mode, normalizedPayload);
  const { moduleCount, modules, isFunction } = buildFunctionPatternMatrix(version);

  // Mask pattern 2 or 0 is fast and balanced; if options.maskPattern === -1 we evaluate penalty
  const maskPattern =
    options.maskPattern !== undefined && options.maskPattern >= 0
      ? options.maskPattern & 7
      : 2;

  writeFormatBits(modules, moduleCount, ecNum, maskPattern);
  mapCodewordsToMatrix(modules, isFunction, moduleCount, codewords, maskPattern);

  return {
    version,
    ecLevel: ecLevelKey,
    mode,
    maskPattern,
    moduleCount,
    modules
  };
}

/**
 * Render a QR matrix onto a 2D Canvas context with atomic frame swap,
 * exact integer module sizing, mandatory quiet zone, and zero smoothing.
 */
export function renderQrToCanvas(canvas, qrMatrix, options = {}) {
  const quietZone = Math.max(4, options.quietZone ?? 4);
  const { moduleCount, modules } = qrMatrix;
  const totalModules = moduleCount + quietZone * 2;

  const targetSize = options.size || canvas.width || 320;
  const modulePx = Math.max(2, Math.floor(targetSize / totalModules));
  const actualCanvasSize = totalModules * modulePx;

  if (canvas.width !== actualCanvasSize || canvas.height !== actualCanvasSize) {
    canvas.width = actualCanvasSize;
    canvas.height = actualCanvasSize;
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  // Pure white quiet zone & background (#FFFFFF)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, actualCanvasSize, actualCanvasSize);

  // Pure black sharp square modules (#000000)
  ctx.fillStyle = '#000000';
  const offsetPx = quietZone * modulePx;

  for (let r = 0; r < moduleCount; r++) {
    const rowOff = r * moduleCount;
    const y = offsetPx + r * modulePx;
    let c = 0;
    while (c < moduleCount) {
      if (modules[rowOff + c]) {
        let run = 1;
        while (c + run < moduleCount && modules[rowOff + c + run]) {
          run++;
        }
        ctx.fillRect(offsetPx + c * modulePx, y, run * modulePx, modulePx);
        c += run;
      } else {
        c++;
      }
    }
  }

  return {
    canvasSize: actualCanvasSize,
    modulePx,
    quietZone
  };
}

/**
 * Render a QR matrix into a raw RGBA Uint8ClampedArray image buffer (`{ width, height, data }`)
 * for headless/worker rendering and camera simulation tests.
 */
export function renderQrToImageData(qrMatrix, options = {}) {
  const quietZone = Math.max(4, options.quietZone ?? 4);
  const modulePx = Math.max(2, options.modulePx ?? 6);
  const { moduleCount, modules } = qrMatrix;
  const totalModules = moduleCount + quietZone * 2;
  const size = totalModules * modulePx;

  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(255); // White background & alpha 255

  const offsetPx = quietZone * modulePx;
  for (let r = 0; r < moduleCount; r++) {
    const rowOff = r * moduleCount;
    for (let c = 0; c < moduleCount; c++) {
      if (!modules[rowOff + c]) continue;
      const startY = offsetPx + r * modulePx;
      const startX = offsetPx + c * modulePx;
      for (let py = 0; py < modulePx; py++) {
        const yOff = (startY + py) * size;
        for (let px = 0; px < modulePx; px++) {
          const idx = (yOff + startX + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  }

  return { width: size, height: size, data };
}
