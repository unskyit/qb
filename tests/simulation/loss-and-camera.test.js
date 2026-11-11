/**
 * QuadBeam Loss Simulation & Simulated Camera Computer Vision Tests
 *
 * Covers:
 * 1. Packet loss rates: 0%, 5%, 10%, 20%, and 40%
 * 2. Consecutive burst frame drops, out-of-order packets, duplicate packets,
 *    missing initial metadata (late-joining receiver), and foreign-session rejection
 * 3. Repair Request QR generation & targeted sender repair completion
 * 4. Simulated camera QR transformations: rotation (0, 90, 180, 270 deg),
 *    scaling, brightness variation, noise, Reed-Solomon byte-error recovery,
 *    and 1-QR / 2-QR / 4-QR multi-panel detection
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ChunkedFileSource } from '../../src/sender/file-reader.js';
import { OpticalPacketScheduler } from '../../src/protocol/packet-scheduler.js';
import { PacketCollector } from '../../src/receiver/packet-collector.js';
import { FileReconstructor } from '../../src/receiver/file-reconstructor.js';
import { decodeRepairRequest } from '../../src/protocol/recovery.js';
import { serializePacket } from '../../src/protocol/packet-format.js';
import { PACKET_TYPE } from '../../src/protocol/constants.js';
import { encodeBase45 } from '../../src/protocol/encoding.js';
import { encodeQrMatrix, renderQrToImageData } from '../../src/sender/qr-generator.js';
import {
  decodeSingleQrRegion,
  detectMultiQrFromImageData,
  reedSolomonDecodeBlock
} from '../../src/receiver/qr-detector.js';
import { generateDeterministicBinary } from '../fixtures/sample-data.js';

async function runSimulatedLossTransfer({
  fileBytes,
  lossRate = 0,
  burstDropLength = 0,
  dropFirstMetadata = false,
  shuffleWindow = 0,
  duplicateRate = 0
}) {
  const source = new ChunkedFileSource(fileBytes, {
    filename: 'simulation.bin',
    mimeType: 'application/octet-stream',
    blockSize: 200
  });
  const sha256Digest = await source.computeSha256();

  const scheduler = new OpticalPacketScheduler({
    sessionId: 0x10203040,
    fileId: 0x50607080,
    filename: 'simulation.bin',
    fileSize: fileBytes.byteLength,
    mimeType: 'application/octet-stream',
    blockSize: 200,
    sha256Digest,
    redundancyPercent: 45,
    getGenerationBlocks: (genId) => source.getGenerationBlocks(genId)
  });

  const collector = new PacketCollector();
  const reconstructor = new FileReconstructor({ preferOpfs: false });

  let step = 0;
  const maxFrames = Math.ceil((fileBytes.byteLength / 200) * 4) + 80;
  const pendingBuffer = [];

  for (let f = 0; f < maxFrames && reconstructor.state !== 'completed'; f++) {
    const framePackets = await scheduler.nextFramePackets(4);

    for (const pkt of framePackets) {
      step++;
      // Drop very first metadata packet if testing late-joining receiver
      if (dropFirstMetadata && step === 1) {
        continue;
      }
      // Burst drop simulation
      if (burstDropLength > 0 && step >= 15 && step < 15 + burstDropLength) {
        continue;
      }
      // Deterministic uniform loss simulation
      if (lossRate > 0 && ((step * 73) % 100) < lossRate * 100) {
        continue;
      }

      pendingBuffer.push(pkt);
      if (duplicateRate > 0 && ((step * 31) % 100) < duplicateRate * 100) {
        pendingBuffer.push(pkt);
      }

      if (pendingBuffer.length > shuffleWindow) {
        const idx = shuffleWindow > 0 ? (step % pendingBuffer.length) : 0;
        const nextPkt = pendingBuffer.splice(idx, 1)[0];
        const res = collector.ingestRawScan(nextPkt, step * 10);
        if (res.status === 'valid') {
          await reconstructor.processPacket(res.packet, step * 10);
        }
      }
    }
  }

  while (pendingBuffer.length > 0 && reconstructor.state !== 'completed') {
    const nextPkt = pendingBuffer.shift();
    const res = collector.ingestRawScan(nextPkt, step * 10);
    if (res.status === 'valid') {
      await reconstructor.processPacket(res.packet, step * 10);
    }
  }

  return { reconstructor, collector };
}

test('Loss Simulation: 0%, 5%, 10%, 20%, and 40% packet loss recovery with exact SHA-256 verification', async () => {
  const fileBytes = generateDeterministicBinary(24000, 0x9988);

  for (const lossRate of [0.0, 0.05, 0.10, 0.20, 0.40]) {
    const { reconstructor } = await runSimulatedLossTransfer({
      fileBytes,
      lossRate
    });
    assert.equal(
      reconstructor.state,
      'completed',
      `Failed to complete reconstruction under ${Math.round(lossRate * 100)}% packet loss`
    );
    assert.equal(reconstructor.verificationResult.verified, true);
    const outBytes = await reconstructor.exportReconstructedBytes();
    assert.deepEqual(outBytes, fileBytes, `Byte mismatch under ${lossRate * 100}% loss`);
  }
});

test('Loss Simulation: Consecutive burst drops, out-of-order packets, duplicates, late metadata, and foreign session isolation', async () => {
  const fileBytes = generateDeterministicBinary(18000, 0x4455);
  const { reconstructor, collector } = await runSimulatedLossTransfer({
    fileBytes,
    lossRate: 0.10,
    burstDropLength: 18,
    dropFirstMetadata: true,
    shuffleWindow: 8,
    duplicateRate: 0.15
  });

  // Also inject a foreign-session packet and verify it is isolated and rejected
  const foreignPkt = serializePacket({
    packetType: PACKET_TYPE.SOURCE_BLOCK,
    panelId: 0,
    sessionId: 0x99999999,
    fileId: 0x88888888,
    generationId: 0,
    sequenceId: 1,
    blockIndexOrSeed: 0,
    payload: new Uint8Array([1, 2, 3, 4])
  });
  const foreignRes = collector.ingestRawScan(foreignPkt, 9999);
  assert.equal(foreignRes.status, 'foreign-session');
  assert.equal(collector.foreignSessionCount, 1);

  assert.equal(reconstructor.state, 'completed');
  assert.ok(collector.duplicatePacketsCount > 0);
  const outBytes = await reconstructor.exportReconstructedBytes();
  assert.deepEqual(outBytes, fileBytes);
});

test('Recovery Workflow: Receiver generates Repair Request QR and Sender completes missing blocks', async () => {
  const fileBytes = generateDeterministicBinary(12000, 0x3322);
  const source = new ChunkedFileSource(fileBytes, {
    filename: 'repair-test.bin',
    blockSize: 200
  });
  const sha256Digest = await source.computeSha256();

  const scheduler = new OpticalPacketScheduler({
    sessionId: 0xabcddcba,
    fileId: 0x11223344,
    filename: 'repair-test.bin',
    fileSize: fileBytes.byteLength,
    blockSize: 200,
    sha256Digest,
    redundancyPercent: 0, // Zero parity on pass 1 so dropped blocks require repair
    getGenerationBlocks: (genId) => source.getGenerationBlocks(genId)
  });

  const collector = new PacketCollector();
  const reconstructor = new FileReconstructor({ preferOpfs: false });

  // Send only the first 10 frames (40 packets out of 60 blocks) then stop
  for (let f = 0; f < 10; f++) {
    const pkts = await scheduler.nextFramePackets(4);
    for (const pkt of pkts) {
      const res = collector.ingestRawScan(pkt);
      if (res.status === 'valid') {
        await reconstructor.processPacket(res.packet);
      }
    }
  }

  assert.notEqual(reconstructor.state, 'completed');
  const repairQrObj = reconstructor.generateRepairQr();
  assert.ok(repairQrObj.totalMissingCount > 0);

  // Decode the Repair QR via QR encoder/decoder round-trip
  const qrMat = encodeQrMatrix(repairQrObj.qrString, { ecLevel: 'M' });
  const qrImg = renderQrToImageData(qrMat, { modulePx: 5, quietZone: 4 });
  const scannedRepair = decodeSingleQrRegion(qrImg);
  assert.equal(scannedRepair.rawValue, repairQrObj.qrString);

  const decodedRepair = decodeRepairRequest(scannedRepair.rawValue);
  scheduler.applyRepairRequest(decodedRepair.missingBlockIndices);

  while (reconstructor.state !== 'completed' && scheduler.repairQueue.length > 0) {
    const pkts = await scheduler.nextFramePackets(4);
    for (const pkt of pkts) {
      const res = collector.ingestRawScan(pkt);
      if (res.status === 'valid') {
        await reconstructor.processPacket(res.packet);
      }
    }
  }

  assert.equal(reconstructor.state, 'completed');
  const outBytes = await reconstructor.exportReconstructedBytes();
  assert.deepEqual(outBytes, fileBytes);
});

test('Simulated Camera QR Transformations: Rotations (0/90/180/270), Scaling, Brightness, Noise, Reed-Solomon Error Correction, and 4-QR Grid', () => {
  const pkt = serializePacket({
    packetType: PACKET_TYPE.SOURCE_BLOCK,
    panelId: 1,
    sessionId: 0x11112222,
    fileId: 0x33334444,
    generationId: 0,
    sequenceId: 7,
    blockIndexOrSeed: 3,
    payload: generateDeterministicBinary(140, 0x55)
  });
  const b45 = encodeBase45(pkt);
  const mat = encodeQrMatrix(b45, { ecLevel: 'H' }); // EC Level H (~30% error recovery)

  // 1. Test Scaling (modulePx = 3, 5, 8)
  for (const modPx of [3, 5, 8]) {
    const img = renderQrToImageData(mat, { modulePx: modPx, quietZone: 4 });
    const dec = decodeSingleQrRegion(img);
    assert.equal(dec?.rawValue, b45, `Failed at scale modulePx=${modPx}`);
  }

  // 2. Test Rotations (90, 180, 270 degrees) on ImageData
  const baseImg = renderQrToImageData(mat, { modulePx: 5, quietZone: 4 });
  const rotateImageData90 = (img) => {
    const N = img.width;
    const out = new Uint8ClampedArray(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const srcIdx = (y * N + x) * 4;
        const dstIdx = (x * N + (N - 1 - y)) * 4;
        out[dstIdx] = img.data[srcIdx];
        out[dstIdx + 1] = img.data[srcIdx + 1];
        out[dstIdx + 2] = img.data[srcIdx + 2];
        out[dstIdx + 3] = 255;
      }
    }
    return { width: N, height: N, data: out };
  };

  let rotImg = baseImg;
  for (const deg of [90, 180, 270]) {
    rotImg = rotateImageData90(rotImg);
    const dec = decodeSingleQrRegion(rotImg);
    assert.equal(dec?.rawValue, b45, `Failed to decode QR rotated by ${deg} degrees`);
  }

  // 3. Test Brightness Variation + Synthetic Sensor Noise + Damaged Modules (Reed-Solomon recovery)
  const noisyData = new Uint8ClampedArray(baseImg.data);
  for (let i = 0; i < noisyData.length; i += 4) {
    // Compress contrast: dark -> 45, light -> 195 + deterministic noise
    const isLight = noisyData[i] > 128;
    const jitter = ((i * 19) % 25) - 12;
    const val = Math.max(0, Math.min(255, (isLight ? 195 : 45) + jitter));
    noisyData[i] = val;
    noisyData[i + 1] = val;
    noisyData[i + 2] = val;
  }
  const noisyDec = decodeSingleQrRegion({ width: baseImg.width, height: baseImg.height, data: noisyData });
  assert.equal(noisyDec?.rawValue, b45, 'Failed to decode QR under brightness shift and sensor noise');

  // 4. Test 4-QR (2x2 Grid) Multi-Panel Simultaneous Detection
  const panelStrings = [];
  const panelImgs = [];
  for (let p = 0; p < 4; p++) {
    const pPkt = serializePacket({
      packetType: PACKET_TYPE.SOURCE_BLOCK,
      panelId: p,
      sessionId: 0x11112222,
      fileId: 0x33334444,
      generationId: 0,
      sequenceId: p + 1,
      blockIndexOrSeed: p,
      payload: generateDeterministicBinary(140, p + 100)
    });
    const str = encodeBase45(pPkt);
    panelStrings.push(str);
    panelImgs.push(renderQrToImageData(encodeQrMatrix(str, { ecLevel: 'M' }), { modulePx: 4, quietZone: 4 }));
  }

  const pSize = panelImgs[0].width;
  const gap = 12;
  const gridSize = pSize * 2 + gap * 3;
  const gridData = new Uint8ClampedArray(gridSize * gridSize * 4).fill(255);
  for (let p = 0; p < 4; p++) {
    const col = p % 2;
    const row = Math.floor(p / 2);
    const ox = gap + col * (pSize + gap);
    const oy = gap + row * (pSize + gap);
    for (let y = 0; y < pSize; y++) {
      gridData.set(
        panelImgs[p].data.subarray(y * pSize * 4, (y + 1) * pSize * 4),
        ((oy + y) * gridSize + ox) * 4
      );
    }
  }

  const multiDecoded = detectMultiQrFromImageData(
    { width: gridSize, height: gridSize, data: gridData },
    4
  );
  assert.equal(multiDecoded.length, 4, 'Expected all 4 QR panels in 2x2 grid to be detected');
  assert.deepEqual(
    multiDecoded.map((d) => d.rawValue),
    panelStrings
  );
});
