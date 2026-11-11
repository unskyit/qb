/**
 * QuadBeam Single-Screen Compact Send View Component
 * Fits file selection, 1/2/4/6 QR panel controls, strict 1:1 square QR display stage,
 * and live telemetry into a single non-scrolling screen.
 */

import { formatBytes, formatElapsed } from '../utils/formatters.js';
import { escapeHtml } from '../utils/sanitization.js';
import { SUPPORTED_FPS, SUPPORTED_QR_COUNTS } from '../protocol/constants.js';
import { appState } from '../core/state.js';
import { showToast } from './notifications.js';

export function renderSendView(containerEl, {
  senderController,
  onRunLoopbackTest,
  onOpenRepairModal
}) {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <div class="qb-singlepage-stack">
      <!-- Top Bar 1: File Picker, Queue Strip & Primary Start Actions -->
      <div class="qb-compact-bar">
        <div class="qb-toolbar-group">
          <div id="qb-dropzone" class="qb-dropzone" role="button" tabindex="0" aria-label="Choose or drop files">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--qb-accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Drop / Pick File</span>
            <input type="file" id="qb-file-input" multiple style="display:none;" />
          </div>
          <button type="button" id="qb-choose-file-btn" class="qb-btn qb-btn-secondary">Browse</button>
          <button type="button" id="qb-sample-file-btn" class="qb-btn qb-btn-secondary" title="Load sample file to test immediately">Sample File</button>
          <div id="qb-queue-list" class="qb-queue-list" aria-live="polite">
            <span style="font-size:0.72rem;color:var(--qb-text-secondary);">No file (<span id="qb-queue-count">0</span>)</span>
          </div>
          <button type="button" id="qb-clear-queue-btn" class="qb-btn qb-btn-danger" style="display:none;">Clear</button>
        </div>

        <div class="qb-toolbar-group">
          <div id="qb-send-password-wrap" style="display:${appState.preferences.enablePasswordEncryption ? 'inline-flex' : 'none'};align-items:center;">
            <input type="password" id="qb-send-password" class="qb-input" placeholder="Password (AES)" autocomplete="off" style="width:110px;" />
          </div>
          <button type="button" id="qb-start-send-btn" class="qb-btn qb-btn-primary" disabled>Start Send</button>
          <button type="button" id="qb-loopback-test-btn" class="qb-btn qb-btn-secondary" disabled title="Test end-to-end 1/2/4/6-QR encoding & decoding on this device">Loopback</button>
          <button type="button" id="qb-start-cal-btn" class="qb-btn qb-btn-secondary" title="Calibration Probe Stream">Calibrate</button>
        </div>
      </div>

      <!-- Center Stage: 1 / 2 / 4 / 6 Strict-Square QR Display Stage -->
      <div id="qb-optical-stage" class="qb-optical-stage">
        <!-- Stage Control Strip -->
        <div class="qb-compact-bar" style="width:100%;background:var(--qb-surface-secondary);">
          <div class="qb-toolbar-group">
            <span style="font-size:0.72rem;font-weight:700;color:var(--qb-text-secondary);">QR Grid:</span>
            <div class="qb-toolbar-group" id="qb-tx-qr-pills" role="group" aria-label="Sender QR Count">
              ${SUPPORTED_QR_COUNTS.map(
                (cnt) =>
                  `<button type="button" class="qb-btn qb-btn-secondary qb-tx-qr-pill ${appState.preferences.qrCount === cnt ? 'active' : ''}" data-qrcount="${cnt}">${cnt} QR</button>`
              ).join('')}
            </div>
            <select id="qb-stage-qrcount" class="qb-select sr-only" aria-label="QR Panel Count">
              ${SUPPORTED_QR_COUNTS.map(
                (cnt) =>
                  `<option value="${cnt}" ${appState.preferences.qrCount === cnt ? 'selected' : ''}>${cnt} QR</option>`
              ).join('')}
            </select>

            <label for="qb-stage-fps" style="font-size:0.72rem;font-weight:600;color:var(--qb-text-secondary);margin-left:0.2rem;">FPS:</label>
            <select id="qb-stage-fps" class="qb-select" aria-label="Transmission Frame Rate">
              ${SUPPORTED_FPS.map(
                (f) =>
                  `<option value="${f}" ${appState.preferences.fps === f ? 'selected' : ''}>${f} FPS</option>`
              ).join('')}
            </select>

            <select id="qb-stage-profile" class="qb-select" aria-label="Transmission Profile">
              <option value="reliable" ${appState.preferences.profile === 'reliable' ? 'selected' : ''}>Reliable</option>
              <option value="balanced" ${appState.preferences.profile === 'balanced' ? 'selected' : ''}>Balanced</option>
              <option value="turbo" ${appState.preferences.profile === 'turbo' ? 'selected' : ''}>Turbo</option>
              <option value="custom" ${appState.preferences.profile === 'custom' ? 'selected' : ''}>Custom</option>
            </select>
          </div>

          <div class="qb-toolbar-group">
            <button type="button" id="qb-stage-pause-btn" class="qb-btn qb-btn-secondary" disabled>Pause</button>
            <button type="button" id="qb-stage-restart-btn" class="qb-btn qb-btn-secondary" disabled>Restart</button>
            <button type="button" id="qb-stage-stop-btn" class="qb-btn qb-btn-danger" disabled>Stop</button>
            <button type="button" id="qb-stage-repair-btn" class="qb-btn qb-btn-secondary" disabled title="Apply Receiver Repair Code">Repair</button>
            <button type="button" id="qb-stage-contrast-btn" class="qb-btn qb-btn-secondary" title="High-Contrast Borders">Contrast</button>
            <button type="button" id="qb-stage-fullscreen-btn" class="qb-btn qb-btn-secondary" title="Fullscreen Stage">Full</button>
          </div>
        </div>

        <!-- Centered Viewport for Strict 1:1 Square QR Panels -->
        <div id="qb-qr-stage-viewport" class="qb-qr-stage-viewport">
          <div id="qb-qr-grid-container" class="qb-qr-grid"></div>
        </div>

        <!-- Single-Line Telemetry Strip -->
        <div class="qb-telemetry-strip" id="qb-sender-telemetry">
          <div class="qb-stat-inline">
            <span class="qb-stat-label">State:</span>
            <span class="qb-stat-value" id="qb-st-status">READY</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Frames:</span>
            <span class="qb-stat-value" id="qb-st-frames">0</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Encoded:</span>
            <span class="qb-stat-value" id="qb-st-bytes">0 B</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Gen:</span>
            <span class="qb-stat-value" id="qb-st-gen">0/0</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Rate:</span>
            <span class="qb-stat-value" id="qb-st-fps">0 FPS</span>
          </div>
          <div class="qb-stat-inline">
            <span class="qb-stat-label">Time:</span>
            <span class="qb-stat-value" id="qb-st-elapsed">00:00</span>
          </div>
          <span id="qb-stage-notice" style="font-size:0.68rem;color:var(--qb-text-secondary);">1:1 Square Optical Grid</span>
        </div>
      </div>
    </div>
  `;

  const gridContainer = containerEl.querySelector('#qb-qr-grid-container');
  const stageViewport = containerEl.querySelector('#qb-qr-stage-viewport');
  const stageEl = containerEl.querySelector('#qb-optical-stage');
  senderController.attachGridContainer(gridContainer);

  const getStageDims = () => {
    const rect = stageViewport ? stageViewport.getBoundingClientRect() : null;
    return {
      viewportWidth: window.innerWidth || 1024,
      viewportHeight: window.innerHeight || 768,
      stageWidth: rect && rect.width > 40 ? rect.width : 0,
      stageHeight: rect && rect.height > 40 ? rect.height : 0,
      isFullscreen: Boolean(document.fullscreenElement || stageEl.classList.contains('qb-fullscreen-active'))
    };
  };

  // Initial render of strict 1:1 square preview QR panels
  const initDims = getStageDims();
  senderController.renderIdlePreview(
    initDims.viewportWidth,
    initDims.viewportHeight,
    initDims.isFullscreen,
    initDims.stageWidth,
    initDims.stageHeight
  );

  // Wire File Input & Dropzone
  const fileInput = containerEl.querySelector('#qb-file-input');
  const dropzone = containerEl.querySelector('#qb-dropzone');
  const chooseBtn = containerEl.querySelector('#qb-choose-file-btn');
  const sampleBtn = containerEl.querySelector('#qb-sample-file-btn');
  const clearQueueBtn = containerEl.querySelector('#qb-clear-queue-btn');
  const startBtn = containerEl.querySelector('#qb-start-send-btn');
  const calBtn = containerEl.querySelector('#qb-start-cal-btn');
  const loopbackBtn = containerEl.querySelector('#qb-loopback-test-btn');

  const handleFilesSelected = (files) => {
    if (!files || files.length === 0) return;
    try {
      const added = senderController.addFiles(files);
      if (added.length > 0) {
        showToast(`Ready to send ${added[0].filename}`, 'success', 2000);
      }
      refreshQueueUI();
    } catch (err) {
      showToast(err?.message || 'Could not add file', 'error');
    }
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  chooseBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    handleFilesSelected(e.target.files);
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) {
      handleFilesSelected(e.dataTransfer.files);
    }
  });

  sampleBtn.addEventListener('click', () => {
    const sampleContent = [
      '# QuadBeam Optical File Transfer Sample',
      `Generated: ${new Date().toISOString()}`,
      'Protocol: QuadBeam v1 (0x5142) · LT Fountain + Base45 + SHA-256',
      'Unicode: नमस्ते · こんにちは · Ελληνικά · 🚀⚡🛰️'
    ].join('\n');

    const blocks = [];
    for (let i = 0; i < 14; i++) {
      blocks.push(`[Block #${String(i + 1).padStart(2, '0')}] ${sampleContent}\n`);
    }
    const blob = new Blob(blocks, { type: 'text/markdown' });
    const sampleFile = new File([blob], 'QuadBeam-Sample.md', {
      type: 'text/markdown'
    });
    handleFilesSelected([sampleFile]);
  });

  clearQueueBtn.addEventListener('click', () => {
    senderController.clearQueue();
    refreshQueueUI();
    const dims = getStageDims();
    senderController.renderIdlePreview(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
  });

  function refreshQueueUI() {
    const queue = senderController.queue;
    const listEl = containerEl.querySelector('#qb-queue-list');
    if (clearQueueBtn) clearQueueBtn.style.display = queue.length > 0 ? 'inline-flex' : 'none';
    if (startBtn) startBtn.disabled = queue.length === 0;
    if (loopbackBtn) loopbackBtn.disabled = queue.length === 0;

    if (!listEl) return;
    if (queue.length === 0) {
      listEl.innerHTML = `<span style="font-size:0.72rem;color:var(--qb-text-secondary);">No file (<span id="qb-queue-count">0</span>)</span>`;
      return;
    }

    listEl.innerHTML = queue
      .map((item, idx) => {
        const isActive = idx === senderController.activeQueueIndex;
        return `
          <div class="qb-queue-item ${isActive ? 'active' : ''}" data-file-id="${item.id}">
            <span class="qb-queue-name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
            <span style="color:var(--qb-text-secondary);">(${formatBytes(item.fileSize, 1)})</span>
            <button type="button" class="qb-remove-item-btn" data-remove-id="${item.id}" style="font-weight:700;padding:0 2px;" aria-label="Remove ${escapeHtml(item.filename)}">&times;</button>
          </div>
        `;
      })
      .join('') + `<span class="sr-only" id="qb-queue-count">${queue.length}</span>`;

    listEl.querySelectorAll('.qb-remove-item-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-remove-id'));
        senderController.removeQueueItem(id);
        refreshQueueUI();
      });
    });
  }

  // Stage Controls
  const qrCountSelect = containerEl.querySelector('#qb-stage-qrcount');
  const qrPills = containerEl.querySelectorAll('.qb-tx-qr-pill');
  const fpsSelect = containerEl.querySelector('#qb-stage-fps');
  const profileSelect = containerEl.querySelector('#qb-stage-profile');
  const pauseBtn = containerEl.querySelector('#qb-stage-pause-btn');
  const restartBtn = containerEl.querySelector('#qb-stage-restart-btn');
  const stopBtn = containerEl.querySelector('#qb-stage-stop-btn');
  const repairBtn = containerEl.querySelector('#qb-stage-repair-btn');
  const contrastBtn = containerEl.querySelector('#qb-stage-contrast-btn');
  const fullscreenBtn = containerEl.querySelector('#qb-stage-fullscreen-btn');
  const noticeEl = containerEl.querySelector('#qb-stage-notice');

  const syncQrCountButtons = (cnt) => {
    qrCountSelect.value = String(cnt);
    qrPills.forEach((b) => {
      b.classList.toggle('active', Number(b.getAttribute('data-qrcount')) === Number(cnt));
    });
  };

  const applyQrCountChange = (qrCount) => {
    appState.updatePreferences({ profile: 'custom', qrCount: Number(qrCount), autoMode: false });
    profileSelect.value = 'custom';
    syncQrCountButtons(qrCount);
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
  };

  qrPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      applyQrCountChange(Number(pill.getAttribute('data-qrcount')));
    });
  });

  qrCountSelect.addEventListener('change', (e) => {
    applyQrCountChange(Number(e.target.value));
  });

  fpsSelect.addEventListener('change', (e) => {
    const fps = Number(e.target.value);
    appState.updatePreferences({ profile: 'custom', fps });
    profileSelect.value = 'custom';
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
  });

  profileSelect.addEventListener('change', (e) => {
    const profile = e.target.value;
    appState.updatePreferences({ profile });
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
    if (senderController.activeConfig) {
      syncQrCountButtons(senderController.activeConfig.qrCount);
      fpsSelect.value = String(senderController.activeConfig.fps);
    }
  });

  startBtn.addEventListener('click', async () => {
    try {
      const dims = getStageDims();
      const pwdInput = containerEl.querySelector('#qb-send-password');
      const password = pwdInput ? pwdInput.value : '';
      await senderController.startTransmission({ ...dims, password });
      pauseBtn.disabled = false;
      pauseBtn.textContent = 'Pause';
      restartBtn.disabled = false;
      stopBtn.disabled = false;
      repairBtn.disabled = false;
      refreshQueueUI();
      if (noticeEl) {
        noticeEl.textContent = `${senderController.activeConfig.qrCount}× Square QR (${senderController.activeConfig.panelSizePx}px)`;
      }
    } catch (err) {
      showToast(err?.message || 'Failed to start transmission', 'error');
    }
  });

  calBtn.addEventListener('click', () => {
    const dims = getStageDims();
    senderController.startCalibrationStream(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    stopBtn.disabled = false;
    showToast('Calibration stream active.', 'info', 2000);
  });

  loopbackBtn.addEventListener('click', () => {
    if (onRunLoopbackTest) onRunLoopbackTest();
  });

  pauseBtn.addEventListener('click', () => {
    if (appState.runtime.transferState === 'paused') {
      senderController.resume();
      pauseBtn.textContent = 'Pause';
    } else {
      senderController.pause();
      pauseBtn.textContent = 'Resume';
    }
    refreshQueueUI();
  });

  restartBtn.addEventListener('click', async () => {
    const dims = getStageDims();
    await senderController.restart(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
    pauseBtn.textContent = 'Pause';
  });

  stopBtn.addEventListener('click', () => {
    senderController.stop();
    pauseBtn.disabled = true;
    restartBtn.disabled = true;
    stopBtn.disabled = true;
    repairBtn.disabled = true;
    refreshQueueUI();
  });

  repairBtn.addEventListener('click', () => {
    if (onOpenRepairModal) onOpenRepairModal();
  });

  contrastBtn.addEventListener('click', () => {
    const next = !appState.preferences.highContrastQr;
    appState.updatePreferences({ highContrastQr: next });
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(
      dims.viewportWidth,
      dims.viewportHeight,
      dims.isFullscreen,
      dims.stageWidth,
      dims.stageHeight
    );
  });

  fullscreenBtn.addEventListener('click', async () => {
    if (!document.fullscreenElement && !stageEl.classList.contains('qb-fullscreen-active')) {
      if (stageEl.requestFullscreen) {
        try {
          await stageEl.requestFullscreen();
        } catch {
          stageEl.classList.add('qb-fullscreen-active');
        }
      } else {
        stageEl.classList.add('qb-fullscreen-active');
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
      stageEl.classList.remove('qb-fullscreen-active');
    }
    setTimeout(() => {
      const dims = getStageDims();
      senderController.reconfigureLiveLayout(
        dims.viewportWidth,
        dims.viewportHeight,
        dims.isFullscreen,
        dims.stageWidth,
        dims.stageHeight
      );
    }, 80);
  });

  return {
    refreshQueueUI,
    getStageDims,
    updateTelemetry(stats) {
      const stStatus = containerEl.querySelector('#qb-st-status');
      const stFrames = containerEl.querySelector('#qb-st-frames');
      const stBytes = containerEl.querySelector('#qb-st-bytes');
      const stGen = containerEl.querySelector('#qb-st-gen');
      const stFps = containerEl.querySelector('#qb-st-fps');
      const stElapsed = containerEl.querySelector('#qb-st-elapsed');

      if (stStatus) stStatus.textContent = appState.runtime.transferState.toUpperCase();
      if (stFrames) stFrames.textContent = String(stats.framesTransmitted);
      if (stBytes) stBytes.textContent = formatBytes(stats.bytesEncodedTotal, 1);
      if (stGen) stGen.textContent = `${stats.currentGenId + 1}/${stats.totalGenerations} (P${stats.passCount + 1})`;
      if (stFps) stFps.textContent = `${Math.round(stats.measuredFps || stats.configuredFps)} FPS`;
      if (stElapsed) stElapsed.textContent = formatElapsed(stats.elapsedMs);
    }
  };
}
