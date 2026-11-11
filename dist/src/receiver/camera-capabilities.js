/**
 * QuadBeam Camera Hardware Capabilities Inspector
 * Inspects actual MediaStreamTrack capabilities and settings before exposing UI controls
 * (Torch, Zoom, Focus Mode, Exposure Compensation, Resolution, Frame Rate).
 * Never fabricates unsupported hardware controls.
 */

export function inspectTrackCapabilities(videoTrack) {
  if (!videoTrack || typeof videoTrack.getCapabilities !== 'function') {
    return {
      supported: false,
      torch: false,
      zoom: null,
      focusModes: [],
      exposureCompensation: null,
      width: null,
      height: null,
      frameRate: null,
      facingMode: null,
      currentSettings: {}
    };
  }

  let rawCaps = {};
  let settings = {};
  try {
    rawCaps = videoTrack.getCapabilities() || {};
  } catch {
    rawCaps = {};
  }
  try {
    settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() || {} : {};
  } catch {
    settings = {};
  }

  const zoom =
    rawCaps.zoom && typeof rawCaps.zoom.min === 'number' && rawCaps.zoom.max > rawCaps.zoom.min
      ? {
          min: rawCaps.zoom.min,
          max: rawCaps.zoom.max,
          step: rawCaps.zoom.step || 0.1,
          current: settings.zoom ?? rawCaps.zoom.min
        }
      : null;

  const exposureCompensation =
    rawCaps.exposureCompensation &&
    typeof rawCaps.exposureCompensation.min === 'number' &&
    rawCaps.exposureCompensation.max > rawCaps.exposureCompensation.min
      ? {
          min: rawCaps.exposureCompensation.min,
          max: rawCaps.exposureCompensation.max,
          step: rawCaps.exposureCompensation.step || 0.25,
          current: settings.exposureCompensation ?? 0
        }
      : null;

  const focusModes = Array.isArray(rawCaps.focusMode) ? rawCaps.focusMode : [];

  return {
    supported: true,
    torch: Boolean(rawCaps.torch),
    torchActive: Boolean(settings.torch),
    zoom,
    focusModes,
    currentFocusMode: settings.focusMode || null,
    exposureCompensation,
    width: settings.width || null,
    height: settings.height || null,
    frameRate: settings.frameRate ? Math.round(settings.frameRate) : null,
    facingMode: settings.facingMode || null,
    deviceId: settings.deviceId || null,
    currentSettings: settings
  };
}

export async function applyTrackConstraint(videoTrack, constraintPatch) {
  if (!videoTrack || typeof videoTrack.applyConstraints !== 'function') {
    return false;
  }
  try {
    await videoTrack.applyConstraints({ advanced: [constraintPatch] });
    return true;
  } catch {
    try {
      await videoTrack.applyConstraints(constraintPatch);
      return true;
    } catch {
      return false;
    }
  }
}
