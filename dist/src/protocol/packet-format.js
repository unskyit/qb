/**
 * QuadBeam Binary Packet Serializer (Protocol v1)
 *
 * 24-Byte Fixed Header + Variable Payload + 4-Byte CRC32 Trailer:
 * [0..1]   uint16 BE : Protocol Magic (0x5142 'QB')
 * [2]      uint8     : Protocol Version (1)
 * [3]      uint8     : Flags (bits 7..6) | Panel ID 0..7 (bits 5..3) | Packet Type 1..7 (bits 2..0)
 * [4..7]   uint32 BE : Session ID
 * [8..11]  uint32 BE : File / Transfer ID
 * [12..13] uint16 BE : Generation / Window ID
 * [14..17] uint32 BE : Sequence / Frame ID
 * [18..21] uint32 BE : Block Index (for SOURCE_BLOCK) or Degree+Seed (for FOUNTAIN_BLOCK)
 * [22..23] uint16 BE : Payload Byte Length (N)
 * [24..24+N-1]       : Binary Payload (N bytes)
 * [24+N..24+N+3]     : CRC32 over [0..24+N-1] (uint32 BE)
 */

import {
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  PACKET_HEADER_SIZE,
  PACKET_OVERHEAD_SIZE,
  MAX_PACKET_PAYLOAD_BYTES
} from './constants.js';
import { crc32 } from './integrity.js';

export function serializePacket({
  packetType,
  panelId = 0,
  flags = 0,
  sessionId,
  fileId,
  generationId = 0,
  sequenceId = 0,
  blockIndexOrSeed = 0,
  payload
}) {
  const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload || 0);
  const payloadLength = payloadBytes.byteLength;

  if (payloadLength > MAX_PACKET_PAYLOAD_BYTES) {
    throw new RangeError(`Packet payload length ${payloadLength} exceeds maximum ${MAX_PACKET_PAYLOAD_BYTES}`);
  }

  const totalLength = PACKET_OVERHEAD_SIZE + payloadLength;
  const packet = new Uint8Array(totalLength);
  const dv = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  const flagsAndType = ((flags & 0xc0) | ((panelId & 0x07) << 3) | (packetType & 0x07)) & 0xff;

  dv.setUint16(0, PROTOCOL_MAGIC, false);
  dv.setUint8(2, PROTOCOL_VERSION);
  dv.setUint8(3, flagsAndType);
  dv.setUint32(4, sessionId >>> 0, false);
  dv.setUint32(8, fileId >>> 0, false);
  dv.setUint16(12, generationId & 0xffff, false);
  dv.setUint32(14, sequenceId >>> 0, false);
  dv.setUint32(18, blockIndexOrSeed >>> 0, false);
  dv.setUint16(22, payloadLength & 0xffff, false);

  if (payloadLength > 0) {
    packet.set(payloadBytes, PACKET_HEADER_SIZE);
  }

  const checksum = crc32(packet, 0, PACKET_HEADER_SIZE + payloadLength);
  dv.setUint32(PACKET_HEADER_SIZE + payloadLength, checksum >>> 0, false);

  return packet;
}

export function packFountainSeed(degree, seed24) {
  return (((degree & 0xff) << 24) | (seed24 & 0x00ffffff)) >>> 0;
}

export function unpackFountainSeed(packed) {
  return {
    degree: (packed >>> 24) & 0xff,
    seed: packed & 0x00ffffff
  };
}
