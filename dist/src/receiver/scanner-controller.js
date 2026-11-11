/**
 * QuadBeam Receiver Scanner Controller
 * Coordinates CameraManager, VideoFrameCapture, HybridQrDetector, PacketCollector,
 * FileReconstructor, and live Detection Guide Overlay rendering for 1, 2, 4, or 6 QR codes.
 */

import { CameraManager } from './camera-manager.js';
import { VideoFrameCapture } from './frame-capture.js';
import { HybridQrDetector } from './qr-detector.js';
import { PacketCollector } from './packet-collector.js';
import { FileReconstructor } from './file-reconstructor.js';
import { VerifiedFileWriter } from './file-writer.js';
import { FpsCounter } from '../utils/timing.js';
import { appState } from '../core/state.js';
import { appEvents } from '../core/events.js';

export class ScannerController {
  constructor() {
    this.cameraManager = new CameraManager();
    this.qrDetector = new HybridQrDetector({ engine: appState.preferences.decoderEngine });
    this.packetCollector = new PacketCollector();
    this.reconstructor = new FileReconstructor({
      maxAllowedFileSize: (appState.preferences.maxFileSizeMiB || 50) * 1024 * 1024,
      preferOpfs: appState.preferences.useOpfsStaging
    });
    this.fileWriter = new VerifiedFileWriter(this.reconstructor);
    this.frameCapture = new VideoFrameCapture((imgData, now) => this._processCapturedFrame(imgData, now));

    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.decodeFpsCounter = new FpsCounter(1000);
    this.totalFramesScanned = 0;
    this.framesWithValidQr = 0;
    this.startTimeMs = 0;
    this.isScanning = false;
    this.decryptionPassword = '';
  }

  attachElements({ videoEl, overlayCanvas }) {
    this.cameraManager.attachVideoElement(videoEl);
    this.frameCapture.attachVideo(videoEl);
    this.overlayCanvas = overlayCanvas;
    if (overlayCanvas) {
      this.overlayCtx = overlayCanvas.getContext('2d');
    }
  }

  async startReceiving({ deviceId = null, facingMode = null } = {}) {
    this.qrDetector = new HybridQrDetector({ engine: appState.preferences.decoderEngine });
    const camInfo = await this.cameraManager.startCamera({
      deviceId,
      facingMode: facingMode || appState.preferences.preferredFacingMode,
      resolution: appState.preferences.preferredResolution
    });

    if (this.startTimeMs === 0) {
      this.startTimeMs = performance.now();
    }
    this.isScanning = true;
    appState.setRuntime({ transferState: 'receiving' });
    this.frameCapture.start();

    appEvents.emit('receiver:started', {
      capabilities: camInfo.capabilities,
      devices: camInfo.devices,
      decoderName: this.qrDetector.getActiveEngineName()
    });

    return camInfo;
  }

  async switchCameraPreservingState(deviceId = null, direction = 'next') {
    const wasScanning = this.isScanning;
    this.frameCapture.stop();

    let camInfo;
    if (deviceId) {
      camInfo = await this.cameraManager.switchCamera(deviceId);
    } else if (direction === 'prev') {
      camInfo = await this.cameraManager.previousCamera();
    } else if (direction === 'facing') {
      camInfo = await this.cameraManager.toggleFacingMode();
    } else {
      camInfo = await this.cameraManager.nextCamera();
    }

    if (wasScanning) {
      this.frameCapture.start();
    }
    appEvents.emit('receiver:camera-switched', {
      capabilities: camInfo.capabilities,
      devices: camInfo.devices,
      preservedBlocks: this.reconstructor.totalResolvedBlocks
    });
    return camInfo;
  }

  pauseScanning() {
    this.isScanning = false;
    this.frameCapture.stop();
    appState.setRuntime({ transferState: 'paused' });
    appEvents.emit('receiver:paused', this.getReceiverStats());
  }

  resumeScanning() {
    if (!this.cameraManager.isActive) return;
    this.isScanning = true;
    appState.setRuntime({ transferState: 'receiving' });
    this.frameCapture.start();
    appEvents.emit('receiver:resumed', this.getReceiverStats());
  }

  stopReceiving(resetState = false) {
    this.isScanning = false;
    this.frameCapture.stop();
    this.cameraManager.stopCamera();
    this._clearOverlay();
    if (resetState) {
      this.resetSession();
    }
    appState.setRuntime({ transferState: 'idle' });
  }

  resetSession() {
    this.packetCollector.reset();
    this.reconstructor.reset();
    this.totalFramesScanned = 0;
    this.framesWithValidQr = 0;
    this.startTimeMs = 0;
    this._clearOverlay();
  }

  async processExternalImageData(imageData, nowMs = performance.now(), explicitQrCount = null) {
    return this._processCapturedFrame(imageData, nowMs, explicitQrCount);
  }

  async _processCapturedFrame(imageData, nowMs, explicitQrCount = null) {
    this.totalFramesScanned += 1;
    const expectedQrCount =
      explicitQrCount !== null
        ? explicitQrCount
        : (appState.preferences.receiverQrCount ?? appState.preferences.qrCount ?? 4);

    const { results, latencyMs } = await this.qrDetector.detectFromImageData(
      imageData,
      expectedQrCount
    );

    if (results.length > 0) {
      this.framesWithValidQr += 1;
      this.decodeFpsCounter.tick(nowMs);
    }

    this._drawDetectionOverlay(imageData.width, imageData.height, results);

    let newValidInFrame = 0;
    for (const item of results) {
      const ingested = this.packetCollector.ingestRawScan(item, nowMs);
      if (ingested.status === 'valid') {
        newValidInFrame += 1;
        await this.reconstructor.processPacket(ingested.packet, nowMs);
      } else if (ingested.status === 'calibration') {
        appEvents.emit('receiver:calibration-update', ingested.summary);
      }
    }

    const stats = this.getReceiverStats(nowMs, latencyMs, results.length);
    appState.updateDiagnostics({
      framesCapturedFps: stats.captureFps,
      framesDecodedFps: stats.decodeFps,
      validPacketsPerSec: stats.validPacketsPerSec,
      usefulPayloadBytesPerSec: stats.throughputBytesPerSec,
      decodeSuccessRate: stats.decodeSuccessRatio * 100,
      checksumErrors: this.packetCollector.corruptPacketsCount,
      duplicatePackets: this.packetCollector.duplicatePacketsCount,
      activeDecoderName: this.qrDetector.getActiveEngineName(),
      lastQrDecodeMs: latencyMs
    });

    if (newValidInFrame > 0 || results.length > 0) {
      appEvents.emit('receiver:progress', stats);
    }

    if (this.reconstructor.state === 'completed') {
      this.frameCapture.stop();
      this.isScanning = false;
      appState.setRuntime({ transferState: 'completed' });
      appEvents.emit('receiver:completed', stats);
    }
  }

  _drawDetectionOverlay(frameW, frameH, detectedItems) {
    if (!this.overlayCanvas || !this.overlayCtx) return;
    if (this.overlayCanvas.width !== frameW || this.overlayCanvas.height !== frameH) {
      this.overlayCanvas.width = frameW;
      this.overlayCanvas.height = frameH;
    }
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, frameW, frameH);

    for (const item of detectedItems) {
      const pts = item.cornerPoints;
      if (!pts || pts.length < 4) continue;

      ctx.save();
      ctx.strokeStyle = '#34D399';
      ctx.fillStyle = 'rgba(52, 211, 153, 0.16)';
      ctx.lineWidth = Math.max(2, Math.round(frameW / 240));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  _clearOverlay() {
    if (this.overlayCanvas && this.overlayCtx) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
  }

  getReceiverStats(nowMs = performance.now(), lastDecodeLatencyMs = 0, panelsDetectedInFrame = 0) {
    const snap = this.reconstructor.getProgressSnapshot(nowMs);
    const decodeSuccessRatio =
      this.totalFramesScanned > 0 ? this.framesWithValidQr / this.totalFramesScanned : 0;
    const elapsedMs = this.startTimeMs > 0 ? Math.max(0, nowMs - this.startTimeMs) : 0;

    return {
      ...snap,
      panelsDetectedInFrame,
      expectedReceiverQrCount: appState.preferences.receiverQrCount ?? 4,
      captureFps: Number(this.frameCapture.getMeasuredCaptureFps().toFixed(1)),
      decodeFps: Number(this.decodeFpsCounter.getFps(nowMs).toFixed(1)),
      validPacketsPerSec: Number(this.packetCollector.validPacketRateCounter.getFps(nowMs).toFixed(1)),
      decodeSuccessRatio,
      duplicatePacketsCount: this.packetCollector.duplicatePacketsCount,
      corruptPacketsCount: this.packetCollector.corruptPacketsCount,
      foreignSessionCount: this.packetCollector.foreignSessionCount,
      lastDecodeLatencyMs: Number(lastDecodeLatencyMs.toFixed(2)),
      elapsedMs
    };
  }
}
