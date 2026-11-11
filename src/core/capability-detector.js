/**
 * QuadBeam Browser & Hardware Capability Detector
 * Inspects real runtime capabilities without fabricating unsupported features.
 */

export async function detectCapabilities() {
  const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

  const capabilities = {
    secureContext: Boolean(globalThis.isSecureContext),
    mediaDevices: Boolean(isBrowser && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    enumerateDevices: Boolean(isBrowser && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
    barcodeDetector: false,
    barcodeFormats: [],
    webWorkers: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    requestVideoFrameCallback: Boolean(
      isBrowser &&
      typeof HTMLVideoElement !== 'undefined' &&
      'requestVideoFrameCallback' in HTMLVideoElement.prototype
    ),
    webCrypto: Boolean(globalThis.crypto && globalThis.crypto.subtle),
    opfs: Boolean(isBrowser && navigator.storage && typeof navigator.storage.getDirectory === 'function'),
    fileSystemAccess: Boolean(isBrowser && typeof window.showSaveFilePicker === 'function'),
    webShare: Boolean(isBrowser && typeof navigator.share === 'function'),
    wakeLock: Boolean(isBrowser && 'wakeLock' in navigator),
    serviceWorker: Boolean(isBrowser && 'serviceWorker' in navigator),
    storageQuotaBytes: null,
    storageUsageBytes: null,
    deviceMemoryGB: isBrowser && 'deviceMemory' in navigator ? navigator.deviceMemory : null,
    hardwareConcurrency: isBrowser && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
    isMobileViewport: isBrowser ? window.innerWidth < 768 : false,
    prefersReducedMotion: isBrowser && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  };

  if (typeof globalThis.BarcodeDetector !== 'undefined') {
    try {
      const formats = await globalThis.BarcodeDetector.getSupportedFormats();
      capabilities.barcodeFormats = Array.isArray(formats) ? formats : [];
      capabilities.barcodeDetector = capabilities.barcodeFormats.includes('qr_code');
    } catch {
      capabilities.barcodeDetector = false;
    }
  }

  if (isBrowser && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      capabilities.storageQuotaBytes = estimate.quota ?? null;
      capabilities.storageUsageBytes = estimate.usage ?? null;
    } catch {
      // Storage estimate unavailable in private browsing or restricted iframe
    }
  }

  return capabilities;
}

export function recommendDefaultSettings(capabilities, viewportWidth = 1024, viewportHeight = 768) {
  const minDim = Math.min(viewportWidth, viewportHeight);
  const isSmallScreen = minDim < 420;
  const isMediumScreen = minDim >= 420 && minDim < 720;

  let qrCount = 4;
  if (isSmallScreen) {
    qrCount = 1;
  } else if (isMediumScreen) {
    qrCount = 2;
  }

  // Conservative default FPS that balances real camera exposure and decode reliability
  const fps = isSmallScreen ? 10 : 15;
  const blockSize = isSmallScreen ? 180 : 240;

  return {
    profile: 'balanced',
    qrCount,
    fps,
    blockSize,
    ecLevel: 'M',
    fountainParityRatio: 0.35
  };
}
