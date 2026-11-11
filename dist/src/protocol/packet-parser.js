/**
 * QuadBeam Binary Packet Parser & Validator (Protocol v1)
 * Validates magic, version, length bounds, and IEEE 802.3 CRC32 before exposing payload.
 */

import {
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  PACKET_HEADER_SIZE,
  PACKET_OVERHEAD_SIZE,
  MAX_PACKET_PAYLOAD_BYTES
} from './constants.js';
import { crc32 } from './integrity.js';
import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

export function parsePacket(rawBytes) {
  if (!(rawBytes instanceof Uint8Array)) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      'Packet input must be a Uint8Array'
    );
  }

  if (rawBytes.byteLength < PACKET_OVERHEAD_SIZE) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Packet too short (${rawBytes.byteLength} bytes < ${PACKET_OVERHEAD_SIZE} minimum)`
    );
  }

  const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const magic = dv.getUint16(0, false);
  if (magic !== PROTOCOL_MAGIC) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_INVALID_MAGIC,
      `Invalid protocol magic: 0x${magic.toString(16)}`
    );
  }

  const version = dv.getUint8(2);
  if (version !== PROTOCOL_VERSION) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_UNSUPPORTED_VERSION,
      `Unsupported protocol version: ${version}`
    );
  }

  const flagsAndType = dv.getUint8(3);
  const packetType = flagsAndType & 0x07;
  const panelId = (flagsAndType >>> 3) & 0x07;
  const flags = flagsAndType & 0xc0;

  const sessionId = dv.getUint32(4, false);
  const fileId = dv.getUint32(8, false);
  const generationId = dv.getUint16(12, false);
  const sequenceId = dv.getUint32(14, false);
  const blockIndexOrSeed = dv.getUint32(18, false);
  const payloadLength = dv.getUint16(22, false);

  if (payloadLength > MAX_PACKET_PAYLOAD_BYTES) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Invalid payload length ${payloadLength} (> ${MAX_PACKET_PAYLOAD_BYTES})`
    );
  }

  const expectedTotal = PACKET_OVERHEAD_SIZE + payloadLength;
  if (rawBytes.byteLength !== expectedTotal) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_TRUNCATED_PACKET,
      `Packet byte length mismatch: got ${rawBytes.byteLength}, expected ${expectedTotal}`
    );
  }

  const expectedCrc = dv.getUint32(PACKET_HEADER_SIZE + payloadLength, false);
  const actualCrc = crc32(rawBytes, 0, PACKET_HEADER_SIZE + payloadLength);
  if (expectedCrc !== actualCrc) {
    throw new QuadBeamError(
      ERROR_CODES.PROTOCOL_CHECKSUM_MISMATCH,
      `Packet CRC32 mismatch: expected 0x${expectedCrc.toString(16)}, computed 0x${actualCrc.toString(16)}`
    );
  }

  const payload = rawBytes.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + payloadLength);

  return {
    version,
    packetType,
    panelId,
    flags,
    sessionId,
    fileId,
    generationId,
    sequenceId,
    blockIndexOrSeed,
    payloadLength,
    payload,
    crc32: expectedCrc
  };
}
