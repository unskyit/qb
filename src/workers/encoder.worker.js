/**
 * QuadBeam Optical QR Encoder Web Worker
 * Offloads Base45 wire encoding and ISO/IEC 18004 QR matrix computation from the UI thread.
 */

import { encodePacketWire } from '../protocol/encoding.js';
import { encodeQrMatrix } from '../sender/qr-generator.js';

globalThis.onmessage = (event) => {
  const { id, type, packets, ecLevel = 'M', wireEncoding = 'base45' } = event.data || {};
  if (type !== 'ENCODE_FRAME' || !Array.isArray(packets)) return;

  try {
    const t0 = performance.now();
    const matrices = packets.map((pktBytes) => {
      const wire = encodePacketWire(new Uint8Array(pktBytes), wireEncoding);
      return encodeQrMatrix(wire.data, { ecLevel });
    });
    const durationMs = performance.now() - t0;
    globalThis.postMessage({ id, ok: true, matrices, durationMs });
  } catch (err) {
    globalThis.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
