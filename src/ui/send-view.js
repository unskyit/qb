/**
 * QuadBeam Send Files View Component
 * Provides drag-and-drop file selection, multi-file queue management, sample test file generator,
 * 1/2/4-QR synchronized optical stage, fullscreen mode, calibration stream, repair code input,
 * and live optical loopback verification.
 */

import { formatBytes, getFileExtension, formatElapsed } from '../utils/formatters.js';
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
    <div class="qb-workspace-grid">
      <!-- Left Column: File Selection & Queue -->
      <div class="qb-panel">
        <div class="qb-panel-header">
          <h2 class="qb-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            1. Select Files to Send
          </h2>
          <span style="font-size:0.75rem;color:var(--qb-text-secondary);">Max ${appState.preferences.maxFileSizeMiB} MiB/file</span>
        </div>

        <div id="qb-dropzone" class="qb-dropzone" role="button" tabindex="0" aria-label="Choose or drag and drop files to send">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--qb-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
          <div style="font-weight:600;font-size:0.95rem;">Drop files here or click to browse</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Preserves exact original bytes · Zero compression loss</div>
          <input type="file" id="qb-file-input" multiple style="display:none;" />
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button type="button" id="qb-choose-file-btn" class="qb-btn qb-btn-secondary" style="flex:1;">Choose Files</button>
          <button type="button" id="qb-sample-file-btn" class="qb-btn qb-btn-secondary" title="Generate a deterministic sample binary/markdown file to test immediately">Load Sample File</button>
        </div>

        <!-- Queue Header & Items -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.25rem;">
          <span style="font-size:0.82rem;font-weight:700;color:var(--qb-text-secondary);text-transform:uppercase;">Transfer Queue (<span id="qb-queue-count">0</span>)</span>
          <button type="button" id="qb-clear-queue-btn" style="font-size:0.78rem;color:var(--qb-danger);font-weight:600;display:none;">Clear Queue</button>
        </div>

        <div id="qb-queue-list" class="qb-queue-list" aria-live="polite">
          <div style="font-size:0.84rem;color:var(--qb-text-secondary);text-align:center;padding:1rem 0;">
            No files selected yet.
          </div>
        </div>

        <!-- Optional Encryption Password -->
        <div id="qb-send-password-wrap" style="display:${appState.preferences.enablePasswordEncryption ? 'flex' : 'none'};flex-direction:column;gap:0.35rem;">
          <label for="qb-send-password" style="font-size:0.8rem;font-weight:600;">Optional AES-256-GCM Password</label>
          <input type="password" id="qb-send-password" class="qb-input" placeholder="Leave blank for unencrypted optical stream" autocomplete="off" />
        </div>

        <!-- Primary Start / Calibration Controls -->
        <div style="display:flex;flex-direction:column;gap:0.55rem;margin-top:0.25rem;">
          <button type="button" id="qb-start-send-btn" class="qb-btn qb-btn-primary" disabled style="width:100%;">
            Start Optical Transmission
          </button>
          <div style="display:flex;gap:0.5rem;">
            <button type="button" id="qb-start-cal-btn" class="qb-btn qb-btn-secondary" style="flex:1;font-size:0.82rem;">
              Calibration Stream
            </button>
            <button type="button" id="qb-loopback-test-btn" class="qb-btn qb-btn-secondary" disabled style="flex:1;font-size:0.82rem;" title="Verify end-to-end 4-QR encoding, CV decoding, fountain recovery, and SHA-256 on this device">
              Verify via Loopback
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column: 4-QR Synchronized Optical Display Stage -->
      <div id="qb-optical-stage" class="qb-optical-stage">
        <div class="qb-stage-toolbar">
          <div class="qb-toolbar-group">
            <label for="qb-stage-qrcount" style="font-size:0.78rem;font-weight:600;color:var(--qb-text-secondary);">Panels:</label>
            <select id="qb-stage-qrcount" class="qb-select" aria-label="QR Panel Count">
              ${SUPPORTED_QR_COUNTS.map(
                (cnt) =>
                  `<option value="${cnt}" ${appState.preferences.qrCount === cnt ? 'selected' : ''}>${cnt} QR ${cnt === 4 ? '(2×2 Grid)' : cnt === 2 ? '(Dual)' : '(Single)'}</option>`
              ).join('')}
            </select>

            <label for="qb-stage-fps" style="font-size:0.78rem;font-weight:600;color:var(--qb-text-secondary);margin-left:0.25rem;">Rate:</label>
            <select id="qb-stage-fps" class="qb-select" aria-label="Transmission Frame Rate">
              ${SUPPORTED_FPS.map(
                (f) =>
                  `<option value="${f}" ${appState.preferences.fps === f ? 'selected' : ''}>${f} FPS${f === 60 ? ' (Exp)' : ''}</option>`
              ).join('')}
            </select>

            <label for="qb-stage-profile" style="font-size:0.78rem;font-weight:600;color:var(--qb-text-secondary);margin-left:0.25rem;">Mode:</label>
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
            <button type="button" id="qb-stage-repair-btn" class="qb-btn qb-btn-secondary" disabled title="Enter or scan Receiver Repair QR code">Repair</button>
            <button type="button" id="qb-stage-contrast-btn" class="qb-btn qb-btn-secondary" title="Toggle High-Contrast QR Frame">Contrast</button>
            <button type="button" id="qb-stage-fullscreen-btn" class="qb-btn qb-btn-secondary" title="Toggle Fullscreen QR Stage">Fullscreen</button>
          </div>
        </div>

        <!-- Auto-adaptation / Brightness Notice -->
        <div id="qb-stage-notice" style="font-size:0.8rem;color:var(--qb-text-secondary);text-align:center;">
          Increase screen brightness to 80–100% and avoid direct overhead glare for maximum camera decode rate.
        </div>

        <!-- Synchronized QR Canvas Container -->
        <div id="qb-qr-grid-container" class="qb-qr-grid"></div>

        <!-- Sender Live Telemetry Footer -->
        <div class="qb-telemetry-grid" id="qb-sender-telemetry">
          <div class="qb-stat-box">
            <span class="qb-stat-label">Status</span>
            <span class="qb-stat-value" id="qb-st-status">Ready</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Frames Sent</span>
            <span class="qb-stat-value" id="qb-st-frames">0</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Encoded Payload</span>
            <span class="qb-stat-value" id="qb-st-bytes">0 B</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Generation / Pass</span>
            <span class="qb-stat-value" id="qb-st-gen">0 / 0</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Measured Rate</span>
            <span class="qb-stat-value" id="qb-st-fps">0 FPS</span>
          </div>
          <div class="qb-stat-box">
            <span class="qb-stat-label">Elapsed</span>
            <span class="qb-stat-value" id="qb-st-elapsed">00:00</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const gridContainer = containerEl.querySelector('#qb-qr-grid-container');
  senderController.attachGridContainer(gridContainer);

  // Render an initial idle 4-QR preview pattern so the stage looks crisp immediately
  senderController.gridRenderer.configure({
    qrCount: appState.preferences.qrCount,
    panelSizePx: 210,
    gridColumns: appState.preferences.qrCount === 1 ? 1 : 2,
    gridRows: appState.preferences.qrCount === 4 ? 2 : 1,
    ecLevel: appState.preferences.ecLevel,
    wireEncoding: appState.preferences.wireEncoding,
    highContrast: appState.preferences.highContrastQr
  });
  const idlePackets = Array.from({ length: appState.preferences.qrCount }, (_, i) =>
    new TextEncoder().encode(`QUADBEAM-READY-CH-${i + 1}`)
  );
  senderController.gridRenderer.renderFramePackets(
    idlePackets,
    idlePackets.map((_, i) => `CH ${i + 1} · READY`)
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
        showToast(`Added ${added.length} file(s) to transmission queue.`, 'success');
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
      '# QuadBeam Optical File Transfer Verification Sample',
      `Generated at: ${new Date().toISOString()}`,
      'Protocol: QuadBeam Optical Binary Protocol v1 (0x5142)',
      'Coding: Systematic Luby Transform (LT) Fountain Code + RFC 9285 Base45',
      'Integrity: Per-packet IEEE 802.3 CRC32 + Full-File FIPS 180-4 SHA-256',
      '',
      '--- Binary & Unicode Fidelity Check ---',
      'Unicode: नमस्ते · こんにちは · Ελληνικά · 🚀⚡🛰️',
      'Repeating payload block for multi-generation fountain verification:'
    ].join('\n');

    const blocks = [];
    for (let i = 0; i < 18; i++) {
      blocks.push(`[Block #${String(i + 1).padStart(2, '0')}] ${sampleContent}\n`);
    }
    const blob = new Blob(blocks, { type: 'text/markdown' });
    const sampleFile = new File([blob], 'QuadBeam-Verification-Sample.md', {
      type: 'text/markdown'
    });
    handleFilesSelected([sampleFile]);
  });

  clearQueueBtn.addEventListener('click', () => {
    senderController.clearQueue();
    refreshQueueUI();
  });

  function refreshQueueUI() {
    const queue = senderController.queue;
    const countEl = containerEl.querySelector('#qb-queue-count');
    const listEl = containerEl.querySelector('#qb-queue-list');
    if (countEl) countEl.textContent = String(queue.length);
    if (clearQueueBtn) clearQueueBtn.style.display = queue.length > 0 ? 'inline-block' : 'none';
    if (startBtn) startBtn.disabled = queue.length === 0;
    if (loopbackBtn) loopbackBtn.disabled = queue.length === 0;

    if (!listEl) return;
    if (queue.length === 0) {
      listEl.innerHTML = `<div style="font-size:0.84rem;color:var(--qb-text-secondary);text-align:center;padding:1rem 0;">No files selected yet.</div>`;
      return;
    }

    listEl.innerHTML = queue
      .map((item, idx) => {
        const ext = getFileExtension(item.filename);
        const isActive = idx === senderController.activeQueueIndex;
        const thumbHtml = item.previewUrl
          ? `<img src="${escapeHtml(item.previewUrl)}" alt="" />`
          : escapeHtml(ext);
        return `
          <div class="qb-queue-item ${isActive ? 'active' : ''}" data-file-id="${item.id}">
            <div class="qb-queue-thumb">${thumbHtml}</div>
            <div class="qb-queue-info">
              <div class="qb-queue-name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</div>
              <div class="qb-queue-meta">
                <span>${formatBytes(item.fileSize)}</span>
                <span>·</span>
                <span>${escapeHtml(item.mimeType)}</span>
                <span>·</span>
                <span style="color:var(--qb-accent);font-weight:600;">${escapeHtml(item.status.toUpperCase())}</span>
              </div>
            </div>
            <button type="button" class="qb-btn-icon qb-remove-item-btn" data-remove-id="${item.id}" style="width:30px;height:30px;min-height:30px;" aria-label="Remove ${escapeHtml(item.filename)}">&times;</button>
          </div>
        `;
      })
      .join('');

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
  const fpsSelect = containerEl.querySelector('#qb-stage-fps');
  const profileSelect = containerEl.querySelector('#qb-stage-profile');
  const pauseBtn = containerEl.querySelector('#qb-stage-pause-btn');
  const restartBtn = containerEl.querySelector('#qb-stage-restart-btn');
  const stopBtn = containerEl.querySelector('#qb-stage-stop-btn');
  const repairBtn = containerEl.querySelector('#qb-stage-repair-btn');
  const contrastBtn = containerEl.querySelector('#qb-stage-contrast-btn');
  const fullscreenBtn = containerEl.querySelector('#qb-stage-fullscreen-btn');
  const stageEl = containerEl.querySelector('#qb-optical-stage');
  const noticeEl = containerEl.querySelector('#qb-stage-notice');

  const getStageDims = () => ({
    viewportWidth: window.innerWidth || 1024,
    viewportHeight: window.innerHeight || 768,
    isFullscreen: Boolean(document.fullscreenElement || stageEl.classList.contains('qb-fullscreen-active'))
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
      if (senderController.activeConfig?.autoReducedReason && noticeEl) {
        noticeEl.textContent = senderController.activeConfig.autoReducedReason;
      }
    } catch (err) {
      showToast(err?.message || 'Failed to start transmission', 'error');
    }
  });

  calBtn.addEventListener('click', () => {
    const dims = getStageDims();
    senderController.startCalibrationStream(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    stopBtn.disabled = false;
    showToast('Optical calibration probe stream active. Point receiver camera at screen.', 'info');
  });

  loopbackBtn.addEventListener('click', () => {
    if (onRunLoopbackTest) onRunLoopbackTest();
  });

  qrCountSelect.addEventListener('change', (e) => {
    const qrCount = Number(e.target.value);
    appState.updatePreferences({ profile: 'custom', qrCount, autoMode: false });
    profileSelect.value = 'custom';
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
  });

  fpsSelect.addEventListener('change', (e) => {
    const fps = Number(e.target.value);
    appState.updatePreferences({ profile: 'custom', fps });
    profileSelect.value = 'custom';
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
  });

  profileSelect.addEventListener('change', (e) => {
    const profile = e.target.value;
    appState.updatePreferences({ profile, autoMode: profile !== 'custom' });
    const dims = getStageDims();
    senderController.reconfigureLiveLayout(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
    if (senderController.activeConfig) {
      qrCountSelect.value = String(senderController.activeConfig.qrCount);
      fpsSelect.value = String(senderController.activeConfig.fps);
    }
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
    await senderController.restart(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
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
    senderController.reconfigureLiveLayout(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
    showToast(`High-contrast QR borders ${next ? 'enabled' : 'disabled'}.`, 'info', 2200);
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
      senderController.reconfigureLiveLayout(dims.viewportWidth, dims.viewportHeight, dims.isFullscreen);
    }, 100);
  });

  return {
    refreshQueueUI,
    updateTelemetry(stats) {
      const stStatus = containerEl.querySelector('#qb-st-status');
      const stFrames = containerEl.querySelector('#qb-st-frames');
      const stBytes = containerEl.querySelector('#qb-st-bytes');
      const stGen = containerEl.querySelector('#qb-st-gen');
      const stFps = containerEl.querySelector('#qb-st-fps');
      const stElapsed = containerEl.querySelector('#qb-st-elapsed');

      if (stStatus) stStatus.textContent = appState.runtime.transferState.toUpperCase();
      if (stFrames) stFrames.textContent = String(stats.framesTransmitted);
      if (stBytes) stBytes.textContent = formatBytes(stats.bytesEncodedTotal);
      if (stGen) stGen.textContent = `${stats.currentGenId + 1}/${stats.totalGenerations} (P${stats.passCount + 1})`;
      if (stFps) stFps.textContent = `${Math.round(stats.measuredFps || stats.configuredFps)} FPS`;
      if (stElapsed) stElapsed.textContent = formatElapsed(stats.elapsedMs);
    }
  };
}
