/**
 * QuadBeam Compact Bottom Progress Bar Component
 * Clearly distinguishes authoritative Receiver reconstruction progress from
 * Sender unconfirmed optical broadcast activity.
 */

import {
  formatBytes,
  formatThroughput,
  formatDuration,
  formatElapsed,
  formatPercent
} from '../utils/formatters.js';
import { escapeHtml } from '../utils/sanitization.js';

export function updateBottomProgressBar(barEl, {
  mode, // 'idle' | 'sender' | 'receiver'
  transferState,
  senderStats,
  receiverStats,
  onPauseResume,
  onStop
}) {
  if (!barEl) return;

  if (mode === 'idle' || transferState === 'idle') {
    barEl.style.display = 'none';
    return;
  }

  barEl.style.display = 'flex';

  if (mode === 'sender' && senderStats) {
    const item = senderStats.activeItem;
    const filename = item ? item.filename : 'Calibration Stream';
    const fileSizeStr = item ? formatBytes(item.fileSize) : 'Optical Probe';
    const isPaused = transferState === 'paused';

    barEl.innerHTML = `
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:0.35rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;font-size:0.84rem;">
          <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            <span style="color:var(--qb-accent);">[Broadcasting]</span> ${escapeHtml(filename)} (${fileSizeStr})
          </div>
          <div class="qb-mono" style="font-size:0.78rem;color:var(--qb-text-secondary);">
            Pass #${senderStats.passCount + 1} · Gen ${senderStats.currentGenId + 1}/${senderStats.totalGenerations} · ${senderStats.framesTransmitted} frames · ${formatBytes(senderStats.bytesEncodedTotal)} encoded · ${Math.round(senderStats.measuredFps || senderStats.configuredFps)} FPS · ${formatElapsed(senderStats.elapsedMs)}
          </div>
        </div>
        <div style="font-size:0.74rem;color:var(--qb-text-secondary);">
          Optical broadcast active (${senderStats.qrCount} QR channels). Authoritative completion is verified on the receiving device.
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <button type="button" id="qb-prog-pause-btn" class="qb-btn qb-btn-secondary">${isPaused ? 'Resume' : 'Pause'}</button>
        <button type="button" id="qb-prog-stop-btn" class="qb-btn qb-btn-danger">Stop</button>
      </div>
    `;
  } else if (mode === 'receiver' && receiverStats) {
    const filename = receiverStats.filename || 'Waiting for stream metadata...';
    const pctStr = formatPercent(receiverStats.progressRatio, 1);
    const verifiedStr = `${formatBytes(receiverStats.verifiedSourceBytes)} / ${formatBytes(receiverStats.fileSize)}`;
    const rateStr = formatThroughput(receiverStats.throughputBytesPerSec);
    const etaStr =
      receiverStats.etaSeconds === null
        ? 'Calibrating...'
        : formatDuration(receiverStats.etaSeconds);
    const isPaused = transferState === 'paused';

    barEl.innerHTML = `
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:0.4rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;font-size:0.84rem;">
          <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(filename)} — <span style="color:var(--qb-accent);">${pctStr}</span> (${verifiedStr})
          </div>
          <div class="qb-mono" style="font-size:0.78rem;color:var(--qb-text-secondary);">
            ${rateStr} · ETA: ${etaStr} · Pkts: ${receiverStats.packetsReceived} (+${receiverStats.fountainRecoveredBlocks} fountain) · ${formatElapsed(receiverStats.elapsedMs)}
          </div>
        </div>
        <div class="qb-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(receiverStats.progressRatio * 100)}">
          <div class="qb-progress-fill" style="width:${(receiverStats.progressRatio * 100).toFixed(1)}%;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <button type="button" id="qb-prog-pause-btn" class="qb-btn qb-btn-secondary">${isPaused ? 'Resume' : 'Pause'}</button>
        <button type="button" id="qb-prog-stop-btn" class="qb-btn qb-btn-danger">Stop</button>
      </div>
    `;
  }

  const pauseBtn = barEl.querySelector('#qb-prog-pause-btn');
  if (pauseBtn && onPauseResume) pauseBtn.addEventListener('click', onPauseResume);

  const stopBtn = barEl.querySelector('#qb-prog-stop-btn');
  if (stopBtn && onStop) stopBtn.addEventListener('click', onStop);
}
