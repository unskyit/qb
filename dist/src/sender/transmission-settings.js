/**
 * QuadBeam Adaptive Transmission Configuration & Calibration Planner
 * Computes safe QR panel counts, module pixel sizes, and payload densities
 * based on actual viewport dimensions and measured receiver capabilities.
 */

import { TRANSMISSION_PROFILES, DENSITY_BLOCK_SIZES, PACKET_TYPE } from '../protocol/constants.js';
import { serializePacket } from '../protocol/packet-format.js';

/**
 * Determine optimal QR count (1, 2, or 4), safe canvas pixel size, and block size
 * so that every rendered QR module is at least `minModulePx` CSS pixels wide.
 */
export function computeSafeQrLayout({
  viewportWidth,
  viewportHeight,
  requestedQrCount = 4,
  requestedBlockSize = 220,
  ecLevel = 'M',
  isFullscreen = false
}) {
  const chromeHeight = isFullscreen ? 88 : 180;
  const chromeWidth = isFullscreen ? 24 : 48;
  const availW = Math.max(220, viewportWidth - chromeWidth);
  const availH = Math.max(220, viewportHeight - chromeHeight);

  // Estimate QR module count for requestedBlockSize in Base45 Alphanumeric Mode:
  // ~1.5 chars per byte -> version ~ 10..15 -> moduleCount ~ 57..77 (+ 8 quiet zone = 65..85)
  const estModules = requestedBlockSize <= 150 ? 61 : requestedBlockSize <= 240 ? 73 : 89;
  const minSafeModulePx = 3; // At least 3 CSS pixels per module for reliable camera capture
  const minPanelSizePx = estModules * minSafeModulePx;

  let effectiveQrCount = requestedQrCount;
  let effectiveBlockSize = requestedBlockSize;
  let panelSizePx = 280;
  let gridColumns = 2;
  let gridRows = 2;
  let autoReducedReason = null;

  if (effectiveQrCount === 4) {
    const gap = 14;
    const maxQuadPanel = Math.floor(Math.min((availW - gap) / 2, (availH - gap) / 2));
    if (maxQuadPanel >= minPanelSizePx) {
      panelSizePx = Math.min(440, maxQuadPanel);
      gridColumns = 2;
      gridRows = 2;
    } else if (maxQuadPanel >= 57 * minSafeModulePx) {
      // Keep 4 panels but reduce density to 140B so modules stay large enough
      panelSizePx = maxQuadPanel;
      effectiveBlockSize = Math.min(effectiveBlockSize, 140);
      autoReducedReason = 'Reduced QR payload density so all 4 panels remain clearly scannable on this screen.';
    } else {
      // Automatically step down to 2 or 1 panels
      effectiveQrCount = 2;
      autoReducedReason = 'Switched from 4 QR panels to fewer panels to preserve scannable module size on a compact viewport.';
    }
  }

  if (effectiveQrCount === 2) {
    const gap = 16;
    const isLandscape = availW >= availH;
    const maxDualPanel = isLandscape
      ? Math.floor(Math.min((availW - gap) / 2, availH))
      : Math.floor(Math.min(availW, (availH - gap) / 2));

    if (maxDualPanel >= 57 * minSafeModulePx) {
      panelSizePx = Math.min(480, maxDualPanel);
      gridColumns = isLandscape ? 2 : 1;
      gridRows = isLandscape ? 1 : 2;
    } else {
      effectiveQrCount = 1;
      autoReducedReason = 'Switched to 1 fullscreen QR panel for maximum scan reliability on a narrow screen.';
    }
  }

  if (effectiveQrCount === 1) {
    panelSizePx = Math.min(560, Math.floor(Math.min(availW, availH)));
    gridColumns = 1;
    gridRows = 1;
  }

  const landscapeRecommended = viewportWidth < viewportHeight && requestedQrCount >= 2;

  return {
    qrCount: effectiveQrCount,
    blockSize: effectiveBlockSize,
    ecLevel,
    panelSizePx: Math.max(180, panelSizePx),
    gridColumns,
    gridRows,
    autoReducedReason,
    landscapeRecommended
  };
}

export function resolveTransmissionSettings(preferences, viewportWidth = 1024, viewportHeight = 768, isFullscreen = false) {
  const profilePreset = TRANSMISSION_PROFILES[preferences.profile] || TRANSMISSION_PROFILES.balanced;

  const requestedQrCount =
    preferences.profile === 'custom' ? preferences.qrCount : profilePreset.qrCount;
  const requestedFps =
    preferences.profile === 'custom' ? preferences.fps : profilePreset.fps;
  const requestedBlockSize =
    preferences.profile === 'custom'
      ? (DENSITY_BLOCK_SIZES[preferences.qrDensity] || 220)
      : profilePreset.blockSize;
  const ecLevel =
    preferences.profile === 'custom' ? preferences.ecLevel : profilePreset.ecLevel;
  const redundancyPercent =
    preferences.profile === 'custom'
      ? preferences.redundancyPercent
      : profilePreset.redundancyPercent;

  if (!preferences.autoMode) {
    const gap = 14;
    const availW = Math.max(220, viewportWidth - (isFullscreen ? 24 : 48));
    const availH = Math.max(220, viewportHeight - (isFullscreen ? 88 : 180));
    let panelSizePx = Math.min(availW, availH);
    if (requestedQrCount === 4) {
      panelSizePx = Math.floor(Math.min((availW - gap) / 2, (availH - gap) / 2));
    } else if (requestedQrCount === 2) {
      panelSizePx = availW >= availH
        ? Math.floor(Math.min((availW - gap) / 2, availH))
        : Math.floor(Math.min(availW, (availH - gap) / 2));
    }
    return {
      qrCount: requestedQrCount,
      fps: requestedFps,
      blockSize: requestedBlockSize,
      ecLevel,
      redundancyPercent,
      panelSizePx: Math.max(150, Math.min(540, panelSizePx)),
      gridColumns: requestedQrCount === 1 ? 1 : requestedQrCount === 2 && availW < availH ? 1 : 2,
      gridRows: requestedQrCount === 4 ? 2 : requestedQrCount === 2 && availW < availH ? 2 : 1,
      autoReducedReason: null,
      landscapeRecommended: viewportWidth < viewportHeight && requestedQrCount >= 2
    };
  }

  const layout = computeSafeQrLayout({
    viewportWidth,
    viewportHeight,
    requestedQrCount,
    requestedBlockSize,
    ecLevel,
    isFullscreen
  });

  return {
    ...layout,
    fps: requestedFps,
    redundancyPercent
  };
}

/**
 * Generate a Calibration Probe Packet for link testing before large transfers.
 */
export function buildCalibrationProbePacket({
  sessionId,
  sequenceId,
  panelId = 0,
  probeBlockSize = 220,
  targetFps = 15,
  qrCount = 4
}) {
  const payload = new Uint8Array(Math.max(16, probeBlockSize));
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, probeBlockSize, false);
  dv.setUint8(2, targetFps);
  dv.setUint8(3, qrCount);
  dv.setUint32(4, sequenceId >>> 0, false);
  // Deterministic test pattern across remaining bytes
  for (let i = 8; i < payload.length; i++) {
    payload[i] = ((i * 37) ^ sequenceId ^ (panelId * 19)) & 0xff;
  }

  return serializePacket({
    packetType: PACKET_TYPE.CALIBRATION,
    panelId,
    sessionId,
    fileId: 0x43414c42, // 'CALB'
    generationId: 0,
    sequenceId,
    blockIndexOrSeed: (targetFps << 16) | (qrCount << 8) | (probeBlockSize & 0xff),
    payload
  });
}
