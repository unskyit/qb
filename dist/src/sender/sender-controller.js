/**
 * QuadBeam Sender Controller
 * Manages multi-file transfer queue, file validation, streaming SHA-256 computation,
 * optional AES-256-GCM encryption, optical calibration stream, and live 1/2/4/6-QR transmission.
 */

import { ChunkedFileSource } from './file-reader.js';
import { QrGridRenderer } from './qr-grid.js';
import { OpticalFrameScheduler } from './frame-scheduler.js';
import { resolveTransmissionSettings, buildCalibrationProbePacket } from './transmission-settings.js';
import { OpticalPacketScheduler } from '../protocol/packet-scheduler.js';
import { decodeRepairRequest } from '../protocol/recovery.js';
import { deriveAesGcmKey, bytesToHex } from '../protocol/integrity.js';
import { generateSessionId, generateFileId } from '../utils/ids.js';
import { sanitizeFilename } from '../utils/sanitization.js';
import { appState } from '../core/state.js';
import { appEvents } from '../core/events.js';
import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

export class SenderController {
  constructor() {
    this.queue = [];
    this.activeQueueIndex = 0;
    this.sessionId = generateSessionId();
    this.gridRenderer = null;
    this.packetScheduler = null;
    this.frameScheduler = new OpticalFrameScheduler(() => this._renderNextTransmissionFrame());
    this.activeConfig = null;
    this.startTimeMs = 0;
    this.pausedDurationMs = 0;
    this.pauseStartedMs = 0;
    this.isCalibrating = false;
    this.calibrationSeq = 0;
    this.lastFramePackets = [];
  }

  attachGridContainer(containerEl) {
    this.gridRenderer = new QrGridRenderer(containerEl);
  }

  addFiles(fileList) {
    const maxBytes = (appState.preferences.maxFileSizeMiB || 50) * 1024 * 1024;
    const added = [];

    for (const file of Array.from(fileList || [])) {
      if (file.size > maxBytes) {
        throw new QuadBeamError(
          ERROR_CODES.FILE_TOO_LARGE,
          `"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MiB) exceeds the configured ${appState.preferences.maxFileSizeMiB} MiB limit.`,
          'Choose a smaller file or increase the maximum file size limit in Settings → Storage.'
        );
      }

      const item = {
        id: generateFileId(),
        file,
        filename: sanitizeFilename(file.name),
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        status: 'queued',
        sha256Hex: null,
        hashProgress: 0,
        previewUrl: null
      };

      if (file.type && file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024 && typeof URL !== 'undefined' && URL.createObjectURL) {
        try {
          item.previewUrl = URL.createObjectURL(file);
        } catch {
          item.previewUrl = null;
        }
      }

      this.queue.push(item);
      added.push(item);
    }

    appState.setRuntime({ senderQueue: this.queue });
    appEvents.emit('sender:queue-updated', this.queue);
    return added;
  }

  removeQueueItem(fileId) {
    const idx = this.queue.findIndex((item) => item.id === fileId);
    if (idx === -1) return;
    const removed = this.queue[idx];
    if (removed.previewUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    this.queue.splice(idx, 1);
    if (this.activeQueueIndex >= this.queue.length) {
      this.activeQueueIndex = Math.max(0, this.queue.length - 1);
    }
    appState.setRuntime({ senderQueue: this.queue, activeSenderIndex: this.activeQueueIndex });
    appEvents.emit('sender:queue-updated', this.queue);
  }

  clearQueue() {
    this.stop();
    for (const item of this.queue) {
      if (item.previewUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    this.queue = [];
    this.activeQueueIndex = 0;
    appState.setRuntime({ senderQueue: [], activeSenderIndex: 0, transferState: 'idle' });
    appEvents.emit('sender:queue-updated', this.queue);
  }

  getActiveItem() {
    return this.queue[this.activeQueueIndex] || null;
  }

  /**
   * Render idle preview squares matching the current viewport/stage dimensions and QR count.
   */
  renderIdlePreview(viewportWidth = 1024, viewportHeight = 768, isFullscreen = false, stageWidth = 0, stageHeight = 0) {
    if (!this.gridRenderer) return;
    this.activeConfig = resolveTransmissionSettings(
      appState.preferences,
      viewportWidth,
      viewportHeight,
      isFullscreen,
      stageWidth,
      stageHeight
    );
    this.gridRenderer.configure({
      qrCount: this.activeConfig.qrCount,
      panelSizePx: this.activeConfig.panelSizePx,
      gridColumns: this.activeConfig.gridColumns,
      gridRows: this.activeConfig.gridRows,
      gapPx: this.activeConfig.gapPx,
      ecLevel: this.activeConfig.ecLevel,
      wireEncoding: appState.preferences.wireEncoding,
      highContrast: appState.preferences.highContrastQr
    });
    const idlePackets = Array.from({ length: this.activeConfig.qrCount }, (_, i) =>
      new TextEncoder().encode(`QUADBEAM-READY-CH-${i + 1}`)
    );
    this.gridRenderer.renderFramePackets(
      idlePackets,
      idlePackets.map((_, i) => `CH ${i + 1} · READY`)
    );
  }

  startCalibrationStream(viewportWidth, viewportHeight, isFullscreen = false, stageWidth = 0, stageHeight = 0) {
    this.frameScheduler.stop();
    this.isCalibrating = true;
    this.calibrationSeq = 0;
    this.startTimeMs = performance.now();

    this.activeConfig = resolveTransmissionSettings(
      appState.preferences,
      viewportWidth,
      viewportHeight,
      isFullscreen,
      stageWidth,
      stageHeight
    );

    if (this.gridRenderer) {
      this.gridRenderer.configure({
        qrCount: this.activeConfig.qrCount,
        panelSizePx: this.activeConfig.panelSizePx,
        gridColumns: this.activeConfig.gridColumns,
        gridRows: this.activeConfig.gridRows,
        gapPx: this.activeConfig.gapPx,
        ecLevel: this.activeConfig.ecLevel,
        wireEncoding: appState.preferences.wireEncoding,
        highContrast: appState.preferences.highContrastQr
      });
    }

    appState.setRuntime({ transferState: 'calibrating' });
    this.frameScheduler.start(this.activeConfig.fps);
  }

  async startTransmission({
    viewportWidth = 1024,
    viewportHeight = 768,
    isFullscreen = false,
    stageWidth = 0,
    stageHeight = 0,
    password = ''
  } = {}) {
    const activeItem = this.getActiveItem();
    if (!activeItem) {
      throw new Error('No file selected in transmission queue');
    }

    this.frameScheduler.stop();
    this.isCalibrating = false;
    activeItem.status = 'hashing';
    appState.setRuntime({ transferState: 'preparing' });
    appEvents.emit('sender:status', { state: 'preparing', item: activeItem });

    this.activeConfig = resolveTransmissionSettings(
      appState.preferences,
      viewportWidth,
      viewportHeight,
      isFullscreen,
      stageWidth,
      stageHeight
    );

    let encryptionMode = 0;
    let encryptionSalt = null;
    let encryptionIvBase = null;
    let encryptionKey = null;

    if (password && password.trim().length > 0 && globalThis.crypto?.subtle) {
      encryptionMode = 1;
      encryptionSalt = new Uint8Array(16);
      encryptionIvBase = new Uint8Array(12);
      globalThis.crypto.getRandomValues(encryptionSalt);
      globalThis.crypto.getRandomValues(encryptionIvBase);
      encryptionKey = await deriveAesGcmKey(password.trim(), encryptionSalt);
    }

    const fileSource = new ChunkedFileSource(activeItem.file, {
      filename: activeItem.filename,
      mimeType: activeItem.mimeType,
      blockSize: this.activeConfig.blockSize,
      encryptionKey,
      encryptionIvBase
    });

    const sha256Digest = await fileSource.computeSha256((done, total) => {
      activeItem.hashProgress = total > 0 ? done / total : 1;
      appEvents.emit('sender:hash-progress', {
        item: activeItem,
        done,
        total
      });
    });

    activeItem.sha256Hex = bytesToHex(sha256Digest);

    this.packetScheduler = new OpticalPacketScheduler({
      sessionId: this.sessionId,
      fileId: activeItem.id,
      filename: activeItem.filename,
      fileSize: activeItem.fileSize,
      mimeType: activeItem.mimeType,
      blockSize: this.activeConfig.blockSize,
      sha256Digest,
      redundancyPercent: this.activeConfig.redundancyPercent,
      encryptionMode,
      encryptionSalt,
      encryptionIvBase,
      getGenerationBlocks: (genId) => fileSource.getGenerationBlocks(genId)
    });

    if (this.gridRenderer) {
      this.gridRenderer.configure({
        qrCount: this.activeConfig.qrCount,
        panelSizePx: this.activeConfig.panelSizePx,
        gridColumns: this.activeConfig.gridColumns,
        gridRows: this.activeConfig.gridRows,
        gapPx: this.activeConfig.gapPx,
        ecLevel: this.activeConfig.ecLevel,
        wireEncoding: appState.preferences.wireEncoding,
        highContrast: appState.preferences.highContrastQr
      });
    }

    activeItem.status = 'transmitting';
    this.startTimeMs = performance.now();
    this.pausedDurationMs = 0;
    appState.setRuntime({ transferState: 'transmitting' });
    appEvents.emit('sender:status', {
      state: 'transmitting',
      item: activeItem,
      config: this.activeConfig,
      scheduler: this.packetScheduler
    });

    await this._renderNextTransmissionFrame();
    this.frameScheduler.start(this.activeConfig.fps);
  }

  reconfigureLiveLayout(viewportWidth, viewportHeight, isFullscreen = false, stageWidth = 0, stageHeight = 0) {
    const nextConfig = resolveTransmissionSettings(
      appState.preferences,
      viewportWidth,
      viewportHeight,
      isFullscreen,
      stageWidth,
      stageHeight
    );

    if (!this.packetScheduler && !this.isCalibrating) {
      this.renderIdlePreview(viewportWidth, viewportHeight, isFullscreen, stageWidth, stageHeight);
      appEvents.emit('sender:layout-updated', this.activeConfig);
      return;
    }

    this.activeConfig = {
      ...(this.activeConfig || {}),
      qrCount: nextConfig.qrCount,
      fps: nextConfig.fps,
      panelSizePx: nextConfig.panelSizePx,
      gridColumns: nextConfig.gridColumns,
      gridRows: nextConfig.gridRows,
      gapPx: nextConfig.gapPx,
      autoReducedReason: nextConfig.autoReducedReason,
      landscapeRecommended: nextConfig.landscapeRecommended
    };

    if (this.gridRenderer) {
      this.gridRenderer.configure({
        qrCount: this.activeConfig.qrCount,
        panelSizePx: this.activeConfig.panelSizePx,
        gridColumns: this.activeConfig.gridColumns,
        gridRows: this.activeConfig.gridRows,
        gapPx: this.activeConfig.gapPx,
        ecLevel: this.activeConfig.ecLevel,
        wireEncoding: appState.preferences.wireEncoding,
        highContrast: appState.preferences.highContrastQr
      });
    }
    this.frameScheduler.setTargetFps(this.activeConfig.fps);
    this._renderNextTransmissionFrame();
    appEvents.emit('sender:layout-updated', this.activeConfig);
  }

  pause() {
    if (appState.runtime.transferState !== 'transmitting' && appState.runtime.transferState !== 'calibrating') {
      return;
    }
    this.pauseStartedMs = performance.now();
    this.frameScheduler.pause();
    const item = this.getActiveItem();
    if (item) item.status = 'paused';
    appState.setRuntime({ transferState: 'paused' });
    appEvents.emit('sender:status', { state: 'paused', item });
  }

  resume() {
    if (appState.runtime.transferState !== 'paused') return;
    if (this.pauseStartedMs > 0) {
      this.pausedDurationMs += performance.now() - this.pauseStartedMs;
      this.pauseStartedMs = 0;
    }
    const item = this.getActiveItem();
    if (item) item.status = 'transmitting';
    const nextState = this.isCalibrating ? 'calibrating' : 'transmitting';
    appState.setRuntime({ transferState: nextState });
    this.frameScheduler.resume();
    appEvents.emit('sender:status', { state: nextState, item });
  }

  async restart(viewportWidth, viewportHeight, isFullscreen = false, stageWidth = 0, stageHeight = 0) {
    this.stop();
    await this.startTransmission({ viewportWidth, viewportHeight, isFullscreen, stageWidth, stageHeight });
  }

  stop() {
    this.frameScheduler.stop();
    this.isCalibrating = false;
    appState.setRuntime({ transferState: 'idle' });
    appEvents.emit('sender:status', { state: 'idle', item: this.getActiveItem() });
  }

  applyReceiverRepairCode(repairQrString) {
    if (!this.packetScheduler) {
      throw new Error('No active sender session to apply repair code');
    }
    const decoded = decodeRepairRequest(repairQrString);
    this.packetScheduler.applyRepairRequest(decoded.missingBlockIndices);
    appEvents.emit('sender:repair-applied', decoded);
    return decoded;
  }

  getProgressStats() {
    const now = performance.now();
    const elapsedMs =
      this.startTimeMs > 0
        ? Math.max(0, (this.pauseStartedMs || now) - this.startTimeMs - this.pausedDurationMs)
        : 0;

    return {
      activeItem: this.getActiveItem(),
      queueLength: this.queue.length,
      queueIndex: this.activeQueueIndex,
      framesTransmitted: this.packetScheduler ? this.packetScheduler.framesGenerated : this.calibrationSeq,
      packetsEncoded: this.packetScheduler ? this.packetScheduler.sequenceId : this.calibrationSeq,
      bytesEncodedTotal: this.packetScheduler ? this.packetScheduler.bytesEncodedTotal : 0,
      currentGenId: this.packetScheduler ? this.packetScheduler.currentGenId : 0,
      totalGenerations: this.packetScheduler ? this.packetScheduler.totalGenerations : 1,
      passCount: this.packetScheduler ? this.packetScheduler.passCount : 0,
      repairQueueRemaining: this.packetScheduler ? this.packetScheduler.repairQueue.length : 0,
      configuredFps: this.activeConfig ? this.activeConfig.fps : appState.preferences.fps,
      measuredFps: this.frameScheduler.getMeasuredFps(),
      qrCount: this.activeConfig ? this.activeConfig.qrCount : appState.preferences.qrCount,
      elapsedMs
    };
  }

  async _renderNextTransmissionFrame() {
    if (!this.gridRenderer || !this.activeConfig) return;

    if (this.isCalibrating) {
      const packets = [];
      const labels = [];
      for (let p = 0; p < this.activeConfig.qrCount; p++) {
        const seq = ++this.calibrationSeq;
        packets.push(
          buildCalibrationProbePacket({
            sessionId: this.sessionId,
            sequenceId: seq,
            panelId: p,
            probeBlockSize: this.activeConfig.blockSize,
            targetFps: this.activeConfig.fps,
            qrCount: this.activeConfig.qrCount
          })
        );
        labels.push(`CAL CH ${p + 1} · #${seq}`);
      }
      this.lastFramePackets = packets;
      const { renderDurationMs } = this.gridRenderer.renderFramePackets(packets, labels);
      appState.updateDiagnostics({ lastQrRenderMs: renderDurationMs });
      appEvents.emit('sender:frame-rendered', this.getProgressStats());
      return;
    }

    if (!this.packetScheduler) return;
    const packets = await this.packetScheduler.nextFramePackets(this.activeConfig.qrCount);
    this.lastFramePackets = packets;
    const { renderDurationMs } = this.gridRenderer.renderFramePackets(packets);
    appState.updateDiagnostics({ lastQrRenderMs: renderDurationMs });
    appEvents.emit('sender:frame-rendered', this.getProgressStats());
  }
}
