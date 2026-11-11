/**
 * QuadBeam High-Performance Multi-QR Computer Vision & ISO/IEC 18004 Decoder
 *
 * Provides dual-engine decoding:
 * 1. Native Browser BarcodeDetector API (when supported by hardware/OS)
 * 2. Built-in Pure-JS ISO/IEC 18004 Computer Vision + GF(256) Reed-Solomon Decoder
 *    - Integral-image local adaptive thresholding (robust to glare, shadows, brightness shifts)
 *    - 1:1:3:1:1 Finder Pattern scanner with vertical/horizontal/diagonal verification
 *    - Perspective homography & alignment-pattern sampling + 0/90/180/270 rotation handling
 *    - BCH (15,5) format error correction and BCH (18,6) version error correction
 *    - Full Berlekamp-Massey + Chien + Forney GF(256) Reed-Solomon block error correction
 *    - Multi-QR 1-panel, 2-panel, and 4-panel (2x2 quadrant) spatial localization
 */

import {
  QR_MODE,
  QR_EC_LEVEL,
  GF256_EXP,
  GF256_LOG,
  gfMul,
  gfInv,
  getRSBlocks,
  getLengthInBits,
  getBCHTypeInfo,
  getBCHTypeNumber,
  evaluateMask,
  buildFunctionPatternMatrix,
  ALIGNMENT_PATTERN_TABLE
} from '../sender/qr-generator.js';
import { BASE45_ALPHABET } from '../protocol/encoding.js';

// Precompute all 32 valid 15-bit Format Info codewords for instant Hamming-distance decoding
const FORMAT_INFO_TABLE = new Array(32);
for (let data = 0; data < 32; data++) {
  FORMAT_INFO_TABLE[data] = {
    bits: getBCHTypeInfo(data),
    ecNum: (data >>> 3) & 0x03,
    maskPattern: data & 0x07
  };
}

// Precompute all 34 valid 18-bit Version Info codewords (Versions 7..40)
const VERSION_INFO_TABLE = new Array(41);
for (let v = 7; v <= 40; v++) {
  VERSION_INFO_TABLE[v] = getBCHTypeNumber(v);
}

function popcount32(x) {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function decodeFormatBits(rawFormat1, rawFormat2 = -1) {
  let bestDist = 4; // Allow up to 3 bit errors
  let bestEntry = null;

  for (let i = 0; i < 32; i++) {
    const entry = FORMAT_INFO_TABLE[i];
    const d1 = popcount32(rawFormat1 ^ entry.bits);
    if (d1 < bestDist) {
      bestDist = d1;
      bestEntry = entry;
    }
    if (rawFormat2 >= 0) {
      const d2 = popcount32(rawFormat2 ^ entry.bits);
      if (d2 < bestDist) {
        bestDist = d2;
        bestEntry = entry;
      }
    }
  }
  return bestEntry;
}

export function decodeVersionBits(rawVer1, rawVer2 = -1) {
  let bestDist = 4;
  let bestVer = null;
  for (let v = 7; v <= 40; v++) {
    const target = VERSION_INFO_TABLE[v];
    const d1 = popcount32(rawVer1 ^ target);
    if (d1 < bestDist) {
      bestDist = d1;
      bestVer = v;
    }
    if (rawVer2 >= 0) {
      const d2 = popcount32(rawVer2 ^ target);
      if (d2 < bestDist) {
        bestDist = d2;
        bestVer = v;
      }
    }
  }
  return bestVer;
}

/**
 * Full GF(256) Reed-Solomon Decoder (Berlekamp-Massey + Chien Search + Forney Algorithm)
 * Corrects up to floor(ecCount / 2) corrupted bytes in place.
 * Returns true if codeword is valid or successfully repaired, false if uncorrectable.
 */
export function reedSolomonDecodeBlock(codeword, ecCount) {
  const N = codeword.length;
  if (ecCount <= 0) return true;

  // 1. Compute syndromes S[0 .. ecCount-1] where S[i] = C(alpha^i)
  const syndromes = new Uint8Array(ecCount);
  let hasError = false;
  for (let i = 0; i < ecCount; i++) {
    let evalSum = 0;
    const root = GF256_EXP[i];
    for (let j = 0; j < N; j++) {
      evalSum = gfMul(evalSum, root) ^ codeword[j];
    }
    syndromes[i] = evalSum;
    if (evalSum !== 0) hasError = true;
  }

  if (!hasError) return true;

  // 2. Berlekamp-Massey to find Error Locator Polynomial sigma(x)
  let sigma = new Uint8Array([1]);
  let B = new Uint8Array([1]);
  let L = 0;
  let m = 1;
  let b = 1;

  for (let n = 0; n < ecCount; n++) {
    let d = syndromes[n];
    for (let i = 1; i <= L; i++) {
      if (i < sigma.length) {
        d ^= gfMul(sigma[i], syndromes[n - i]);
      }
    }

    if (d === 0) {
      m += 1;
    } else {
      const T = new Uint8Array(Math.max(sigma.length, B.length + m));
      T.set(sigma);
      const scale = gfMul(d, gfInv(b));
      for (let i = 0; i < B.length; i++) {
        T[i + m] ^= gfMul(scale, B[i]);
      }
      if (2 * L <= n) {
        L = n + 1 - L;
        B = sigma;
        b = d;
        m = 1;
      } else {
        m += 1;
      }
      sigma = T;
    }
  }

  const numErrors = sigma.length - 1;
  if (numErrors > Math.floor(ecCount / 2)) {
    return false;
  }

  // 3. Chien search to find error locations X_k = alpha^(N - 1 - pos)
  const errorLocations = [];
  const errorPowers = [];
  for (let i = 0; i < N; i++) {
    const power = N - 1 - i;
    const xInv = GF256_EXP[(255 - (power % 255)) % 255];
    let val = 0;
    let xTerm = 1;
    for (let j = 0; j < sigma.length; j++) {
      val ^= gfMul(sigma[j], xTerm);
      xTerm = gfMul(xTerm, xInv);
    }
    if (val === 0) {
      errorLocations.push(i);
      errorPowers.push(power);
    }
  }

  if (errorLocations.length !== numErrors) {
    return false;
  }

  // 4. Compute Error Evaluator Polynomial omega(x) = S(x) * sigma(x) mod x^ecCount
  const omega = new Uint8Array(ecCount);
  for (let i = 0; i < ecCount; i++) {
    let sum = 0;
    for (let j = 0; j <= i && j < sigma.length; j++) {
      sum ^= gfMul(syndromes[i - j], sigma[j]);
    }
    omega[i] = sum;
  }

  // 5. Forney's algorithm to compute error magnitudes and correct codeword
  for (let k = 0; k < errorLocations.length; k++) {
    const pos = errorLocations[k];
    const power = errorPowers[k];
    const xInv = GF256_EXP[(255 - (power % 255)) % 255];

    // Evaluate omega(X_k^-1)
    let num = 0;
    let xTerm = 1;
    for (let i = 0; i < ecCount; i++) {
      num ^= gfMul(omega[i], xTerm);
      xTerm = gfMul(xTerm, xInv);
    }

    // Formal derivative sigma'(X_k^-1) in GF(2^8): odd terms only
    let den = 0;
    let xInvSq = gfMul(xInv, xInv);
    let xDerivTerm = 1;
    for (let i = 1; i < sigma.length; i += 2) {
      den ^= gfMul(sigma[i], xDerivTerm);
      xDerivTerm = gfMul(xDerivTerm, xInvSq);
    }

    if (den === 0) return false;
    const errMag = gfMul(num, gfInv(den));
    codeword[pos] ^= errMag;
  }

  return true;
}

/**
 * Decode a sampled binary QR module matrix (`Uint8Array(moduleCount * moduleCount)`)
 * into `{ rawValue, rawBytes, version, ecLevel, maskPattern }`.
 */
export function decodeQrMatrix(modules, moduleCount) {
  const version = Math.round((moduleCount - 17) / 4);
  if (version < 1 || version > 40 || version * 4 + 17 !== moduleCount) {
    return null;
  }

  // Read Format Information #1 (vertical & horizontal around top-left finder)
  let rawFormat1 = 0;
  for (let v = 0; v < 15; v++) {
    let bit;
    if (v < 6) bit = modules[v * moduleCount + 8];
    else if (v < 8) bit = modules[(v + 1) * moduleCount + 8];
    else bit = modules[(moduleCount - 15 + v) * moduleCount + 8];
    if (bit) rawFormat1 |= 1 << v;
  }

  // Read Format Information #2 (horizontal & vertical around top-right / bottom-left)
  let rawFormat2 = 0;
  for (let h = 0; h < 15; h++) {
    let bit;
    if (h < 8) bit = modules[8 * moduleCount + (moduleCount - h - 1)];
    else if (h < 9) bit = modules[8 * moduleCount + (15 - h)];
    else bit = modules[8 * moduleCount + (14 - h)];
    if (bit) rawFormat2 |= 1 << h;
  }

  const formatInfo = decodeFormatBits(rawFormat1, rawFormat2);
  if (!formatInfo) return null;

  const { ecNum, maskPattern } = formatInfo;
  const { isFunction } = buildFunctionPatternMatrix(version);

  // Extract interleaved codewords following upward/downward 2-column zig-zag
  const rsBlocks = getRSBlocks(version, ecNum);
  let totalCodewords = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    totalCodewords += rsBlocks[i].totalCount;
  }

  const codewords = new Uint8Array(totalCodewords);
  let byteIndex = 0;
  let bitIndex = 7;
  let currentByte = 0;
  let inc = -1;
  let row = moduleCount - 1;

  for (let col = moduleCount - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const curCol = col - c;
        const idx = row * moduleCount + curCol;
        if (!isFunction[idx]) {
          let dark = modules[idx] === 1;
          if (evaluateMask(maskPattern, row, curCol)) {
            dark = !dark;
          }
          if (dark) {
            currentByte |= 1 << bitIndex;
          }
          bitIndex--;
          if (bitIndex === -1) {
            if (byteIndex < totalCodewords) {
              codewords[byteIndex++] = currentByte;
            }
            currentByte = 0;
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

  // De-interleave RS blocks and apply Reed-Solomon error correction
  let maxDcCount = 0;
  let maxEcCount = 0;
  let totalDataBytes = 0;
  const blockData = new Array(rsBlocks.length);
  const blockEc = new Array(rsBlocks.length);

  for (let r = 0; r < rsBlocks.length; r++) {
    maxDcCount = Math.max(maxDcCount, rsBlocks[r].dataCount);
    maxEcCount = Math.max(maxEcCount, rsBlocks[r].ecCount);
    totalDataBytes += rsBlocks[r].dataCount;
    blockData[r] = new Uint8Array(rsBlocks[r].dataCount);
    blockEc[r] = new Uint8Array(rsBlocks[r].ecCount);
  }

  let cwIdx = 0;
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < blockData[r].length && cwIdx < codewords.length) {
        blockData[r][i] = codewords[cwIdx++];
      }
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < blockEc[r].length && cwIdx < codewords.length) {
        blockEc[r][i] = codewords[cwIdx++];
      }
    }
  }

  const dataStream = new Uint8Array(totalDataBytes);
  let dataOffset = 0;
  for (let r = 0; r < rsBlocks.length; r++) {
    const dcLen = rsBlocks[r].dataCount;
    const ecLen = rsBlocks[r].ecCount;
    const fullBlock = new Uint8Array(dcLen + ecLen);
    fullBlock.set(blockData[r], 0);
    fullBlock.set(blockEc[r], dcLen);

    if (!reedSolomonDecodeBlock(fullBlock, ecLen)) {
      return null;
    }
    dataStream.set(fullBlock.subarray(0, dcLen), dataOffset);
    dataOffset += dcLen;
  }

  // Parse QR bitstream segments (MODE_ALPHA_NUM, MODE_8BIT_BYTE, MODE_NUMBER)
  let bitPos = 0;
  const totalBits = dataStream.length * 8;
  const readBits = (count) => {
    let val = 0;
    for (let i = 0; i < count; i++) {
      if (bitPos >= totalBits) return 0;
      const byteVal = dataStream[bitPos >>> 3];
      const bitVal = (byteVal >>> (7 - (bitPos & 7))) & 1;
      val = (val << 1) | bitVal;
      bitPos++;
    }
    return val;
  };

  let rawValue = '';
  const byteChunks = [];

  while (bitPos + 4 <= totalBits) {
    const mode = readBits(4);
    if (mode === 0) break; // Terminator

    if (mode === QR_MODE.ALPHA_NUM) {
      const countBits = getLengthInBits(QR_MODE.ALPHA_NUM, version);
      let count = readBits(countBits);
      const chars = [];
      while (count >= 2) {
        const pairVal = readBits(11);
        const c0 = Math.floor(pairVal / 45);
        const c1 = pairVal % 45;
        if (c0 >= 45 || c1 >= 45) return null;
        chars.push(BASE45_ALPHABET[c0], BASE45_ALPHABET[c1]);
        count -= 2;
      }
      if (count === 1) {
        const singleVal = readBits(6);
        if (singleVal >= 45) return null;
        chars.push(BASE45_ALPHABET[singleVal]);
      }
      rawValue += chars.join('');
    } else if (mode === QR_MODE.BYTE_8BIT) {
      const countBits = getLengthInBits(QR_MODE.BYTE_8BIT, version);
      const count = readBits(countBits);
      if (bitPos + count * 8 > totalBits) return null;
      const bytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        bytes[i] = readBits(8);
      }
      byteChunks.push(bytes);
      try {
        rawValue += new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch {
        // Ignore UTF-8 decode warning for binary mode
      }
    } else if (mode === QR_MODE.NUMBER) {
      const countBits = getLengthInBits(QR_MODE.NUMBER, version);
      let count = readBits(countBits);
      while (count >= 3) {
        rawValue += String(readBits(10)).padStart(3, '0');
        count -= 3;
      }
      if (count === 2) {
        rawValue += String(readBits(7)).padStart(2, '0');
      } else if (count === 1) {
        rawValue += String(readBits(4));
      }
    } else {
      break;
    }
  }

  let rawBytes = null;
  if (byteChunks.length === 1) {
    rawBytes = byteChunks[0];
  } else if (byteChunks.length > 1) {
    const totalLen = byteChunks.reduce((acc, b) => acc + b.length, 0);
    rawBytes = new Uint8Array(totalLen);
    let off = 0;
    for (const b of byteChunks) {
      rawBytes.set(b, off);
      off += b.length;
    }
  }

  if (!rawValue && !rawBytes) return null;

  return {
    rawValue,
    rawBytes,
    version,
    ecLevel: ecNum === 1 ? 'L' : ecNum === 0 ? 'M' : ecNum === 3 ? 'Q' : 'H',
    maskPattern
  };
}

function rotateMatrix90CW(modules, n) {
  const out = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out[c * n + (n - 1 - r)] = modules[r * n + c];
    }
  }
  return out;
}

/**
 * Try decoding a sampled module matrix across all 4 cardinal orientations (0, 90, 180, 270 deg)
 * AND mirrored orientations (for front-facing mirrored webcams).
 */
export function decodeQrMatrixAnyOrientation(modules, moduleCount, allowMirror = true) {
  let cur = modules;
  for (let rot = 0; rot < 4; rot++) {
    const res = decodeQrMatrix(cur, moduleCount);
    if (res) {
      res.rotation = rot * 90;
      return res;
    }
    if (rot < 3) {
      cur = rotateMatrix90CW(cur, moduleCount);
    }
  }

  if (allowMirror) {
    const mirrored = new Uint8Array(moduleCount * moduleCount);
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        mirrored[r * moduleCount + (moduleCount - 1 - c)] = modules[r * moduleCount + c];
      }
    }
    cur = mirrored;
    for (let rot = 0; rot < 4; rot++) {
      const res = decodeQrMatrix(cur, moduleCount);
      if (res) {
        res.rotation = rot * 90;
        res.mirrored = true;
        return res;
      }
      if (rot < 3) {
        cur = rotateMatrix90CW(cur, moduleCount);
      }
    }
  }

  return null;
}

/**
 * Compute adaptive binary image (1 = dark, 0 = light) from RGBA ImageData
 * using integral-image local window mean thresholding.
 */
export function binarizeImageData(imageData, subRect = null) {
  const fullW = imageData.width;
  const fullH = imageData.height;
  const rgba = imageData.data;

  const x0 = subRect ? Math.max(0, Math.floor(subRect.x)) : 0;
  const y0 = subRect ? Math.max(0, Math.floor(subRect.y)) : 0;
  const w = subRect ? Math.min(fullW - x0, Math.floor(subRect.width)) : fullW;
  const h = subRect ? Math.min(fullH - y0, Math.floor(subRect.height)) : fullH;

  const gray = new Uint8Array(w * h);
  const integral = new Uint32Array((w + 1) * (h + 1));

  let minLum = 255;
  let maxLum = 0;

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const srcRowOff = (y0 + y) * fullW;
    const dstRowOff = y * w;
    const intRowOff = (y + 1) * (w + 1);
    const intPrevRowOff = y * (w + 1);

    for (let x = 0; x < w; x++) {
      const idx = (srcRowOff + x0 + x) * 4;
      const lum = (77 * rgba[idx] + 150 * rgba[idx + 1] + 29 * rgba[idx + 2]) >>> 8;
      gray[dstRowOff + x] = lum;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
      rowSum += lum;
      integral[intRowOff + x + 1] = integral[intPrevRowOff + x + 1] + rowSum;
    }
  }

  const binary = new Uint8Array(w * h);
  const contrast = maxLum - minLum;
  if (contrast < 16) {
    return { width: w, height: h, x0, y0, binary, gray };
  }

  const halfWin = Math.max(8, Math.floor(Math.min(w, h) / 10));
  const globalMid = (minLum + maxLum) >>> 1;

  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - halfWin);
    const y2 = Math.min(h - 1, y + halfWin);
    const r1 = y1 * (w + 1);
    const r2 = (y2 + 1) * (w + 1);
    const dstOff = y * w;

    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - halfWin);
      const x2 = Math.min(w - 1, x + halfWin);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[r2 + x2 + 1] - integral[r1 + x2 + 1] - integral[r2 + x1] + integral[r1 + x1];
      const localMean = sum / count;
      // Blend local threshold with global midpoint to avoid false noise in pure white quiet zones
      const thresh = localMean * 0.85 + globalMid * 0.15 - 3;
      binary[dstOff + x] = gray[dstOff + x] < thresh ? 1 : 0;
    }
  }

  return { width: w, height: h, x0, y0, binary, gray };
}

/**
 * Check if 5 run lengths match the 1:1:3:1:1 QR Finder Pattern ratio.
 */
function isFinderRatio(counts) {
  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (total < 7) return false;
  const moduleSize = total / 7.0;
  const maxVariance = moduleSize * 0.72;
  return (
    Math.abs(moduleSize - counts[0]) < maxVariance &&
    Math.abs(moduleSize - counts[1]) < maxVariance &&
    Math.abs(3.0 * moduleSize - counts[2]) < 3.0 * maxVariance &&
    Math.abs(moduleSize - counts[3]) < maxVariance &&
    Math.abs(moduleSize - counts[4]) < maxVariance
  );
}

function crossCheckVertical(binary, width, height, startY, centerX, maxCount, totalModuleCount) {
  const counts = [0, 0, 0, 0, 0];
  let y = startY;
  while (y >= 0 && binary[y * width + centerX]) {
    counts[2]++;
    y--;
  }
  if (y < 0) return NaN;
  while (y >= 0 && !binary[y * width + centerX] && counts[1] <= maxCount) {
    counts[1]++;
    y--;
  }
  if (y < 0 || counts[1] > maxCount) return NaN;
  while (y >= 0 && binary[y * width + centerX] && counts[0] <= maxCount) {
    counts[0]++;
    y--;
  }
  if (counts[0] > maxCount) return NaN;

  y = startY + 1;
  while (y < height && binary[y * width + centerX]) {
    counts[2]++;
    y++;
  }
  if (y >= height) return NaN;
  while (y < height && !binary[y * width + centerX] && counts[3] <= maxCount) {
    counts[3]++;
    y++;
  }
  if (y >= height || counts[3] > maxCount) return NaN;
  while (y < height && binary[y * width + centerX] && counts[4] <= maxCount) {
    counts[4]++;
    y++;
  }
  if (counts[4] > maxCount) return NaN;

  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (5 * Math.abs(total - totalModuleCount) >= 2 * totalModuleCount) return NaN;
  if (!isFinderRatio(counts)) return NaN;

  return y - counts[4] - counts[3] - counts[2] / 2.0;
}

function crossCheckHorizontal(binary, width, startX, centerY, maxCount, totalModuleCount) {
  const counts = [0, 0, 0, 0, 0];
  const rowOff = centerY * width;
  let x = startX;
  while (x >= 0 && binary[rowOff + x]) {
    counts[2]++;
    x--;
  }
  if (x < 0) return NaN;
  while (x >= 0 && !binary[rowOff + x] && counts[1] <= maxCount) {
    counts[1]++;
    x--;
  }
  if (x < 0 || counts[1] > maxCount) return NaN;
  while (x >= 0 && binary[rowOff + x] && counts[0] <= maxCount) {
    counts[0]++;
    x--;
  }
  if (counts[0] > maxCount) return NaN;

  x = startX + 1;
  while (x < width && binary[rowOff + x]) {
    counts[2]++;
    x++;
  }
  if (x >= width) return NaN;
  while (x < width && !binary[rowOff + x] && counts[3] <= maxCount) {
    counts[3]++;
    x++;
  }
  if (x >= width || counts[3] > maxCount) return NaN;
  while (x < width && binary[rowOff + x] && counts[4] <= maxCount) {
    counts[4]++;
    x++;
  }
  if (counts[4] > maxCount) return NaN;

  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (5 * Math.abs(total - totalModuleCount) >= totalModuleCount) return NaN;
  if (!isFinderRatio(counts)) return NaN;

  return x - counts[4] - counts[3] - counts[2] / 2.0;
}

/**
 * Locate all Finder Pattern centers in a binary image.
 */
export function findFinderPatterns(binary, width, height) {
  const centers = [];
  const skipRows = Math.max(1, Math.floor(height / 240));

  for (let y = skipRows - 1; y < height; y += skipRows) {
    const counts = [0, 0, 0, 0, 0];
    let currentState = 0;
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      if (binary[rowOff + x]) {
        if ((currentState & 1) === 1) {
          currentState++;
        }
        counts[currentState]++;
      } else {
        if ((currentState & 1) === 0) {
          if (currentState === 4) {
            if (isFinderRatio(counts)) {
              const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
              const centerXInt = Math.floor(x - counts[4] - counts[3] - counts[2] / 2.0);
              const centerY = crossCheckVertical(
                binary,
                width,
                height,
                y,
                centerXInt,
                counts[2] * 2,
                total
              );
              if (!Number.isNaN(centerY)) {
                const centerX = crossCheckHorizontal(
                  binary,
                  width,
                  centerXInt,
                  Math.floor(centerY),
                  counts[2] * 2,
                  total
                );
                if (!Number.isNaN(centerX)) {
                  const estModSize = total / 7.0;
                  let merged = false;
                  for (let i = 0; i < centers.length; i++) {
                    const c = centers[i];
                    if (
                      Math.hypot(centerX - c.x, centerY - c.y) <= Math.max(c.moduleSize, estModSize) * 2.5
                    ) {
                      const n = c.count + 1;
                      c.x = (c.count * c.x + centerX) / n;
                      c.y = (c.count * c.y + centerY) / n;
                      c.moduleSize = (c.count * c.moduleSize + estModSize) / n;
                      c.count = n;
                      merged = true;
                      break;
                    }
                  }
                  if (!merged) {
                    centers.push({ x: centerX, y: centerY, moduleSize: estModSize, count: 1 });
                  }
                }
              }
            }
            counts[0] = counts[2];
            counts[1] = counts[3];
            counts[2] = counts[4];
            counts[3] = 1;
            counts[4] = 0;
            currentState = 3;
          } else {
            currentState++;
            counts[currentState]++;
          }
        } else {
          counts[currentState]++;
        }
      }
    }
  }

  return centers.filter((c) => c.count >= 2).sort((a, b) => b.count - a.count);
}

/**
 * Order 3 finder patterns into { topLeft, topRight, bottomLeft } based on right-angle geometry
 * and 2D cross-product handedness.
 */
function orderThreeFinderPatterns(p0, p1, p2) {
  const d01 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
  const d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const d02 = Math.hypot(p0.x - p2.x, p0.y - p2.y);

  let topLeft, pointA, pointB;
  if (d12 >= d01 && d12 >= d02) {
    topLeft = p0;
    pointA = p1;
    pointB = p2;
  } else if (d02 >= d01 && d02 >= d12) {
    topLeft = p1;
    pointA = p0;
    pointB = p2;
  } else {
    topLeft = p2;
    pointA = p0;
    pointB = p1;
  }

  // Verify near-isosceles right triangle
  const legA = Math.hypot(pointA.x - topLeft.x, pointA.y - topLeft.y);
  const legB = Math.hypot(pointB.x - topLeft.x, pointB.y - topLeft.y);
  if (legA < 10 || legB < 10) return null;
  const ratio = Math.max(legA, legB) / Math.min(legA, legB);
  if (ratio > 1.35) return null;

  const cosAngle =
    ((pointA.x - topLeft.x) * (pointB.x - topLeft.x) +
      (pointA.y - topLeft.y) * (pointB.y - topLeft.y)) /
    (legA * legB);
  if (Math.abs(cosAngle) > 0.35) return null;

  // Cross product (A - TL) x (B - TL) determines clockwise vs counter-clockwise
  const cross =
    (pointA.x - topLeft.x) * (pointB.y - topLeft.y) -
    (pointA.y - topLeft.y) * (pointB.x - topLeft.x);

  const topRight = cross > 0 ? pointA : pointB;
  const bottomLeft = cross > 0 ? pointB : pointA;

  return { topLeft, topRight, bottomLeft };
}

/**
 * Search for the bottom-right alignment pattern near the expected coordinates (for Version >= 2)
 * to refine perspective sampling under camera tilt.
 */
function findAlignmentPattern(binary, width, height, estX, estY, moduleSize) {
  const radius = Math.max(6, Math.round(moduleSize * 4));
  const xMin = Math.max(2, Math.round(estX - radius));
  const xMax = Math.min(width - 3, Math.round(estX + radius));
  const yMin = Math.max(2, Math.round(estY - radius));
  const yMax = Math.min(height - 3, Math.round(estY + radius));

  let bestX = estX;
  let bestY = estY;
  let bestScore = Infinity;

  // Alignment pattern has a dark center (1x1), surrounded by a light ring (3x3), surrounded by a dark ring (5x5)
  const step = Math.max(1, Math.round(moduleSize));
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      if (!binary[y * width + x]) continue; // Center must be dark
      // Check light ring at distance ~1*moduleSize in 4 directions
      const lUp = y - step >= 0 ? binary[(y - step) * width + x] : 1;
      const lDn = y + step < height ? binary[(y + step) * width + x] : 1;
      const lLt = x - step >= 0 ? binary[y * width + (x - step)] : 1;
      const lRt = x + step < width ? binary[y * width + (x + step)] : 1;
      if (lUp || lDn || lLt || lRt) continue;

      // Check dark ring at distance ~2*moduleSize
      const step2 = Math.max(2, Math.round(moduleSize * 2));
      const dUp = y - step2 >= 0 ? binary[(y - step2) * width + x] : 0;
      const dDn = y + step2 < height ? binary[(y + step2) * width + x] : 0;
      const dLt = x - step2 >= 0 ? binary[y * width + (x - step2)] : 0;
      const dRt = x + step2 < width ? binary[y * width + (x + step2)] : 0;
      if (!dUp || !dDn || !dLt || !dRt) continue;

      const dist = Math.hypot(x - estX, y - estY);
      if (dist < bestScore) {
        bestScore = dist;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY, found: bestScore < Infinity };
}

/**
 * Compute 3x3 Projective Homography Matrix H mapping unit square (0,0),(1,0),(1,1),(0,1)
 * to arbitrary quadrilateral (x0,y0),(x1,y1),(x2,y2),(x3,y3), then compose with inverse
 * source-rect mapping so (u, v) module coordinates map directly to image pixels (x, y).
 */
function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-7 && Math.abs(dy3) < 1e-7) {
    return [
      x1 - x0, x2 - x1, x0,
      y1 - y0, y2 - y1, y0,
      0, 0, 1
    ];
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const denom = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / denom;
  const a23 = (dx1 * dy3 - dx3 * dy1) / denom;
  return [
    x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
    y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0,
    a13, a23, 1
  ];
}

function quadToSquare(x0, y0, x1, y1, x2, y2, x3, y3) {
  const m = squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3);
  // Adjoint of 3x3 matrix m
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
  ];
}

function multiply3x3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
  ];
}

function buildPerspectiveTransform(
  u0, v0, u1, v1, u2, v2, u3, v3,
  x0, y0, x1, y1, x2, y2, x3, y3
) {
  const qToS = quadToSquare(u0, v0, u1, v1, u2, v2, u3, v3);
  const sToQ = squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3);
  return multiply3x3(sToQ, qToS);
}

/**
 * Sample a QR grid from a finder-pattern triplet using projective homography
 * and majority-vote 5-point sub-module super-sampling for blur/noise resilience.
 */
function sampleAndDecodeFromTriplet(binary, width, height, triplet) {
  const { topLeft, topRight, bottomLeft } = triplet;
  const distTop = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const distLeft = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  const avgModuleSize = (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3.0;

  const estDimension = Math.round(((distTop + distLeft) / (2.0 * avgModuleSize)) + 7.0);
  const estVersion = Math.max(1, Math.min(40, Math.round((estDimension - 17) / 4)));

  // Try candidate versions around estVersion (estVersion, estVersion-1, estVersion+1, estVersion-2, estVersion+2)
  const candidateVersions = [estVersion];
  for (const delta of [-1, 1, -2, 2]) {
    const v = estVersion + delta;
    if (v >= 1 && v <= 40) candidateVersions.push(v);
  }

  // Parallelogram estimate of 4th point (Either bottom-right alignment center or virtual finder corner)
  const paraX = topRight.x - topLeft.x + bottomLeft.x;
  const paraY = topRight.y - topLeft.y + bottomLeft.y;

  for (const version of candidateVersions) {
    const moduleCount = version * 4 + 17;
    const dimMinusThree = moduleCount - 3.5;

    let srcBottomRightU = dimMinusThree;
    let srcBottomRightV = dimMinusThree;
    let dstBottomRightX = paraX;
    let dstBottomRightY = paraY;

    if (version >= 2) {
      // Expected alignment pattern center is at (moduleCount - 6.5, moduleCount - 6.5)
      const scaleToAlign = 1.0 - 3.0 / (moduleCount - 7.0);
      const expAlignX = topLeft.x + scaleToAlign * (paraX - topLeft.x);
      const expAlignY = topLeft.y + scaleToAlign * (paraY - topLeft.y);
      const aligned = findAlignmentPattern(binary, width, height, expAlignX, expAlignY, avgModuleSize);
      if (aligned.found) {
        srcBottomRightU = moduleCount - 6.5;
        srcBottomRightV = moduleCount - 6.5;
        dstBottomRightX = aligned.x;
        dstBottomRightY = aligned.y;
      }
    }

    const H = buildPerspectiveTransform(
      3.5, 3.5,
      dimMinusThree, 3.5,
      srcBottomRightU, srcBottomRightV,
      3.5, dimMinusThree,
      topLeft.x, topLeft.y,
      topRight.x, topRight.y,
      dstBottomRightX, dstBottomRightY,
      bottomLeft.x, bottomLeft.y
    );

    const modules = new Uint8Array(moduleCount * moduleCount);
    const subOffsets = [
      [0, 0],
      [-0.22, 0],
      [0.22, 0],
      [0, -0.22],
      [0, 0.22]
    ];

    for (let r = 0; r < moduleCount; r++) {
      const vBase = r + 0.5;
      for (let c = 0; c < moduleCount; c++) {
        const uBase = c + 0.5;
        let darkVotes = 0;
        for (let s = 0; s < 5; s++) {
          const u = uBase + subOffsets[s][0];
          const v = vBase + subOffsets[s][1];
          const denom = H[6] * u + H[7] * v + H[8];
          const px = Math.round((H[0] * u + H[1] * v + H[2]) / denom);
          const py = Math.round((H[3] * u + H[4] * v + H[5]) / denom);
          if (px >= 0 && px < width && py >= 0 && py < height) {
            if (binary[py * width + px]) darkVotes++;
          }
        }
        modules[r * moduleCount + c] = darkVotes >= 3 ? 1 : 0;
      }
    }

    const decoded = decodeQrMatrixAnyOrientation(modules, moduleCount, true);
    if (decoded) {
      // Compute outer bounding corners for UI overlay
      const mapPt = (u, v) => {
        const d = H[6] * u + H[7] * v + H[8];
        return {
          x: (H[0] * u + H[1] * v + H[2]) / d,
          y: (H[3] * u + H[4] * v + H[5]) / d
        };
      };
      decoded.cornerPoints = [
        mapPt(0, 0),
        mapPt(moduleCount, 0),
        mapPt(moduleCount, moduleCount),
        mapPt(0, moduleCount)
      ];
      return decoded;
    }
  }

  return null;
}

/**
 * Fallback Direct Bounding-Box Sampler for axis-aligned or cropped QR images
 * where 1 of the 3 finder patterns was clipped or heavily blurred.
 */
function fallbackBoundingBoxDecode(binary, width, height) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (binary[rowOff + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  if (boxW < 21 || boxH < 21) return null;

  // Estimate module size from top-left finder outer width (7 modules)
  let run = 0;
  for (let d = 0; d < Math.min(boxW, boxH, 80); d++) {
    const y = minY + Math.min(2, d);
    let x = minX;
    while (x <= maxX && !binary[y * width + x]) x++;
    let darkRun = 0;
    while (x <= maxX && binary[y * width + x]) {
      darkRun++;
      x++;
    }
    if (darkRun >= 7) {
      run = darkRun;
      break;
    }
  }

  const estModPx = run >= 7 ? run / 7.0 : boxW / 33.0;
  const estModuleCount = Math.round(((boxW + boxH) / 2.0) / estModPx);
  const estVer = Math.max(1, Math.min(40, Math.round((estModuleCount - 17) / 4)));

  for (let delta = -2; delta <= 2; delta++) {
    const v = estVer + delta;
    if (v < 1 || v > 40) continue;
    const moduleCount = v * 4 + 17;
    const stepX = boxW / moduleCount;
    const stepY = boxH / moduleCount;
    const modules = new Uint8Array(moduleCount * moduleCount);

    for (let r = 0; r < moduleCount; r++) {
      const py = Math.min(height - 1, Math.max(0, Math.round(minY + (r + 0.5) * stepY)));
      for (let c = 0; c < moduleCount; c++) {
        const px = Math.min(width - 1, Math.max(0, Math.round(minX + (c + 0.5) * stepX)));
        modules[r * moduleCount + c] = binary[py * width + px];
      }
    }

    const decoded = decodeQrMatrixAnyOrientation(modules, moduleCount, true);
    if (decoded) {
      decoded.cornerPoints = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ];
      return decoded;
    }
  }

  return null;
}

/**
 * Decode a single QR code inside an ImageData (or a sub-rectangle of an ImageData).
 */
export function decodeSingleQrRegion(imageData, subRect = null) {
  const { width, height, x0, y0, binary } = binarizeImageData(imageData, subRect);
  const centers = findFinderPatterns(binary, width, height);

  if (centers.length >= 3) {
    const maxCand = Math.min(centers.length, 9);
    for (let i = 0; i < maxCand - 2; i++) {
      for (let j = i + 1; j < maxCand - 1; j++) {
        for (let k = j + 1; k < maxCand; k++) {
          const ordered = orderThreeFinderPatterns(centers[i], centers[j], centers[k]);
          if (!ordered) continue;
          const res = sampleAndDecodeFromTriplet(binary, width, height, ordered);
          if (res) {
            if (x0 !== 0 || y0 !== 0) {
              res.cornerPoints = res.cornerPoints.map((pt) => ({ x: pt.x + x0, y: pt.y + y0 }));
            }
            return res;
          }
        }
      }
    }
  }

  const fallback = fallbackBoundingBoxDecode(binary, width, height);
  if (fallback && (x0 !== 0 || y0 !== 0)) {
    fallback.cornerPoints = fallback.cornerPoints.map((pt) => ({ x: pt.x + x0, y: pt.y + y0 }));
  }
  return fallback;
}

/**
 * Detect and decode up to 4 simultaneous QR codes from an ImageData frame.
 * Combines full-frame multi-finder clustering with quadrant/half sub-region scanning
 * so 1-QR, 2-QR, and 4-QR (2x2 grid) displays decode reliably.
 */
export function detectMultiQrFromImageData(imageData, expectedCount = 4) {
  const results = [];
  const seenValues = new Set();

  const addResult = (res, panelIndex = 0) => {
    if (!res) return;
    const key = res.rawValue || (res.rawBytes ? Array.from(res.rawBytes.subarray(0, 24)).join(',') : '');
    if (!key || seenValues.has(key)) return;
    seenValues.add(key);
    res.panelIndex = panelIndex;
    results.push(res);
  };

  const W = imageData.width;
  const H = imageData.height;

  // 1. If expectedCount === 4 (or auto), scan the 4 quadrants (with 6% overlap margin)
  if (expectedCount === 4 || expectedCount === 0) {
    const padX = Math.floor(W * 0.04);
    const padY = Math.floor(H * 0.04);
    const halfW = Math.floor(W / 2);
    const halfH = Math.floor(H / 2);

    const quadrants = [
      { x: 0, y: 0, width: halfW + padX, height: halfH + padY, panel: 0 },
      { x: Math.max(0, halfW - padX), y: 0, width: W - Math.max(0, halfW - padX), height: halfH + padY, panel: 1 },
      { x: 0, y: Math.max(0, halfH - padY), width: halfW + padX, height: H - Math.max(0, halfH - padY), panel: 2 },
      { x: Math.max(0, halfW - padX), y: Math.max(0, halfH - padY), width: W - Math.max(0, halfW - padX), height: H - Math.max(0, halfH - padY), panel: 3 }
    ];

    for (const q of quadrants) {
      const res = decodeSingleQrRegion(imageData, q);
      if (res) addResult(res, q.panel);
    }
    if (results.length > 0) return results;
  }

  // 2. If expectedCount === 2 (or 4-quadrant found nothing), try 2 side-by-side or stacked halves
  if (expectedCount === 2 || results.length === 0) {
    const padX = Math.floor(W * 0.05);
    const halfW = Math.floor(W / 2);
    const halves = [
      { x: 0, y: 0, width: halfW + padX, height: H, panel: 0 },
      { x: Math.max(0, halfW - padX), y: 0, width: W - Math.max(0, halfW - padX), height: H, panel: 1 }
    ];
    for (const h of halves) {
      const res = decodeSingleQrRegion(imageData, h);
      if (res) addResult(res, h.panel);
    }
    if (results.length > 0 && expectedCount === 2) return results;
  }

  // 3. Full-frame single/multi-triplet scan
  const fullRes = decodeSingleQrRegion(imageData, null);
  if (fullRes) addResult(fullRes, 0);

  return results;
}

/**
 * High-Level Hybrid QR Detector Controller
 * Automatically uses Native BarcodeDetector when available and falls back to / augments with
 * the built-in Pure-JS ISO/IEC 18004 Multi-QR Decoder.
 */
export class HybridQrDetector {
  constructor(options = {}) {
    this.enginePreference = options.engine || 'auto'; // 'auto' | 'native-plus-js' | 'pure-js'
    this.nativeDetector = null;
    this._initNative();
  }

  _initNative() {
    if (this.enginePreference !== 'pure-js' && typeof globalThis.BarcodeDetector !== 'undefined') {
      try {
        this.nativeDetector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        this.nativeDetector = null;
      }
    }
  }

  getActiveEngineName() {
    if (this.enginePreference === 'pure-js' || !this.nativeDetector) {
      return 'QuadBeam ISO/IEC-18004 JS Engine (Reed-Solomon + Homography)';
    }
    return 'Hybrid (Native BarcodeDetector + QuadBeam ISO-18004 JS)';
  }

  /**
   * Detect 1, 2, or 4 QR codes from an ImageData (or Canvas/Video with ImageData extraction).
   */
  async detectFromImageData(imageData, expectedCount = 4) {
    const t0 = performance.now();
    const results = [];
    const seen = new Set();

    if (this.nativeDetector && this.enginePreference !== 'pure-js' && typeof ImageBitmap !== 'undefined') {
      try {
        const bitmap = await createImageBitmap(imageData);
        const barcodes = await this.nativeDetector.detect(bitmap);
        bitmap.close();
        for (let i = 0; i < barcodes.length; i++) {
          const b = barcodes[i];
          if (b.rawValue && !seen.has(b.rawValue)) {
            seen.add(b.rawValue);
            results.push({
              rawValue: b.rawValue,
              rawBytes: b.rawValue ? null : undefined,
              cornerPoints: b.cornerPoints || [],
              panelIndex: i
            });
          }
        }
      } catch {
        // Fallback to pure-JS engine
      }
    }

    if (results.length < expectedCount) {
      const jsResults = detectMultiQrFromImageData(imageData, expectedCount);
      for (const r of jsResults) {
        if (!seen.has(r.rawValue)) {
          seen.add(r.rawValue);
          results.push(r);
        }
      }
    }

    const latencyMs = performance.now() - t0;
    return { results, latencyMs };
  }
}
