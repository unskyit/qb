/**
 * QuadBeam Unit Tests: Protocol, Base45, Checksums, Metadata, Sanitization, & LT Fountain Coding
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { PACKET_TYPE, DEFAULT_MAX_FILE_SIZE } from '../../src/protocol/constants.js';
import { serializePacket, packFountainSeed, unpackFountainSeed } from '../../src/protocol/packet-format.js';
import { parsePacket } from '../../src/protocol/packet-parser.js';
import { encodeBase45, decodeBase45, encodePacketWire, decodePacketWire } from '../../src/protocol/encoding.js';
import { encodeMetadataPayload, decodeMetadataPayload } from '../../src/protocol/metadata.js';
import { crc32, IncrementalSha256, sha256Sync, bytesToHex } from '../../src/protocol/integrity.js';
import { GenerationFountainEncoder } from '../../src/protocol/fountain-encoder.js';
import { GenerationFountainDecoder } from '../../src/protocol/fountain-decoder.js';
import { sanitizeFilename, sanitizeMimeType } from '../../src/utils/sanitization.js';
import { generateDeterministicBinary } from '../fixtures/sample-data.js';

test('RFC 9285 Base45 round-trips arbitrary binary values including null bytes and 0xFF', () => {
  for (const len of [0, 1, 2, 3, 15, 140, 220, 320, 511]) {
    const raw = generateDeterministicBinary(len, len + 99);
    const encoded = encodeBase45(raw);
    const decoded = decodeBase45(encoded);
    assert.deepEqual(decoded, raw, `Base45 round-trip failed for length ${len}`);
  }
});

test('Base45 rejects invalid characters and overflow sequences', () => {
  assert.throws(() => decodeBase45('ABC@'));
  assert.throws(() => decodeBase45('A')); // length % 3 === 1 is invalid
  assert.throws(() => decodeBase45(':::')); // 44 + 44*45 + 44*2025 = 91124 > 65535
});

test('Packet serialization, parsing, and IEEE 802.3 CRC32 verification', () => {
  const payload = generateDeterministicBinary(220, 0x1234);
  const rawPacket = serializePacket({
    packetType: PACKET_TYPE.SOURCE_BLOCK,
    panelId: 2,
    flags: 0,
    sessionId: 0xdeadbeef,
    fileId: 0xcafebabe,
    generationId: 12,
    sequenceId: 1024,
    blockIndexOrSeed: 45,
    payload
  });

  const parsed = parsePacket(rawPacket);
  assert.equal(parsed.packetType, PACKET_TYPE.SOURCE_BLOCK);
  assert.equal(parsed.panelId, 2);
  assert.equal(parsed.sessionId, 0xdeadbeef);
  assert.equal(parsed.fileId, 0xcafebabe);
  assert.equal(parsed.generationId, 12);
  assert.equal(parsed.sequenceId, 1024);
  assert.equal(parsed.blockIndexOrSeed, 45);
  assert.equal(parsed.payloadLength, 220);
  assert.deepEqual(parsed.payload, payload);

  // Flip 1 bit in payload and verify CRC32 rejection
  const corrupted = new Uint8Array(rawPacket);
  corrupted[30] ^= 0x04;
  assert.throws(() => parsePacket(corrupted), /CRC32 mismatch/);

  // Corrupt protocol magic
  const badMagic = new Uint8Array(rawPacket);
  badMagic[0] = 0x00;
  assert.throws(() => parsePacket(badMagic), /Invalid protocol magic/);

  // Unsupported protocol version
  const badVer = new Uint8Array(rawPacket);
  badVer[2] = 99;
  assert.throws(() => parsePacket(badVer), /Unsupported protocol version/);
});

test('IncrementalSha256 matches Node.js crypto SHA-256 across chunk boundaries', () => {
  const data = generateDeterministicBinary(150000, 0x7788);
  const expectedHex = crypto.createHash('sha256').update(data).digest('hex');

  const hasher = new IncrementalSha256();
  let offset = 0;
  const stepSizes = [1, 7, 63, 64, 65, 512, 4096];
  let stepIdx = 0;
  while (offset < data.length) {
    const step = stepSizes[stepIdx++ % stepSizes.length];
    hasher.update(data.subarray(offset, Math.min(data.length, offset + step)));
    offset += step;
  }

  assert.equal(hasher.digestHex(), expectedHex);
});

test('Metadata encoding, validation, and size limit enforcement', () => {
  const digest = sha256Sync(new Uint8Array([1, 2, 3, 4]));
  const metaBytes = encodeMetadataPayload({
    filename: '../../unsafe/../secret<script>.pdf',
    fileSize: 1024 * 1024,
    mimeType: 'application/pdf',
    blockSize: 220,
    sha256Digest: digest
  });

  const decoded = decodeMetadataPayload(metaBytes, DEFAULT_MAX_FILE_SIZE);
  assert.equal(decoded.filename, 'secret_script_.pdf');
  assert.equal(decoded.fileSize, 1024 * 1024);
  assert.equal(decoded.mimeType, 'application/pdf');
  assert.equal(decoded.blockSize, 220);
  assert.deepEqual(decoded.sha256Digest, digest);

  // Reject oversized file metadata when limit is 10 MiB
  const hugeMeta = encodeMetadataPayload({
    filename: 'huge.bin',
    fileSize: 80 * 1024 * 1024,
    mimeType: 'application/octet-stream',
    blockSize: 220,
    sha256Digest: digest
  });
  assert.throws(() => decodeMetadataPayload(hugeMeta, 50 * 1024 * 1024), /exceeds maximum allowed limit/);
});

test('Filename sanitization blocks path traversal, control chars, and Windows reserved names', () => {
  assert.equal(sanitizeFilename('../../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\Windows\\System32\\cmd.exe'), 'cmd.exe');
  assert.equal(sanitizeFilename('CON.txt'), 'file_CON.txt');
  assert.equal(sanitizeFilename('nul'), 'file_nul');
  assert.equal(sanitizeFilename('hello\x00world<img src=x onerror=alert(1)>.png'), 'helloworld_img src=x onerror=alert(1)_.png');
  assert.equal(sanitizeMimeType('text/html; onload=evil'), 'application/octet-stream');
});

test('Hybrid LT Peeling + GF(2) Fountain Decoder reconstructs generation from pure rateless droplets', () => {
  const K = 64;
  const blockSize = 140;
  const sourceBlocks = Array.from({ length: K }, (_, i) =>
    generateDeterministicBinary(i === K - 1 ? 85 : blockSize, i + 500)
  );

  const encoder = new GenerationFountainEncoder(0, sourceBlocks, blockSize);
  const decoder = new GenerationFountainDecoder(0, K, blockSize, 85);

  let dropletsFed = 0;
  while (!decoder.isComplete() && dropletsFed < K * 2) {
    const droplet = encoder.nextDroplet();
    decoder.addFountainDroplet(droplet.degree, droplet.seed24, droplet.payload);
    dropletsFed++;
  }

  assert.equal(decoder.isComplete(), true, 'Fountain decoder did not complete');
  assert.ok(dropletsFed <= K + 16, `Expected near-optimal GF(2)/Peeling completion, took ${dropletsFed} droplets for K=${K}`);

  const reconstructed = decoder.exportBlocks();
  assert.equal(reconstructed.length, K);
  for (let i = 0; i < K; i++) {
    assert.deepEqual(reconstructed[i], sourceBlocks[i], `Block ${i} mismatch`);
  }
});
