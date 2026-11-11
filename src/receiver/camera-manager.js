/**
 * QuadBeam Receiver Camera Discovery, Permission & Lifecycle Manager
 *
 * Supports:
 * - Permission request only after explicit user interaction
 * - Discovery via navigator.mediaDevices.enumerateDevices() with post-permission label refresh
 * - Seamless switching (Next, Previous, Front/Rear toggle, Direct Device ID selector)
 *   while preserving all received packets and reconstruction progress
 * - Hardware controls (Torch, Zoom, Focus Mode, Exposure Compensation) when supported
 */

import { inspectTrackCapabilities, applyTrackConstraint } from './camera-capabilities.js';
import { describeCameraError } from '../core/errors.js';
import { appEvents } from '../core/events.js';

const RESOLUTION_PRESETS = Object.freeze({
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  '4k': { width: { ideal: 3840 }, height: { ideal: 2160 } }
});

export class CameraManager {
  constructor() {
    this.videoEl = null;
    this.stream = null;
    this.videoTrack = null;
    this.devices = [];
    this.activeDeviceId = null;
    this.activeFacingMode = 'environment';
    this.activeResolution = '1080p';
    this.capabilities = inspectTrackCapabilities(null);
    this.isActive = false;
  }

  attachVideoElement(videoEl) {
    this.videoEl = videoEl;
  }

  /**
   * Enumerate all available videoinput devices.
   */
  async enumerateCameras() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      this.devices = [];
      return this.devices;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          groupId: d.groupId,
          label: d.label || `Camera ${idx + 1}`
        }));
      appEvents.emit('camera:devices-updated', this.devices);
      return this.devices;
    } catch {
      this.devices = [];
      return this.devices;
    }
  }

  /**
   * Start camera stream with selected deviceId or facingMode.
   */
  async startCamera({
    deviceId = null,
    facingMode = this.activeFacingMode,
    resolution = this.activeResolution
  } = {}) {
    this.stopCamera();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw describeCameraError({ name: 'NotFoundError', message: 'MediaDevices API is not supported in this browser.' });
    }

    this.activeResolution = resolution || '1080p';
    const resConstraint = RESOLUTION_PRESETS[this.activeResolution] || RESOLUTION_PRESETS['1080p'];

    const videoConstraints = {
      ...resConstraint,
      frameRate: { ideal: 30, max: 60 }
    };

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else if (facingMode) {
      videoConstraints.facingMode = { ideal: facingMode };
      this.activeFacingMode = facingMode;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints
      });
    } catch (firstErr) {
      // Fallback with relaxed resolution constraints if ideal resolution was rejected
      try {
        const fallbackVideo = deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: facingMode || 'environment' } };
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: fallbackVideo
        });
      } catch (err) {
        throw describeCameraError(err || firstErr);
      }
    }

    const tracks = this.stream.getVideoTracks();
    this.videoTrack = tracks[0] || null;

    if (this.videoTrack) {
      // Listen for unexpected camera disconnection
      this.videoTrack.onended = () => {
        this.isActive = false;
        appEvents.emit('camera:disconnected', {
          reason: 'Camera track ended unexpectedly.'
        });
      };

      // Request continuous focus if supported for sharp QR capture
      const caps = inspectTrackCapabilities(this.videoTrack);
      if (caps.focusModes.includes('continuous')) {
        await applyTrackConstraint(this.videoTrack, { focusMode: 'continuous' });
      }
      this.capabilities = inspectTrackCapabilities(this.videoTrack);
      this.activeDeviceId = this.capabilities.deviceId || deviceId;
    }

    // Refresh device labels now that permission is granted
    await this.enumerateCameras();

    if (this.videoEl) {
      this.videoEl.srcObject = this.stream;
      this.videoEl.setAttribute('playsinline', 'true');
      this.videoEl.muted = true;
      await this.videoEl.play();
    }

    this.isActive = true;
    appEvents.emit('camera:started', {
      deviceId: this.activeDeviceId,
      capabilities: this.capabilities,
      devices: this.devices
    });

    return {
      capabilities: this.capabilities,
      devices: this.devices
    };
  }

  /**
   * Switch to a specific camera deviceId without discarding any received packets.
   */
  async switchCamera(deviceId) {
    return this.startCamera({
      deviceId,
      resolution: this.activeResolution
    });
  }

  /**
   * Cycle to the next available camera.
   */
  async nextCamera() {
    if (this.devices.length <= 1) {
      return this.toggleFacingMode();
    }
    const curIdx = this.devices.findIndex((d) => d.deviceId === this.activeDeviceId);
    const nextIdx = (curIdx + 1) % this.devices.length;
    return this.switchCamera(this.devices[nextIdx].deviceId);
  }

  /**
   * Cycle to the previous available camera.
   */
  async previousCamera() {
    if (this.devices.length <= 1) {
      return this.toggleFacingMode();
    }
    const curIdx = this.devices.findIndex((d) => d.deviceId === this.activeDeviceId);
    const prevIdx = (curIdx - 1 + this.devices.length) % this.devices.length;
    return this.switchCamera(this.devices[prevIdx].deviceId);
  }

  /**
   * Quick toggle between Front ('user') and Rear ('environment') cameras.
   */
  async toggleFacingMode() {
    const nextMode = this.activeFacingMode === 'environment' ? 'user' : 'environment';
    this.activeFacingMode = nextMode;
    return this.startCamera({
      deviceId: null,
      facingMode: nextMode,
      resolution: this.activeResolution
    });
  }

  async setTorch(enabled) {
    if (!this.videoTrack || !this.capabilities.torch) return false;
    const ok = await applyTrackConstraint(this.videoTrack, { torch: Boolean(enabled) });
    this.capabilities = inspectTrackCapabilities(this.videoTrack);
    return ok;
  }

  async setZoom(zoomValue) {
    if (!this.videoTrack || !this.capabilities.zoom) return false;
    const clamped = Math.max(
      this.capabilities.zoom.min,
      Math.min(this.capabilities.zoom.max, Number(zoomValue))
    );
    const ok = await applyTrackConstraint(this.videoTrack, { zoom: clamped });
    this.capabilities = inspectTrackCapabilities(this.videoTrack);
    return ok;
  }

  async setExposureCompensation(evValue) {
    if (!this.videoTrack || !this.capabilities.exposureCompensation) return false;
    const clamped = Math.max(
      this.capabilities.exposureCompensation.min,
      Math.min(this.capabilities.exposureCompensation.max, Number(evValue))
    );
    const ok = await applyTrackConstraint(this.videoTrack, { exposureCompensation: clamped });
    this.capabilities = inspectTrackCapabilities(this.videoTrack);
    return ok;
  }

  stopCamera() {
    this.isActive = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.onended = null;
          track.stop();
        } catch {
          // Ignore stop errors
        }
      }
    }
    this.stream = null;
    this.videoTrack = null;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    appEvents.emit('camera:stopped', {});
  }
}
