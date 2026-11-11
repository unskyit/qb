/**
 * QuadBeam Receive Files View Component
 * Renders camera viewport, 4-quadrant alignment guide, dynamic hardware controls,
 * live packet/fountain reconstruction telemetry, QR frame image upload scanner,
 * Repair Request QR generator, and Verified Completion Card.
 */

import {
  formatBytes,
  formatThroughput,
  formatDuration,
  formatPercent
} from '../utils/formatters.js';
import { escapeHtml } from '../utils/sanitization.js';
import { renderCameraControls } from './camera-picker.js';
import { renderCompletionCard } from './completion.js';
import { encodeQrMatrix, renderQrToCanvas } from '../sender/qr-generator.js';
import { appState } from '../core/state.js';
import { showToast } from './notifications.js';

export function renderReceiveView(containerEl, { scannerController }) {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <div class="qb-workspace-grid">
      <!-- Left Column: Receiver Status, Telemetry & Recovery Actions -->
      <div class="qb-panel">
        <div class="qb-panel-header">
          <h2 class="qb-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Optical Receiver
          </h2>
          <span id="qb-rx-badge" style="font-size:0.75rem;font-weight:700;color:var(--qb-accent);">STANDBY</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:0.55rem;">
          <button type="button" id="qb-rx-start-cam-btn" class="qb-btn qb-btn-primary" style="width:100%;">
            Start Camera Scanner
          </button>
          <div style="display:flex;gap:0.5rem;">
            <button type="button" id="qb-rx-pause-btn" class="qb-btn qb-btn-secondary" disabled style="flex:1;">Pause</button>
            <button type="button" id="qb-rx-stop-btn" class="qb-btn qb-btn-danger" disabled style="flex:1;">Stop</button>
            <button type="button" id="qb-rx-reset-btn" class="qb-btn qb-btn-secondary" style="flex:1;">Reset</button>
          </div>
        </div>

        <!-- Alternative Frame File Input (Scan saved QR image/screenshot) -->
        <div style="padding-top:0.35rem;border-top:1px solid var(--qb-border);display:flex;flex-direction:column;gap:0.45rem;">
          <span style="font-size:0.78rem;color:var(--qb-text-secondary);font-weight:600;">No camera or testing from screenshots?</span>
          <button type="button" id="qb-rx-scan-image-btn" class="qb-btn qb-btn-secondary" style="width:100%;font-size:0.82rem;">
            Scan QR Image / Frame Files
          </button>
          <input type="file" id="qb-rx-image-input" accept="image/*" multiple style="display:none;" />
        </div>

        <!-- Active Transfer File Summary -->
        <div class="qb-stat-box" id="qb-rx-file-box">
          <span class="qb-stat-label">Active Incoming File</span>
          <div id="qb-rx-filename" style="font-weight:700;font-size:0.92rem;margin-top:0.15rem;">Waiting for QR metadata packet...</div>
          <div id="qb-rx-filemeta" style="font-size:0.78rem;color:var(--qb-text-secondary);">Point camera at sender's QR display</div>
        </div>

        <!-- Reconstruction Progress Bar -->
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;font-weight:600;margin-bottom:0.35rem;">
            <span>Verified Reconstruction</span>
            <span id="qb-rx-pct" class="qb-mono">0%</span>
          </div>
          <div class="qb-progress-track">
            <div id="qb-rx-bar" class="qb-progress-fill" style="width:0%;"></div>
          </div>
        </div>

        <!-- Live Receiver Telemetry Grid -->
        <div class="qb-telemetry-grid">
          <div class="qb-stat-box">
            <span class="qb-stat-label">Blocks Solved</span>
            <span class="qb-stat-value" id="qb-rx-blocks">0 / 0</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Fountain Healed</span>
            <span class="qb-stat-value" id="qb-rx-fountain">0</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Valid Pkts/s</span>
            <span class="qb-stat-value" id="qb-rx-pps">0.0</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Throughput</span>
            <span class="qb-stat-value" id="qb-rx-rate">0.0 KB/s</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Smoothed ETA</span>
            <span class="qb-stat-value" id="qb-rx-eta">Calibrating...</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Decode Rate</span>
            <span class="qb-stat-value" id="qb-rx-success">0%</span>
          </div>
        </div>

        <!-- Recovery / Repair Request QR Generator -->
        <div style="padding-top:0.4rem;border-top:1px solid var(--qb-border);display:flex;flex-direction:column;gap:0.5rem;">
          <button type="button" id="qb-rx-gen-repair-btn" class="qb-btn qb-btn-secondary" disabled style="width:100%;font-size:0.82rem;">
            Generate Missing-Blocks Repair QR
          </button>
          <div id="qb-rx-repair-box" style="display:none;flex-direction:column;align-items:center;gap:0.5rem;padding:0.75rem;background-color:var(--qb-surface-secondary);border-radius:var(--qb-radius-md);">
            <span style="font-size:0.76rem;font-weight:600;text-align:center;">Scan or copy this Repair Request on the Sender to retransmit missing blocks:</span>
            <canvas id="qb-rx-repair-canvas" width="200" height="200" style="background:#FFF;padding:8px;border-radius:8px;"></canvas>
            <input type="text" id="qb-rx-repair-code-input" class="qb-input qb-mono" readonly style="width:100%;font-size:0.72rem;" />
          </div>
        </div>
      </div>

      <!-- Right Column: Live Camera Preview, Hardware Controls & Completion View -->
      <div style="display:flex;flex-direction:column;gap:1.1rem;">
        <div id="qb-rx-completion-slot"></div>

        <div class="qb-panel">
          <div id="qb-rx-camera-controls" class="qb-stage-toolbar"></div>

          <div id="qb-rx-camera-error" style="display:none;padding:1rem;border-radius:var(--qb-radius-md);background-color:var(--qb-danger-subtle);color:var(--qb-danger);font-size:0.86rem;"></div>

          <div class="qb-camera-stage">
            <video id="qb-rx-video" class="qb-camera-video ${appState.preferences.mirrorPreview ? 'mirrored' : ''}" playsinline muted></video>
            <canvas id="qb-rx-overlay" class="qb-camera-overlay"></canvas>
            <div class="qb-reticle-guide" aria-hidden="true">
              <div class="qb-reticle-quad"></div>
              <div class="qb-reticle-quad"></div>
              <div class="qb-reticle-quad"></div>
              <div class="qb-reticle-quad"></div>
            </div>
            <div id="qb-rx-placeholder" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.65rem;padding:1.5rem;text-align:center;color:#E3EAF4;background:rgba(7,10,16,0.72);">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#77AAEF" stroke-width="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <div style="font-weight:700;font-size:1.05rem;">Camera Scanner Standby</div>
              <div style="font-size:0.84rem;color:#98A6B8;max-width:380px;">
                Click <strong>Start Camera Scanner</strong> to grant camera permission and align the sender's 1, 2, or 4 QR grid inside the guide frame.
              </div>
            </div>
          </div>

          <div id="qb-rx-calibration-banner" style="display:none;padding:0.75rem 1rem;border-radius:var(--qb-radius-md);background-color:var(--qb-accent-subtle);font-size:0.84rem;"></div>
        </div>
      </div>
    </div>
  `;

  const videoEl = containerEl.querySelector('#qb-rx-video');
  const overlayCanvas = containerEl.querySelector('#qb-rx-overlay');
  const camControlsEl = containerEl.querySelector('#qb-rx-camera-controls');
  const camErrorEl = containerEl.querySelector('#qb-rx-camera-error');
  const placeholderEl = containerEl.querySelector('#qb-rx-placeholder');
  const startCamBtn = containerEl.querySelector('#qb-rx-start-cam-btn');
  const pauseBtn = containerEl.querySelector('#qb-rx-pause-btn');
  const stopBtn = containerEl.querySelector('#qb-rx-stop-btn');
  const resetBtn = containerEl.querySelector('#qb-rx-reset-btn');
  const scanImageBtn = containerEl.querySelector('#qb-rx-scan-image-btn');
  const imageInput = containerEl.querySelector('#qb-rx-image-input');
  const genRepairBtn = containerEl.querySelector('#qb-rx-gen-repair-btn');
  const repairBox = containerEl.querySelector('#qb-rx-repair-box');
  const repairCanvas = containerEl.querySelector('#qb-rx-repair-canvas');
  const repairCodeInput = containerEl.querySelector('#qb-rx-repair-code-input');
  const completionSlot = containerEl.querySelector('#qb-rx-completion-slot');
  const calBanner = containerEl.querySelector('#qb-rx-calibration-banner');

  scannerController.attachElements({ videoEl, overlayCanvas });

  const refreshCameraBar = () => {
    renderCameraControls(camControlsEl, {
      devices: scannerController.cameraManager.devices,
      activeDeviceId: scannerController.cameraManager.activeDeviceId,
      capabilities: scannerController.cameraManager.capabilities,
      mirrored: appState.preferences.mirrorPreview,
      onSelectDevice: async (devId) => {
        try {
          await scannerController.switchCameraPreservingState(devId, 'direct');
          refreshCameraBar();
          showToast('Switched camera while preserving received blocks.', 'info', 2500);
        } catch (err) {
          showCameraError(err);
        }
      },
      onNextCamera: async () => {
        try {
          await scannerController.switchCameraPreservingState(null, 'next');
          refreshCameraBar();
        } catch (err) {
          showCameraError(err);
        }
      },
      onPrevCamera: async () => {
        try {
          await scannerController.switchCameraPreservingState(null, 'prev');
          refreshCameraBar();
        } catch (err) {
          showCameraError(err);
        }
      },
      onToggleFacing: async () => {
        try {
          await scannerController.switchCameraPreservingState(null, 'facing');
          refreshCameraBar();
        } catch (err) {
          showCameraError(err);
        }
      },
      onToggleTorch: async (enable) => {
        await scannerController.cameraManager.setTorch(enable);
        refreshCameraBar();
      },
      onChangeZoom: async (val) => {
        await scannerController.cameraManager.setZoom(val);
      },
      onChangeExposure: async (val) => {
        await scannerController.cameraManager.setExposureCompensation(val);
      },
      onToggleMirror: () => {
        const next = !appState.preferences.mirrorPreview;
        appState.updatePreferences({ mirrorPreview: next });
        videoEl.classList.toggle('mirrored', next);
        refreshCameraBar();
      }
    });
  };

  function showCameraError(err) {
    if (!camErrorEl) return;
    camErrorEl.style.display = 'block';
    camErrorEl.innerHTML = `
      <strong>${escapeHtml(err?.message || 'Camera Error')}</strong>
      ${err?.recoveryHint ? `<div style="margin-top:0.25rem;color:var(--qb-text-primary);">${escapeHtml(err.recoveryHint)}</div>` : ''}
    `;
  }

  refreshCameraBar();

  startCamBtn.addEventListener('click', async () => {
    camErrorEl.style.display = 'none';
    try {
      await scannerController.startReceiving();
      placeholderEl.style.display = 'none';
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
      refreshCameraBar();
      showToast('Camera scanner active. Point camera at sender QR codes.', 'success', 2800);
    } catch (err) {
      showCameraError(err);
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (scannerController.isScanning) {
      scannerController.pauseScanning();
      pauseBtn.textContent = 'Resume';
    } else {
      scannerController.resumeScanning();
      pauseBtn.textContent = 'Pause';
    }
  });

  stopBtn.addEventListener('click', () => {
    scannerController.stopReceiving(false);
    placeholderEl.style.display = 'flex';
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
  });

  resetBtn.addEventListener('click', () => {
    scannerController.resetSession();
    completionSlot.innerHTML = '';
    repairBox.style.display = 'none';
    calBanner.style.display = 'none';
    updateReceiverUI(scannerController.getReceiverStats());
    showToast('Receiver session reset.', 'info', 2000);
  });

  scanImageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    imageInput.value = '';
    if (files.length === 0) return;

    let decodedFrames = 0;
    for (const file of files) {
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        await scannerController.processExternalImageData(imgData, performance.now());
        decodedFrames++;
      } catch (err) {
        showToast(`Could not process image "${file.name}": ${err?.message || err}`, 'error');
      }
    }
    if (decodedFrames > 0) {
      updateReceiverUI(scannerController.getReceiverStats());
    }
  });

  genRepairBtn.addEventListener('click', () => {
    const repair = scannerController.reconstructor.generateRepairQr();
    if (!repair) {
      showToast('Receive metadata first before generating a repair request.', 'info');
      return;
    }
    const mat = encodeQrMatrix(repair.qrString, { ecLevel: 'M' });
    renderQrToCanvas(repairCanvas, mat, { size: 200, quietZone: 4 });
    repairCodeInput.value = repair.qrString;
    repairBox.style.display = 'flex';
  });

  function updateReceiverUI(stats) {
    const badgeEl = containerEl.querySelector('#qb-rx-badge');
    const nameEl = containerEl.querySelector('#qb-rx-filename');
    const metaEl = containerEl.querySelector('#qb-rx-filemeta');
    const pctEl = containerEl.querySelector('#qb-rx-pct');
    const barEl = containerEl.querySelector('#qb-rx-bar');
    const blocksEl = containerEl.querySelector('#qb-rx-blocks');
    const fountainEl = containerEl.querySelector('#qb-rx-fountain');
    const ppsEl = containerEl.querySelector('#qb-rx-pps');
    const rateEl = containerEl.querySelector('#qb-rx-rate');
    const etaEl = containerEl.querySelector('#qb-rx-eta');
    const successEl = containerEl.querySelector('#qb-rx-success');

    if (badgeEl) badgeEl.textContent = (stats.state || 'standby').toUpperCase();
    if (nameEl) {
      nameEl.textContent = stats.filename || 'Waiting for QR metadata packet...';
    }
    if (metaEl) {
      metaEl.textContent = stats.filename
        ? `${formatBytes(stats.fileSize)} · ${stats.totalGenerations} generation(s) · Session ${(stats.sessionId >>> 0).toString(16).toUpperCase()}`
        : 'Point camera at sender QR display';
    }
    const pct = formatPercent(stats.progressRatio, 1);
    if (pctEl) pctEl.textContent = pct;
    if (barEl) barEl.style.width = `${(stats.progressRatio * 100).toFixed(1)}%`;
    if (blocksEl) blocksEl.textContent = `${stats.resolvedBlocks} / ${stats.totalBlocks}`;
    if (fountainEl) fountainEl.textContent = String(stats.fountainRecoveredBlocks || 0);
    if (ppsEl) ppsEl.textContent = String(stats.validPacketsPerSec || 0);
    if (rateEl) rateEl.textContent = formatThroughput(stats.throughputBytesPerSec);
    if (etaEl) {
      etaEl.textContent =
        stats.etaSeconds === null ? 'Calibrating...' : formatDuration(stats.etaSeconds);
    }
    if (successEl) {
      successEl.textContent = `${Math.round((stats.decodeSuccessRatio || 0) * 100)}%`;
    }

    if (genRepairBtn) {
      genRepairBtn.disabled = !(stats.filename && stats.resolvedBlocks < stats.totalBlocks);
    }

    if (stats.state === 'completed' && stats.verificationResult?.verified) {
      renderCompletionCard(completionSlot, {
        stats,
        canShare: Boolean(navigator.share),
        isIos: scannerController.fileWriter.needsIosSaveGuidance(),
        onSaveFile: async () => {
          const res = await scannerController.fileWriter.saveWithPicker();
          if (res.saved) showToast(`Saved "${res.filename}" successfully.`, 'success');
        },
        onDownloadFile: () => {
          const res = scannerController.fileWriter.downloadDirect();
          if (res.saved) showToast(`Downloading "${res.filename}".`, 'success');
        },
        onShareFile: async () => {
          try {
            await scannerController.fileWriter.shareFile();
          } catch (err) {
            showToast(err?.message || 'Share canceled', 'info');
          }
        },
        onTransferAnother: () => {
          scannerController.resetSession();
          completionSlot.innerHTML = '';
          updateReceiverUI(scannerController.getReceiverStats());
        }
      });
    }
  }

  return {
    updateReceiverUI,
    refreshCameraBar,
    showCalibrationSummary(summary) {
      if (!calBanner) return;
      calBanner.style.display = 'block';
      calBanner.innerHTML = `
        <strong>Calibration Probe Measured:</strong> ${summary.measuredPacketsPerSec} pkts/s (~${formatBytes(summary.measuredBytesPerSec)}/s across ${summary.distinctPanelsSeen || 1} panel(s)).
        Recommended Sender Profile: <strong style="color:var(--qb-accent);text-transform:uppercase;">${escapeHtml(summary.recommendedProfile)}</strong>.
      `;
    }
  };
}
