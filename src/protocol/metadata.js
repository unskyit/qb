/**
 * QuadBeam Metadata Packet Encoder & Validator
 * Serializes and validates transfer metadata safely before allocating storage.
 *
 * Binary Metadata Payload Layout:
 * [0..7]   uint64 BE (as two uint32) : Total File Size in bytes
 * [8..9]   uint16 BE                 : Block Size in bytes
 * [10..13] uint32 BE                 : Total Source Blocks
 * [14..15] uint16 BE                 : Generation Window Size (blocks per generation)
 * [16..17] uint16 BE                 : Total Generations
 * [18]     uint8                     : Encryption Mode (0 = None, 1 = AES-256-GCM)
 * [19..50] 32 bytes                  : Full-File SHA-256 Digest
 * [51..78] 28 bytes (optional)       : If encrypted: 16B PBKDF2 Salt + 12B IV Base
 * [next]   uint16 BE                 : Filename UTF-8 byte length + UTF-8 bytes
 * [next]   uint8                     : MIME type ASCII byte length + ASCII bytes
 */

import {
  DEFAULT_MAX_FILE_SIZE,
  HARD_MAX_FILE_SIZE,
  MAX_METADATA_BYTES,
  DEFAULT_GENERATION_BLOCKS
} from './constants.js';
import { sanitizeFilename, sanitizeMimeType } from '../utils/sanitization.js';
import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

export function encodeMetadataPayload({
  filename,
  fileSize,
  mimeType = 'application/octet-stream',
  blockSize = 220,
  totalBlocks,
  generationSize = DEFAULT_GENERATION_BLOCKS,
  totalGenerations,
  sha256Digest,
  encryptionMode = 0,
  encryptionSalt = null,
  encryptionIvBase = null
}) {
  const safeName = sanitizeFilename(filename);
  const safeMime = sanitizeMimeType(mimeType);
  const enc = new TextEncoder();
  const nameBytes = enc.encode(safeName);
  const mimeBytes = enc.encode(safeMime);

  if (!(sha256Digest instanceof Uint8Array) || sha256Digest.length !== 32) {
    throw new Error('Metadata requires a 32-byte SHA-256 digest');
  }

  const computedTotalBlocks =
    totalBlocks !== undefined ? totalBlocks : Math.max(1, Math.ceil(fileSize / blockSize));
  const computedTotalGens =
    totalGenerations !== undefined
      ? totalGenerations
      : Math.max(1, Math.ceil(computedTotalBlocks / generationSize));

  const encExtraLen = encryptionMode === 1 ? 28 : 0;
  const totalLen = 51 + encExtraLen + 2 + nameBytes.length + 1 + mimeBytes.length;

  if (totalLen > MAX_METADATA_BYTES) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_OVERSIZED_METADATA,
      `Metadata payload exceeds maximum allowed size (${totalLen} > ${MAX_METADATA_BYTES})`
    );
  }

  const buf = new Uint8Array(totalLen);
  const dv = new DataView(buf.buffer);

  const highSize = Math.floor(fileSize / 4294967296) >>> 0;
  const lowSize = (fileSize >>> 0);

  dv.setUint32(0, highSize, false);
  dv.setUint32(4, lowSize, false);
  dv.setUint16(8, blockSize, false);
  dv.setUint32(10, computedTotalBlocks >>> 0, false);
  dv.setUint16(14, generationSize, false);
  dv.setUint16(16, computedTotalGens, false);
  dv.setUint8(18, encryptionMode & 0xff);
  buf.set(sha256Digest, 19);

  let offset = 51;
  if (encryptionMode === 1) {
    if (
      !(encryptionSalt instanceof Uint8Array) ||
      encryptionSalt.length !== 16 ||
      !(encryptionIvBase instanceof Uint8Array) ||
      encryptionIvBase.length !== 12
    ) {
      throw new Error('Encrypted metadata requires 16-byte salt and 12-byte IV base');
    }
    buf.set(encryptionSalt, offset);
    offset += 16;
    buf.set(encryptionIvBase, offset);
    offset += 12;
  }

  dv.setUint16(offset, nameBytes.length, false);
  offset += 2;
  buf.set(nameBytes, offset);
  offset += nameBytes.length;

  dv.setUint8(offset, mimeBytes.length);
  offset += 1;
  buf.set(mimeBytes, offset);

  return buf;
}

export function decodeMetadataPayload(payload, maxAllowedFileSize = DEFAULT_MAX_FILE_SIZE) {
  if (!(payload instanceof Uint8Array) || payload.byteLength < 54) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      'Metadata payload is truncated'
    );
  }
  if (payload.byteLength > MAX_METADATA_BYTES) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_OVERSIZED_METADATA,
      'Metadata payload exceeds size limit'
    );
  }

  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const highSize = dv.getUint32(0, false);
  const lowSize = dv.getUint32(4, false);
  const fileSize = highSize * 4294967296 + lowSize;

  const effectiveLimit = Math.min(HARD_MAX_FILE_SIZE, Math.max(DEFAULT_MAX_FILE_SIZE, maxAllowedFileSize));
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > effectiveLimit) {
    throw new QuadBeamError(
      ERROR_CODES.FILE_TOO_LARGE,
      `Announced file size (${fileSize} bytes) exceeds maximum allowed limit (${effectiveLimit} bytes)`
    );
  }

  const blockSize = dv.getUint16(8, false);
  if (blockSize < 16 || blockSize > 2048) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Invalid metadata blockSize: ${blockSize}`
    );
  }

  const totalBlocks = dv.getUint32(10, false);
  const expectedBlocks = fileSize === 0 ? 1 : Math.ceil(fileSize / blockSize);
  if (totalBlocks !== expectedBlocks) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Inconsistent totalBlocks (${totalBlocks}) for fileSize ${fileSize} and blockSize ${blockSize}`
    );
  }

  const generationSize = dv.getUint16(14, false);
  const totalGenerations = dv.getUint16(16, false);
  const expectedGens = Math.max(1, Math.ceil(totalBlocks / generationSize));
  if (generationSize < 1 || generationSize > 4096 || totalGenerations !== expectedGens) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Invalid generation parameters: size=${generationSize}, count=${totalGenerations}`
    );
  }

  const encryptionMode = dv.getUint8(18);
  const sha256Digest = new Uint8Array(payload.subarray(19, 51));

  let offset = 51;
  let encryptionSalt = null;
  let encryptionIvBase = null;

  if (encryptionMode === 1) {
    if (payload.byteLength < offset + 28 + 3) {
      throw new QuadBeamError(
        ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
        'Truncated encryption parameters in metadata'
      );
    }
    encryptionSalt = new Uint8Array(payload.subarray(offset, offset + 16));
    offset += 16;
    encryptionIvBase = new Uint8Array(payload.subarray(offset, offset + 12));
    offset += 12;
  }

  if (payload.byteLength < offset + 3) {
    throw new QuadBeamError(ERROR_CODES.PROTOCOL_TRUNCATED_PACKET, 'Truncated filename length');
  }

  const nameLen = dv.getUint16(offset, false);
  offset += 2;
  if (nameLen > 512 || payload.byteLength < offset + nameLen + 1) {
    throw new QuadBeamError(ERROR_CODES.PROTOCOL_TRUNCATED_PACKET, 'Truncated filename in metadata');
  }

  const dec = new TextDecoder('utf-8', { fatal: false });
  const rawName = dec.decode(payload.subarray(offset, offset + nameLen));
  offset += nameLen;

  const mimeLen = dv.getUint8(offset);
  offset += 1;
  if (mimeLen > 255 || payload.byteLength < offset + mimeLen) {
    throw new QuadBeamError(ERROR_CODES.PROTOCOL_TRUNCATED_PACKET, 'Truncated MIME type in metadata');
  }
  const rawMime = dec.decode(payload.subarray(offset, offset + mimeLen));

  return {
    filename: sanitizeFilename(rawName),
    fileSize,
    mimeType: sanitizeMimeType(rawMime),
    blockSize,
    totalBlocks,
    generationSize,
    totalGenerations,
    sha256Digest,
    encryptionMode,
    encryptionSalt,
    encryptionIvBase
  };
}
