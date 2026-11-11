/**
 * QuadBeam Resource & ObjectURL Cleanup Manager
 * Prevents leaking temporary Object URLs and cleans up OPFS staging on session end.
 */

import { tempStorage } from './temporary-storage.js';

const activeObjectUrls = new Set();

export function registerObjectUrl(url) {
  if (!url) return;
  activeObjectUrls.add(url);
  // Automatically revoke after 60 seconds to prevent memory leaks
  setTimeout(() => {
    revokeObjectUrl(url);
  }, 60000);
}

export function revokeObjectUrl(url) {
  if (!url || !activeObjectUrls.has(url)) return;
  activeObjectUrls.delete(url);
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke errors
    }
  }
}

export function revokeAllObjectUrls() {
  for (const url of Array.from(activeObjectUrls)) {
    revokeObjectUrl(url);
  }
}

export async function performFullCleanup() {
  revokeAllObjectUrls();
  await tempStorage.clearAll();
}
