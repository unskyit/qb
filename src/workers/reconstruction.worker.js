/**
 * QuadBeam LT Fountain Reconstruction Web Worker
 * Offloads LT peeling and GF(2) Gaussian elimination for 256-block generations.
 */

import { GenerationFountainDecoder } from '../protocol/fountain-decoder.js';

const activeDecoders = new Map();

globalThis.onmessage = (event) => {
  const { id, action, generationId, K, blockSize, lastBlockActualSize, localIndex, degree, seed, payload } =
    event.data || {};

  try {
    if (action === 'INIT_GEN') {
      activeDecoders.set(
        generationId,
        new GenerationFountainDecoder(generationId, K, blockSize, lastBlockActualSize)
      );
      globalThis.postMessage({ id, ok: true, generationId });
      return;
    }

    const decoder = activeDecoders.get(generationId);
    if (!decoder) {
      globalThis.postMessage({ id, ok: false, error: `Generation ${generationId} not initialized` });
      return;
    }

    let newlyResolved = 0;
    if (action === 'ADD_SOURCE') {
      newlyResolved = decoder.addSourceBlock(localIndex, new Uint8Array(payload));
    } else if (action === 'ADD_DROPLET') {
      newlyResolved = decoder.addFountainDroplet(degree, seed, new Uint8Array(payload));
    }

    const complete = decoder.isComplete();
    let exportedBlocks = null;
    if (complete) {
      exportedBlocks = decoder.exportBlocks();
      activeDecoders.delete(generationId);
    }

    globalThis.postMessage({
      id,
      ok: true,
      generationId,
      newlyResolved,
      resolvedCount: decoder.resolvedCount,
      complete,
      exportedBlocks
    });
  } catch (err) {
    globalThis.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
