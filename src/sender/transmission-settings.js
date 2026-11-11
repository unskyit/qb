/**
 * QuadBeam Adaptive Transmission Configuration & Strict Square Grid Planner
 * Supports 1, 2, 4, and 6 QR codes with strict 1:1 square panel sizing that fits
 * inside a single non-scrolling viewport even on small (< 250 DPI) mobile screens.
 */

import { TRANSMISSION_PROFILES, DENSITY_BLOCK_SIZES, PACKET_TYPE } from '../protocol/constants.js';
import { serializePacket } from '../protocol/packet-format.js';

/**
 * Compute grid columns and rows for 1, 2, 4, or 6 QR codes given available width/height.
 */
export function getGridDimensionsForCount(qrCount, isLandscape = true) {
  if (qrCount === 1) return { cols: 1, rows: 1 };
  if (qrCount === 2) return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (qrCount === 6) return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  return { cols: 2, rows: 2 }; // Default 4 QR (2x2)
}

/**
 * Compute safe QR layout parameters.
 * - When `autoMode === true` (used for automatic viewport step-down), steps down panel count
 *   on tiny screens if requestedBlockSize is high.
 * - When `autoMode === false` (default user-selected mode), keeps the exact requested QR count
 *   (1, 2, 4, or 6) and computes the exact 1:1 square pixel size that fits inside the stage
 *   with zero page scrolling and low-DPI friendly module density.
 */
export function computeSafeQrLayout({
  viewportWidth = 1024,
  viewportHeight = 768,
  stageWidth = 0,
  stageHeight = 0,
  requestedQrCount = 4,
  requestedBlockSize = 160,
  ecLevel = 'M',
  isFullscreen = false,
  strictHonorCount = false
}) {
  // Reserve compact space for header + top toolbar + bottom telemetry so the entire app fits in 100dvh with no scroll
  const reservedVertical = isFullscreen ? 76 : 165;
  const reservedHorizontal = isFullscreen ? 20 : 28;

  const availW = stageWidth > 80 ? stageWidth - 16 : Math.max(200, viewportWidth - reservedHorizontal);
  const availH = stageHeight > 80 ? stageHeight - 16 : Math.max(180, viewportHeight - reservedVertical);
  const isLandscape = availW >= availH * 1.05;

  let effectiveQrCount = [1, 2, 4, 6].includes(Number(requestedQrCount)) ? Number(requestedQrCount) : 4;
  let effectiveBlockSize = requestedBlockSize;
  let autoReducedReason = null;

  if (!strictHonorCount) {
    const minDim = Math.min(availW, availH);
    if (minDim < 260 && effectiveQrCount > 2) {
      effectiveQrCount = 2;
      autoReducedReason = 'Adjusted to 2 QR panels for compact viewport.';
    }
  }

  // On small / low-DPI screens, keep block size compact (100B - 140B) so each QR has fewer, larger square modules
  const { cols, rows } = getGridDimensionsForCount(effectiveQrCount, isLandscape);
  const gap = Math.min(availW, availH) < 420 ? 6 : 10;
  const padPerPanel = Math.min(availW, availH) < 420 ? 8 : 12;

  const maxSquareW = Math.floor((availW - gap * (cols - 1)) / cols) - padPerPanel;
  const maxSquareH = Math.floor((availH - gap * (rows - 1)) / rows) - padPerPanel;
  const panelSizePx = Math.max(68, Math.min(340, Math.min(maxSquareW, maxSquareH)));

  if (panelSizePx < 125) {
    effectiveBlockSize = Math.min(effectiveBlockSize, 100);
  } else if (panelSizePx < 165) {
    effectiveBlockSize = Math.min(effectiveBlockSize, 140);
  }

  const landscapeRecommended = viewportWidth < viewportHeight && effectiveQrCount >= 2;

  return {
    qrCount: effectiveQrCount,
    blockSize: effectiveBlockSize,
    ecLevel,
    panelSizePx,
    gridColumns: cols,
    gridRows: rows,
    gapPx: gap,
    autoReducedReason,
    landscapeRecommended
  };
}

export function resolveTransmissionSettings(
  preferences,
  viewportWidth = 1024,
  viewportHeight = 768,
  isFullscreen = false,
  stageWidth = 0,
  stageHeight = 0
) {
  const profilePreset = TRANSMISSION_PROFILES[preferences.profile] || TRANSMISSION_PROFILES.balanced;

  const requestedQrCount =
    preferences.profile === 'custom' || preferences.qrCount
      ? Number(preferences.qrCount || profilePreset.qrCount)
      : profilePreset.qrCount;
  const requestedFps =
    preferences.profile === 'custom' ? preferences.fps : profilePreset.fps;
  const requestedBlockSize =
    preferences.profile === 'custom'
      ? (DENSITY_BLOCK_SIZES[preferences.qrDensity] || 160)
      : profilePreset.blockSize;
  const ecLevel =
    preferences.profile === 'custom' ? preferences.ecLevel : profilePreset.ecLevel;
  const redundancyPercent =
    preferences.profile === 'custom'
      ? preferences.redundancyPercent
      : profilePreset.redundancyPercent;

  const layout = computeSafeQrLayout({
    viewportWidth,
    viewportHeight,
    stageWidth,
    stageHeight,
    requestedQrCount,
    requestedBlockSize,
    ecLevel,
    isFullscreen,
    strictHonorCount: !preferences.autoMode
  });

  return {
    ...layout,
    fps: requestedFps,
    redundancyPercent
  };
}

export function buildCalibrationProbePacket({
  sessionId,
  sequenceId,
  panelId = 0,
  probeBlockSize = 140,
  targetFps = 15,
  qrCount = 4
}) {
  const payload = new Uint8Array(Math.max(16, probeBlockSize));
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, probeBlockSize, false);
  dv.setUint8(2, targetFps);
  dv.setUint8(3, qrCount);
  dv.setUint32(4, sequenceId >>> 0, false);
  for (let i = 8; i < payload.length; i++) {
    payload[i] = ((i * 37) ^ sequenceId ^ (panelId * 19)) & 0xff;
  }

  return serializePacket({
    packetType: PACKET_TYPE.CALIBRATION,
    panelId,
    sessionId,
    fileId: 0x43414c42,
    generationId: 0,
    sequenceId,
    blockIndexOrSeed: (targetFps << 16) | (qrCount << 8) | (probeBlockSize & 0xff),
    payload
  });
}
