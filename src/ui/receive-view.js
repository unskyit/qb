/**
 * QuadBeam Single-Screen Compact Receive View Component
 * Provides explicit Receiver Scanner Input controls:
 * - Expected QR Grid Count selector (`Auto`, `1 QR`, `2 QR`, `4 QR`, `6 QR`)
 * - Scanner Input Source selector (Camera picker, Front/Rear Flip, or Image File upload)
 * - Dynamic 1 / 2 / 4 / 6 Square Reticle Guide Overlay inside the camera viewfinder
 * - Single-line compact telemetry & progress bar with zero page scrolling
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
import { getGridDimensionsForCount } from '../sender/transmission-settings.js';
import { appState } from '../core/state.js';
import { showToast } from './notifications.js';

export function renderReceiveView(containerEl, { scannerController }) {
  if (!containerEl) return;

  const curRxCount = appState.preferences.receiverQrCount ?? 4;

  containerEl.innerHTML = `
    <div class="qb-singlepage-stack">
      <!-- Top Bar 1: Receiver Scanner Input QR Count + Start/Stop + Image File Input -->
      <div class="qb-compact-bar">
        <div class="qb-toolbar-group">
          <span style="font-size:0.72rem;font-weight:700;color:var(--qb-text-secondary);">Scanner QR Grid:</span>
          <div class="qb-toolbar-group" id="qb-rx-qr-pills" role="group" aria-label="Receiver QR Grid Count">
            ${[
              { val: 0, label: 'Auto' },
              { val: 1, label: '1 QR' },
              { val: 2, label: '2 QR' },
              { val: 4, label: '4 QR' },
              { val: 6, label: '6 QR' }
            ]
              .map(
                (opt) =>
                  `<button type="button" class="qb-btn qb-btn-secondary qb-rx-qr-pill ${curRxCount === opt.val ? 'active' : ''}" data-rxcount="${opt.val}">${opt.label}</button>`
              )
              .join('')}
          </div>
          <select id="qb-rx-qrcount" class="qb-select sr-only" aria-label="Receiver Expected QR Count">
            <option value="0" ${curRxCount === 0 ? 'selected' : ''}>Auto</option>
            <option value="1" ${curRxCount === 1 ? 'selected' : ''}>1 QR</option>
            <option value="2" ${curRxCount === 2 ? 'selected' : ''}>2 QR</option>
            <option value="4" ${curRxCount === 4 ? 'selected' : ''}>4 QR</option>
            <option value="6" ${curRxCount === 6 ? 'selected' : ''}>6 QR</option>
          </select>
        </div>

        <div class="qb-toolbar-group">
          <button type="button" id="qb-rx-start-cam-btn" class="qb-btn qb-btn-primary">Start Camera</button>
          <button type="button" id="qb-rx-pause-btn" class="qb-btn qb-btn-secondary" disabled>Pause</button>
          <button type="button" id="qb-rx-stop-btn" class="qb-btn qb-btn-danger" disabled>Stop</button>
          <button type="button" id="qb-rx-scan-image-btn" class="qb-btn qb-btn-secondary" title="Scan QR from image or screenshot">Scan Image</button>
          <input type="file" id="qb-rx-image-input" accept="image/*" multiple style="display:none;" />
          <button type="button" id="qb-rx-gen-repair-btn" class="qb-btn qb-btn-secondary" disabled title="Show Missing-Blocks Repair QR">Repair QR</button>
          <button type="button" id="qb-rx-reset-btn" class="qb-btn qb-btn-secondary">Reset</button>
        </div>
      </div>

      <!-- Top Bar 2: Camera Device Selector & Hardware Controls -->
      <div id="qb-rx-camera-controls" class="qb-compact-bar"></div>

      <!-- Completion Slot / Error Banner / Calibration Banner -->
      <div id="qb-rx-completion-slot"></div>
      <div id="qb-rx-camera-error" style="display:none;padding:0.45rem 0.65rem;border-radius:var(--qb-radius-sm);background-color:var(--qb-danger-subtle);color:var(--qb-danger);font-size:0.76rem;"></div>
      <div id="qb-rx-calibration-banner" style="display:none;padding:0.4rem 0.65rem;border-radius:var(--qb-radius-sm);background-color:var(--qb-accent-subtle);font-size:0.75rem;"></div>

      <!-- Center Camera Viewport with Dynamic 1 / 2 / 4 / 6 Square Reticle Guide -->
      <div class="qb-camera-stage" id="qb-rx-stage-box">
        <video id="qb-rx-video" class="qb-camera-video ${appState.preferences.mirrorPreview ? 'mirrored' : ''}" playsinline muted></video>
        <canvas id="qb-rx-overlay" class="qb-camera-overlay"></canvas>
        <div id="qb-rx-reticle" class="qb-reticle-guide" aria-hidden="true"></div>

        <div id="qb-rx-placeholder" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.4rem;padding:1rem;text-align:center;color:#E3EAF4;background:rgba(7,10,16,0.68);">
          <div style="font-weight:700;font-size:0.92rem;">Scanner Ready (<span id="qb-rx-mode-label">${curRxCount === 0 ? 'Auto 1–6 QR' : `${curRxCount} QR Grid`}</span>)</div>
          <div style="font-size:0.76rem;color:#98A6B8;max-width:320px;">
            Tap <strong>Start Camera</strong> or <strong>Scan Image</strong>, and align the sender's square QR grid inside the target boxes.
          </div>
        </div>

        <!-- Floating Repair QR Overlay when requested -->
        <div id="qb-rx-repair-box" style="display:none;position:absolute;inset:0;z-index:20;background:rgba(5,6,8,0.88);flex-direction:column;align-items:center;justify-content:center;gap:0.45rem;padding:0.75rem;color:#E3EAF4;">
          <span style="font-size:0.76rem;font-weight:600;">Scan or copy Repair Request on Sender:</span>
          <canvas id="qb-rx-repair-canvas" width="160" height="160" style="background:#FFF;padding:6px;border-radius:8px;width:160px;height:160px;"></canvas>
          <input type="text" id="qb-rx-repair-code-input" class="qb-input qb-mono" readonly style="width:240px;font-size:0.7rem;" />
          <button type="button" id="qb-rx-close-repair-btn" class="qb-btn qb-btn-secondary">Close Repair QR</button>
        </div>
      </div>

      <!-- Bottom Single-Line Progress & Telemetry Strip -->
      <div id="qb-rx-file-box" class="qb-compact-bar" style="flex-direction:column;align-items:stretch;gap:0.3rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;font-size:0.75rem;">
          <div style="display:flex;align-items:center;gap:0.4rem;min-width:0;">
            <span id="qb-rx-badge" style="font-weight:700;color:var(--qb-accent);font-size:0.7rem;">STANDBY</span>
            <span id="qb-rx-filename" style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Waiting for QR stream...</span>
            <span id="qb-rx-filemeta" style="color:var(--qb-text-secondary);font-size:0.7rem;white-space:nowrap;"></span>
          </div>
          <span id="qb-rx-pct" class="qb-mono" style="font-weight:700;color:var(--qb-accent);">0%</span>
        </div>

        <div class="qb-progress-track">
          <div id="qb-rx-bar" class="qb-progress-fill" style="width:0%;"></div>
        </div>

        <div class="qb-telemetry-strip" style="padding:0.2rem 0.4rem;">
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Blocks:</span>
            <span class="qb-stat-value" id="qb-rx-blocks">0/0</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Fountain:</span>
            <span class="qb-stat-value" id="qb-rx-fountain">0</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Pkts/s:</span>
            <span class="qb-stat-value" id="qb-rx-pps">0.0</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Speed:</span>
            <span class="qb-stat-value" id="qb-rx-rate">0.0 KB/s</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">ETA:</span>
            <span class="qb-stat-value" id="qb-rx-eta">Calibrating...</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Decode:</span>
            <span class="qb-stat-value" id="qb-rx-success">0%</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const videoEl = containerEl.querySelector('#qb-rx-video');
  const overlayCanvas = containerEl.querySelector('#qb-rx-overlay');
  const reticleEl = containerEl.querySelector('#qb-rx-reticle');
  const modeLabelEl = containerEl.querySelector('#qb-rx-mode-label');
  const rxPills = containerEl.querySelectorAll('.qb-rx-qr-pill');
  const rxSelect = containerEl.querySelector('#qb-rx-qrcount');
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
  const closeRepairBtn = containerEl.querySelector('#qb-rx-close-repair-btn');
  const repairCanvas = containerEl.querySelector('#qb-rx-repair-canvas');
  const repairCodeInput = containerEl.querySelector('#qb-rx-repair-code-input');
  const completionSlot = containerEl.querySelector('#qb-rx-completion-slot');
  const calBanner = containerEl.querySelector('#qb-rx-calibration-banner');

  scannerController.attachElements({ videoEl, overlayCanvas });

  const updateReticleGrid = (rxCount) => {
    if (!reticleEl) return;
    const displayCount = rxCount === 0 ? 4 : rxCount;
    const isLandscape = (window.innerWidth || 1024) >= (window.innerHeight || 768);
    const { cols, rows } = getGridDimensionsForCount(displayCount, isLandscape);
    reticleEl.style.setProperty('--qb-rx-cols', String(cols));
    reticleEl.style.setProperty('--qb-rx-rows', String(rows));

    reticleEl.innerHTML = Array.from(
      { length: displayCount },
      (_, i) => `<div class="qb-reticle-quad"><span>CH ${i + 1}</span></div>`
    ).join('');

    if (modeLabelEl) {
      modeLabelEl.textContent = rxCount === 0 ? 'Auto 1–6 QR' : `${rxCount} QR Grid`;
    }
  };

  const setReceiverQrCount = (val) => {
    const num = Number(val);
    appState.updatePreferences({ receiverQrCount: num });
    if (rxSelect) rxSelect.value = String(num);
    rxPills.forEach((p) => {
      p.classList.toggle('active', Number(p.getAttribute('data-rxcount')) === num);
    });
    updateReticleGrid(num);
  };

  rxPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      setReceiverQrCount(Number(pill.getAttribute('data-rxcount')));
    });
  });

  if (rxSelect) {
    rxSelect.addEventListener('change', (e) => {
      setReceiverQrCount(Number(e.target.value));
    });
  }

  updateReticleGrid(curRxCount);

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
          showToast('Switched camera while preserving received blocks.', 'info', 2000);
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
      ${err?.recoveryHint ? ` — ${escapeHtml(err.recoveryHint)}` : ''}
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
      showToast('Camera scanner active.', 'success', 2000);
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
    showToast('Receiver session reset.', 'info', 1800);
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
        await scannerController.processExternalImageData(
          imgData,
          performance.now(),
          appState.preferences.receiverQrCount
        );
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
    renderQrToCanvas(repairCanvas, mat, { size: 160, quietZone: 4 });
    repairCodeInput.value = repair.qrString;
    repairBox.style.display = 'flex';
  });

  if (closeRepairBtn) {
    closeRepairBtn.addEventListener('click', () => {
      repairBox.style.display = 'none';
    });
  }

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
      nameEl.textContent = stats.filename || 'Waiting for QR stream...';
    }
    if (metaEl) {
      metaEl.textContent = stats.filename ? `(${formatBytes(stats.fileSize, 1)})` : '';
    }
    const pct = formatPercent(stats.progressRatio, 1);
    if (pctEl) pctEl.textContent = pct;
    if (barEl) barEl.style.width = `${(stats.progressRatio * 100).toFixed(1)}%`;
    if (blocksEl) blocksEl.textContent = `${stats.resolvedBlocks}/${stats.totalBlocks}`;
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
    updateReticleGrid,
    showCalibrationSummary(summary) {
      if (!calBanner) return;
      calBanner.style.display = 'block';
      calBanner.innerHTML = `
        <strong>Calibrated:</strong> ${summary.measuredPacketsPerSec} pkts/s (~${formatBytes(summary.measuredBytesPerSec)}/s).
        Recommended Profile: <strong style="color:var(--qb-accent);text-transform:uppercase;">${escapeHtml(summary.recommendedProfile)}</strong>.
      `;
    }
  };
}
