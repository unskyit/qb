/**
 * QuadBeam Streaming Cryptographic Integrity Web Worker
 * Computes incremental SHA-256 digests over 50 MiB streams off the main UI thread.
 */

import { IncrementalSha256, bytesToHex } from '../protocol/integrity.js';

const hashers = new Map();

globalThis.onmessage = (event) => {
  const { id, streamId = 'default', action, chunk } = event.data || {};

  try {
    if (action === 'INIT') {
      hashers.set(streamId, new IncrementalSha256());
      globalThis.postMessage({ id, ok: true });
      return;
    }
    if (action === 'UPDATE') {
      let hasher = hashers.get(streamId);
      if (!hasher) {
        hasher = new IncrementalSha256();
        hashers.set(streamId, hasher);
      }
      hasher.update(new Uint8Array(chunk));
      globalThis.postMessage({ id, ok: true, bytesProcessed: hasher.bytesProcessed });
      return;
    }
    if (action === 'FINALIZE') {
      const hasher = hashers.get(streamId);
      if (!hasher) throw new Error(`No active hasher for streamId ${streamId}`);
      const digest = hasher.digest();
      hashers.delete(streamId);
      globalThis.postMessage({
        id,
        ok: true,
        digest,
        digestHex: bytesToHex(digest)
      });
    }
  } catch (err) {
    globalThis.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
