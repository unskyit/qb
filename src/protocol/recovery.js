/**
 * QuadBeam Recovery & Repair-Request QR Protocol
 * Allows a receiver with incomplete blocks to display a single compact Repair QR code
 * that the sender can scan (or enter) to transmit ONLY the missing generations/blocks.
 */

import { PACKET_TYPE } from './constants.js';
import { serializePacket } from './packet-format.js';
import { parsePacket } from './packet-parser.js';
import { encodeBase45, decodeBase45 } from './encoding.js';

/**
 * Encode a list of missing global block indices into a compact binary payload:
 * [0..1] uint16 BE : number of missing ranges (R)
 * followed by R * 6 bytes:
 *   [0..3] uint32 BE : startBlockIndex
 *   [4..5] uint16 BE : runLength (1..65535)
 */
export function encodeRepairRequest({
  sessionId,
  fileId,
  missingBlockIndices
}) {
  const sorted = Array.from(new Set(missingBlockIndices)).sort((a, b) => a - b);
  const ranges = [];

  let i = 0;
  while (i < sorted.length && ranges.length < 180) {
    const start = sorted[i];
    let run = 1;
    while (
      i + run < sorted.length &&
      sorted[i + run] === start + run &&
      run < 65535
    ) {
      run++;
    }
    ranges.push({ start, run });
    i += run;
  }

  const payload = new Uint8Array(2 + ranges.length * 6);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, ranges.length, false);

  for (let r = 0; r < ranges.length; r++) {
    const off = 2 + r * 6;
    dv.setUint32(off, ranges[r].start >>> 0, false);
    dv.setUint16(off + 4, ranges[r].run & 0xffff, false);
  }

  const packet = serializePacket({
    packetType: PACKET_TYPE.REPAIR_REQUEST,
    panelId: 0,
    sessionId,
    fileId,
    generationId: 0,
    sequenceId: 0,
    blockIndexOrSeed: sorted.length,
    payload
  });

  return {
    packet,
    qrString: encodeBase45(packet),
    totalMissingCount: sorted.length,
    encodedRangesCount: ranges.length
  };
}

export function decodeRepairRequest(qrStringOrBytes) {
  const bytes =
    typeof qrStringOrBytes === 'string'
      ? decodeBase45(qrStringOrBytes.trim())
      : qrStringOrBytes;

  const parsed = parsePacket(bytes);
  if (parsed.packetType !== PACKET_TYPE.REPAIR_REQUEST) {
    throw new Error('Scanned QR is not a valid QuadBeam Repair Request packet');
  }

  const dv = new DataView(
    parsed.payload.buffer,
    parsed.payload.byteOffset,
    parsed.payload.byteLength
  );
  if (parsed.payload.byteLength < 2) {
    throw new Error('Truncated repair request payload');
  }

  const rangeCount = dv.getUint16(0, false);
  if (parsed.payload.byteLength < 2 + rangeCount * 6) {
    throw new Error('Corrupted repair request ranges');
  }

  const missingBlockIndices = [];
  for (let r = 0; r < rangeCount; r++) {
    const off = 2 + r * 6;
    const start = dv.getUint32(off, false);
    const run = dv.getUint16(off + 4, false);
    for (let k = 0; k < run; k++) {
      missingBlockIndices.push(start + k);
    }
  }

  return {
    sessionId: parsed.sessionId,
    fileId: parsed.fileId,
    totalMissingReported: parsed.blockIndexOrSeed,
    missingBlockIndices
  };
}
