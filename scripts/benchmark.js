#!/usr/bin/env node
/**
 * QuadBeam Optical Engine Performance Benchmark Suite
 *
 * Measures real, empirical performance across:
 * 1. Wire Encoding Overhead (RFC 9285 Base45 in QR Alphanumeric vs Raw Byte vs Base64)
 * 2. ISO/IEC 18004 QR Matrix Generation & RGBA Render Latency across EC Levels (L, M, Q, H)
 * 3. 1-QR, 2-QR, and 4-QR Computer Vision Detection + Reed-Solomon Decoding Latency
 * 4. LT Fountain Code Reconstruction Speed & Overhead under 0%, 10%, and 25% Packet Loss
 * 5. Streaming FIPS 180-4 SHA-256 Throughput on 50 MiB Data
 */

import { encodeBase45 } from '../src/protocol/encoding.js';
import { serializePacket } from '../src/protocol/packet-format.js';
import { encodeQrMatrix, renderQrToImageData } from '../src/sender/qr-generator.js';
import { detectMultiQrFromImageData } from '../src/receiver/qr-detector.js';
import { GenerationFountainEncoder } from '../src/protocol/fountain-encoder.js';
import { GenerationFountainDecoder } from '../src/protocol/fountain-decoder.js';
import { IncrementalSha256 } from '../src/protocol/integrity.js';

function makeCompositeGridImage(qrImages, layoutCount) {
  const pSize = qrImages[0].width;
  const gap = 12;
  const cols = layoutCount === 1 ? 1 : 2;
  const rows = layoutCount === 4 ? 2 : 1;
  const W = cols * pSize + (cols + 1) * gap;
  const H = rows * pSize + (rows + 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4);
  data.fill(255);

  for (let idx = 0; idx < layoutCount; idx++) {
    const img = qrImages[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = gap + col * (pSize + gap);
    const oy = gap + row * (pSize + gap);
    for (let y = 0; y < pSize; y++) {
      const srcOff = y * pSize * 4;
      const dstOff = ((oy + y) * W + ox) * 4;
      data.set(img.data.subarray(srcOff, srcOff + pSize * 4), dstOff);
    }
  }
  return { width: W, height: H, data };
}

console.log('===================================================================');
console.log('  QUADBEAM OPTICAL ENGINE — EMPIRICAL PERFORMANCE BENCHMARK');
console.log('===================================================================\n');

// 1. Wire Encoding Comparison (220 B payload + 28 B framing = 248 B packet)
const samplePayload = new Uint8Array(220);
for (let i = 0; i < 220; i++) samplePayload[i] = (i * 97 + 13) & 0xff;
const samplePacket = serializePacket({
  packetType: 2,
  panelId: 0,
  sessionId: 0x11223344,
  fileId: 0x55667788,
  generationId: 0,
  sequenceId: 1,
  blockIndexOrSeed: 0,
  payload: samplePayload
});

const b45Str = encodeBase45(samplePacket);
const b64Str = Buffer.from(samplePacket).toString('base64');
const qrB45 = encodeQrMatrix(b45Str, { ecLevel: 'M' });
const qrByte = encodeQrMatrix(samplePacket, { ecLevel: 'M' });
const qrB64 = encodeQrMatrix(b64Str, { ecLevel: 'M' });

console.log('1. Wire Encoding & QR Version Comparison (248-Byte Framed Packet, EC Level M):');
console.table([
  {
    Encoding: 'RFC 9285 Base45 (QR Alphanumeric)',
    CharsOrBytes: b45Str.length,
    QRBitLength: Math.floor(b45Str.length / 2) * 11 + (b45Str.length % 2 ? 6 : 0),
    QRVersion: qrB45.version,
    ModuleGrid: `${qrB45.moduleCount}x${qrB45.moduleCount}`
  },
  {
    Encoding: 'Direct Binary (QR 8-Bit Byte)',
    CharsOrBytes: samplePacket.length,
    QRBitLength: samplePacket.length * 8,
    QRVersion: qrByte.version,
    ModuleGrid: `${qrByte.moduleCount}x${qrByte.moduleCount}`
  },
  {
    Encoding: 'Standard Base64 (QR 8-Bit Byte)',
    CharsOrBytes: b64Str.length,
    QRBitLength: b64Str.length * 8,
    QRVersion: qrB64.version,
    ModuleGrid: `${qrB64.moduleCount}x${qrB64.moduleCount}`
  }
]);

// 2. QR Generation & Render Benchmarks across EC Levels
console.log('\n2. QR Matrix Encode & Render Latency (220 B Payload, 50 Iterations):');
const ecResults = [];
for (const ecLevel of ['L', 'M', 'Q', 'H']) {
  const t0 = performance.now();
  let mat;
  for (let i = 0; i < 50; i++) {
    mat = encodeQrMatrix(b45Str, { ecLevel });
  }
  const encodeMs = (performance.now() - t0) / 50;

  const t1 = performance.now();
  for (let i = 0; i < 50; i++) {
    renderQrToImageData(mat, { modulePx: 4, quietZone: 4 });
  }
  const renderMs = (performance.now() - t1) / 50;

  ecResults.push({
    ECLevel: ecLevel,
    QRVersion: mat.version,
    GridSize: `${mat.moduleCount}x${mat.moduleCount}`,
    AvgEncodeMs: Number(encodeMs.toFixed(3)),
    AvgRenderMs: Number(renderMs.toFixed(3)),
    MaxTheoreticalFps4Panels: Math.round(1000 / ((encodeMs + renderMs) * 4))
  });
}
console.table(ecResults);

// 3. Multi-QR Computer Vision Detection & Decoding Benchmark (1, 2, and 4 QR Layouts)
console.log('\n3. Multi-QR Detection & Reed-Solomon Decode Latency (1, 2, and 4 Panels):');
const layoutResults = [];
for (const panelCount of [1, 2, 4]) {
  const panelImages = [];
  for (let p = 0; p < panelCount; p++) {
    const pkt = serializePacket({
      packetType: 2,
      panelId: p,
      sessionId: 0x11223344,
      fileId: 0x55667788,
      generationId: 0,
      sequenceId: p + 1,
      blockIndexOrSeed: p,
      payload: samplePayload
    });
    const mat = encodeQrMatrix(encodeBase45(pkt), { ecLevel: 'M' });
    panelImages.push(renderQrToImageData(mat, { modulePx: 4, quietZone: 4 }));
  }

  const composite = makeCompositeGridImage(panelImages, panelCount);
  const runs = 10;
  const t0 = performance.now();
  let decodedCount = 0;
  for (let r = 0; r < runs; r++) {
    const res = detectMultiQrFromImageData(composite, panelCount);
    decodedCount += res.length;
  }
  const avgDecodeMs = (performance.now() - t0) / runs;
  const avgPanelsDecoded = decodedCount / runs;
  const effectiveFps = Math.min(20, 1000 / avgDecodeMs);
  const usefulThroughputKBps = (effectiveFps * avgPanelsDecoded * 220) / 1024;

  layoutResults.push({
    Layout: `${panelCount} QR Panel(s)`,
    FrameResolution: `${composite.width}x${composite.height}`,
    PanelsDecodedPerFrame: `${avgPanelsDecoded}/${panelCount}`,
    AvgFrameDecodeMs: Number(avgDecodeMs.toFixed(2)),
    MeasuredThroughputAt15FpsKBps: Number(((15 * avgPanelsDecoded * 220) / 1024).toFixed(1)),
    PeakCpuBoundThroughputKBps: Number(usefulThroughputKBps.toFixed(1))
  });
}
console.table(layoutResults);

// 4. LT Fountain Code Reconstruction Overhead under Loss
console.log('\n4. Hybrid LT Peeling + GF(2) Fountain Reconstruction (K=128 Blocks, 220 B/block):');
const K = 128;
const srcBlocks = Array.from({ length: K }, (_, idx) => {
  const b = new Uint8Array(220);
  for (let j = 0; j < 220; j++) b[j] = (idx * 31 + j * 17) & 0xff;
  return b;
});

const fountainResults = [];
for (const lossRate of [0.0, 0.1, 0.25]) {
  const enc = new GenerationFountainEncoder(0, srcBlocks, 220);
  const dec = new GenerationFountainDecoder(0, K, 220, 220);
  const t0 = performance.now();
  let sent = 0;
  let received = 0;

  while (!dec.isComplete() && sent < K * 5) {
    const isSystematic = sent < K;
    const stepIdx = sent++;
    // Deterministic loss pattern matching lossRate
    if (((stepIdx * 97) % 100) < lossRate * 100) {
      continue;
    }
    received++;
    if (isSystematic) {
      dec.addSourceBlock(stepIdx, srcBlocks[stepIdx]);
    } else {
      const droplet = enc.nextDroplet();
      dec.addFountainDroplet(droplet.degree, droplet.seed24, droplet.payload);
    }
  }
  const reconMs = performance.now() - t0;
  const receptionOverheadPct = (((received - K) / K) * 100).toFixed(1);

  fountainResults.push({
    SimulatedLoss: `${Math.round(lossRate * 100)}%`,
    SourceBlocksK: K,
    PacketsSent: sent,
    PacketsReceivedToSolve: received,
    ReceptionOverhead: `${receptionOverheadPct}%`,
    ReconstructionTimeMs: Number(reconMs.toFixed(2))
  });
}
console.table(fountainResults);

// 5. Streaming SHA-256 50 MiB Verification Speed
const tHash0 = performance.now();
const hasher = new IncrementalSha256();
const oneMiB = new Uint8Array(1024 * 1024);
for (let i = 0; i < oneMiB.length; i++) oneMiB[i] = i & 0xff;
for (let m = 0; m < 50; m++) {
  hasher.update(oneMiB);
}
const digestHex = hasher.digestHex();
const hashElapsedMs = performance.now() - tHash0;
console.log(
  `\n5. Streaming 50 MiB SHA-256 Digest Time: ${hashElapsedMs.toFixed(1)} ms (${(
    50 /
    (hashElapsedMs / 1000)
  ).toFixed(1)} MiB/s) -> ${digestHex.slice(0, 24)}...`
);
