/**
 * QuadBeam Verified Transfer Completion Component
 * Displays verified filename, exact byte count, full SHA-256 match confirmation,
 * and Save / Download / Share / Transfer Another File actions.
 */

import { formatBytes, getFileExtension } from '../utils/formatters.js';
import { escapeHtml } from '../utils/sanitization.js';

export function renderCompletionCard(containerEl, {
  stats,
  canShare = false,
  isIos = false,
  onSaveFile,
  onDownloadFile,
  onShareFile,
  onTransferAnother
}) {
  if (!containerEl || !stats) return;

  const ext = getFileExtension(stats.filename || 'file.bin');
  const shaHex = stats.verificationResult?.actualSha256Hex || '';

  containerEl.innerHTML = `
    <div class="qb-panel" style="border-color:var(--qb-success);background-color:var(--qb-surface-primary);">
      <div style="display:flex;align-items:center;gap:1rem;">
        <div style="width:52px;height:52px;border-radius:50%;background-color:var(--qb-success-subtle);color:var(--qb-success);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:0.76rem;font-weight:700;color:var(--qb-success);text-transform:uppercase;letter-spacing:0.04em;">
            SHA-256 Cryptographic Integrity Verified
          </div>
          <h3 style="font-size:1.2rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(stats.filename || 'received-file.bin')}
          </h3>
          <div style="font-size:0.84rem;color:var(--qb-text-secondary);">
            ${formatBytes(stats.fileSize)} (${stats.fileSize.toLocaleString()} bytes) · ${escapeHtml(ext)} · ${escapeHtml(stats.mimeType || 'application/octet-stream')}
          </div>
        </div>
      </div>

      <div class="qb-stat-box" style="font-size:0.76rem;">
        <span class="qb-stat-label">Verified Full-File SHA-256 Digest</span>
        <code class="qb-mono" style="word-break:break-all;color:var(--qb-text-primary);">${escapeHtml(shaHex)}</code>
      </div>

      ${
        isIos
          ? `<div style="font-size:0.8rem;padding:0.65rem 0.85rem;border-radius:var(--qb-radius-md);background-color:var(--qb-accent-subtle);color:var(--qb-text-primary);">
              <strong>iOS Tip:</strong> Tap <em>Save / Download</em> or <em>Share</em> and select <strong>Save to Files</strong> to store the file in your iPhone/iPad Files app.
            </div>`
          : ''
      }

      <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
        <button type="button" id="qb-comp-save-btn" class="qb-btn qb-btn-primary">
          Save File
        </button>
        <button type="button" id="qb-comp-download-btn" class="qb-btn qb-btn-secondary">
          Download Copy
        </button>
        ${
          canShare
            ? `<button type="button" id="qb-comp-share-btn" class="qb-btn qb-btn-secondary">Share</button>`
            : ''
        }
        <button type="button" id="qb-comp-reset-btn" class="qb-btn qb-btn-secondary" style="margin-left:auto;">
          Transfer Another File
        </button>
      </div>
    </div>
  `;

  const saveBtn = containerEl.querySelector('#qb-comp-save-btn');
  if (saveBtn && onSaveFile) saveBtn.addEventListener('click', onSaveFile);

  const dlBtn = containerEl.querySelector('#qb-comp-download-btn');
  if (dlBtn && onDownloadFile) dlBtn.addEventListener('click', onDownloadFile);

  const shareBtn = containerEl.querySelector('#qb-comp-share-btn');
  if (shareBtn && onShareFile) shareBtn.addEventListener('click', onShareFile);

  const resetBtn = containerEl.querySelector('#qb-comp-reset-btn');
  if (resetBtn && onTransferAnother) resetBtn.addEventListener('click', onTransferAnother);
}
