/**
 * QuadBeam Multi-QR Decoder Web Worker
 * Offloads adaptive binarization, finder pattern localization, perspective homography,
 * and GF(256) Reed-Solomon decoding from the main browser UI thread.
 */

import { detectMultiQrFromImageData } from '../receiver/qr-detector.js';

globalThis.onmessage = (event) => {
  const { id, type, width, height, rgbaBuffer, expectedCount = 4 } = event.data || {};
  if (type !== 'DECODE_FRAME' || !rgbaBuffer) return;

  try {
    const t0 = performance.now();
    const imageData = {
      width,
      height,
      data: new Uint8ClampedArray(rgbaBuffer)
    };
    const results = detectMultiQrFromImageData(imageData, expectedCount);
    const latencyMs = performance.now() - t0;
    globalThis.postMessage({ id, ok: true, results, latencyMs });
  } catch (err) {
    globalThis.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
