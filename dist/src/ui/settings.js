/**
 * QuadBeam Complete 7-Category Settings & Diagnostics Panel
 * Categories: Appearance, Transmission, Camera, Storage, Privacy, Diagnostics, Help.
 * Every control is bound to real application behavior.
 */

import { appState } from '../core/state.js';
import { formatBytes } from '../utils/formatters.js';
import { performFullCleanup } from '../storage/cleanup.js';
import { triggerBrowserDownload } from '../storage/download-manager.js';
import { showToast } from './notifications.js';

export function renderSettingsModalContent(containerEl, { onPreferencesUpdated }) {
  if (!containerEl) return;
  const prefs = appState.preferences;
  const diag = appState.runtime.diagnostics;
  const caps = appState.runtime.capabilities || {};

  containerEl.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:0.4rem;border-bottom:1px solid var(--qb-border);padding-bottom:0.75rem;">
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab active" data-tab="appearance">Appearance</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="transmission">Transmission</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="camera">Camera</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="storage">Storage</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="privacy">Privacy</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="diagnostics">Diagnostics</button>
      <button type="button" class="qb-btn qb-btn-secondary qb-settings-tab" data-tab="help">Help</button>
    </div>

    <!-- 1. APPEARANCE -->
    <div class="qb-settings-section" data-section="appearance">
      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Color Theme</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Light (#F7F9FC), Dark AMOLED (#050608), or Follow System</div>
        </div>
        <select id="qb-set-theme" class="qb-select">
          <option value="system" ${prefs.theme === 'system' ? 'selected' : ''}>System Default</option>
          <option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>Light Theme</option>
          <option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>Dark AMOLED</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Accent Color</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Primary interface accent tone</div>
        </div>
        <select id="qb-set-accent" class="qb-select">
          <option value="calm-blue" ${prefs.accent === 'calm-blue' ? 'selected' : ''}>Calm Blue (#477FDF)</option>
          <option value="cobalt" ${prefs.accent === 'cobalt' ? 'selected' : ''}>Royal Cobalt</option>
          <option value="cyan" ${prefs.accent === 'cyan' ? 'selected' : ''}>Optical Cyan</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Interface Density</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Adjust spacing for smaller laptop or mobile screens</div>
        </div>
        <select id="qb-set-density" class="qb-select">
          <option value="comfortable" ${prefs.density === 'comfortable' ? 'selected' : ''}>Comfortable</option>
          <option value="compact" ${prefs.density === 'compact' ? 'selected' : ''}>Compact</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Reduced Motion</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Minimize UI transitions while keeping QR frames atomic</div>
        </div>
        <input type="checkbox" id="qb-set-motion" ${prefs.reducedMotion ? 'checked' : ''} />
      </div>
    </div>

    <!-- 2. TRANSMISSION -->
    <div class="qb-settings-section" data-section="transmission" style="display:none;">
      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Automatic Viewport Adaptation</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Automatically step down QR panel count if screen is too small</div>
        </div>
        <input type="checkbox" id="qb-set-automode" ${prefs.autoMode ? 'checked' : ''} />
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Payload Block Density</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Bytes per QR packet before Base45 encoding</div>
        </div>
        <select id="qb-set-qr-density" class="qb-select">
          <option value="low" ${prefs.qrDensity === 'low' ? 'selected' : ''}>Low (140 B — Easiest to scan)</option>
          <option value="medium" ${prefs.qrDensity === 'medium' ? 'selected' : ''}>Medium (220 B — Balanced)</option>
          <option value="high" ${prefs.qrDensity === 'high' ? 'selected' : ''}>High (320 B — High resolution)</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">QR Error Correction Level</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Reed-Solomon symbol redundancy inside each QR code</div>
        </div>
        <select id="qb-set-ec" class="qb-select">
          <option value="L" ${prefs.ecLevel === 'L' ? 'selected' : ''}>Level L (~7% recovery)</option>
          <option value="M" ${prefs.ecLevel === 'M' ? 'selected' : ''}>Level M (~15% recovery)</option>
          <option value="Q" ${prefs.ecLevel === 'Q' ? 'selected' : ''}>Level Q (~25% recovery)</option>
          <option value="H" ${prefs.ecLevel === 'H' ? 'selected' : ''}>Level H (~30% recovery)</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">LT Fountain Parity Overhead (%)</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Extra rateless parity droplets per generation before advancing</div>
        </div>
        <input type="number" id="qb-set-redundancy" class="qb-input" min="10" max="200" step="5" value="${prefs.redundancyPercent}" style="width:90px;" />
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Wire Encoding Format</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Base45 in QR Alphanumeric mode (recommended) vs 8-bit Byte mode</div>
        </div>
        <select id="qb-set-wire" class="qb-select">
          <option value="base45" ${prefs.wireEncoding === 'base45' ? 'selected' : ''}>RFC 9285 Base45 (Alphanumeric)</option>
          <option value="byte" ${prefs.wireEncoding === 'byte' ? 'selected' : ''}>Raw Binary (QR 8-Bit Byte)</option>
        </select>
      </div>
    </div>

    <!-- 3. CAMERA -->
    <div class="qb-settings-section" data-section="camera" style="display:none;">
      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Preferred Mobile Camera Facing</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Default camera when starting Receiver</div>
        </div>
        <select id="qb-set-facing" class="qb-select">
          <option value="environment" ${prefs.preferredFacingMode === 'environment' ? 'selected' : ''}>Rear Camera (Environment)</option>
          <option value="user" ${prefs.preferredFacingMode === 'user' ? 'selected' : ''}>Front Camera (User)</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Preferred Capture Resolution</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">1080p balances 4-QR sharpness with fast frame decoding</div>
        </div>
        <select id="qb-set-res" class="qb-select">
          <option value="720p" ${prefs.preferredResolution === '720p' ? 'selected' : ''}>720p HD (Fastest decode)</option>
          <option value="1080p" ${prefs.preferredResolution === '1080p' ? 'selected' : ''}>1080p Full HD (Recommended)</option>
          <option value="4k" ${prefs.preferredResolution === '4k' ? 'selected' : ''}>4K UHD (High density)</option>
        </select>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">QR Decoder Engine</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Hybrid uses Native BarcodeDetector + Built-in ISO-18004 JS Engine</div>
        </div>
        <select id="qb-set-decoder" class="qb-select">
          <option value="auto" ${prefs.decoderEngine === 'auto' ? 'selected' : ''}>Auto Hybrid (Native + JS)</option>
          <option value="pure-js" ${prefs.decoderEngine === 'pure-js' ? 'selected' : ''}>QuadBeam ISO-18004 Pure JS Only</option>
        </select>
      </div>
    </div>

    <!-- 4. STORAGE -->
    <div class="qb-settings-section" data-section="storage" style="display:none;">
      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Use OPFS Disk Staging</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Stages reconstructed generations in Origin Private File System to bound RAM</div>
        </div>
        <input type="checkbox" id="qb-set-opfs" ${prefs.useOpfsStaging ? 'checked' : ''} />
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Maximum File Size Limit (MiB)</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Default 50 MiB; configurable up to 256 MiB when storage quota allows</div>
        </div>
        <input type="number" id="qb-set-maxsize" class="qb-input" min="1" max="256" value="${prefs.maxFileSizeMiB}" style="width:90px;" />
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Clear Temporary Staging Files</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Remove any interrupted OPFS staging buffers and revoke temporary URLs</div>
        </div>
        <button type="button" id="qb-set-clear-storage" class="qb-btn qb-btn-danger">Clear Temporary Data</button>
      </div>
    </div>

    <!-- 5. PRIVACY -->
    <div class="qb-settings-section" data-section="privacy" style="display:none;">
      <div style="padding:0.85rem;border-radius:var(--qb-radius-md);background-color:var(--qb-surface-secondary);font-size:0.84rem;display:flex;flex-direction:column;gap:0.45rem;">
        <strong>100% Local Air-Gapped Processing</strong>
        <p style="color:var(--qb-text-secondary);">
          QuadBeam processes all files exclusively inside your browser. There are no servers, no analytics, no telemetry, and no network uploads.
        </p>
        <strong>Optical Channel Visibility Notice</strong>
        <p style="color:var(--qb-text-secondary);">
          By default, QR transfers are not encrypted—anyone with line-of-sight who records the displayed QR stream could reconstruct the file. Enable optional AES-256-GCM password encryption below when transferring sensitive files in public spaces.
        </p>
      </div>

      <div class="qb-field-row">
        <div>
          <div style="font-weight:600;">Enable Optional AES-256-GCM Password Encryption</div>
          <div style="font-size:0.78rem;color:var(--qb-text-secondary);">Derives a 256-bit key via PBKDF2-SHA256 (100,000 iterations) per transfer</div>
        </div>
        <input type="checkbox" id="qb-set-encryption" ${prefs.enablePasswordEncryption ? 'checked' : ''} />
      </div>
    </div>

    <!-- 6. DIAGNOSTICS -->
    <div class="qb-settings-section" data-section="diagnostics" style="display:none;">
      <div class="qb-telemetry-grid">
        <div class="qb-stat-box">
          <span class="qb-stat-label">Active QR Decoder</span>
          <span style="font-size:0.8rem;font-weight:600;">${diag.activeDecoderName}</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">OPFS Support</span>
          <span class="qb-stat-value">${caps.opfs ? 'Available' : 'Fallback'}</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">Native BarcodeDetector</span>
          <span class="qb-stat-value">${caps.barcodeDetector ? 'Supported' : 'Not Present'}</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">Storage Quota</span>
          <span class="qb-stat-value">${caps.storageQuotaBytes ? formatBytes(caps.storageQuotaBytes) : 'N/A'}</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">Last QR Render</span>
          <span class="qb-stat-value">${(diag.lastQrRenderMs || 0).toFixed(2)} ms</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">Last QR Decode</span>
          <span class="qb-stat-value">${(diag.lastQrDecodeMs || 0).toFixed(2)} ms</span>
        </div>
      </div>

      <div style="margin-top:0.75rem;display:flex;justify-content:flex-end;">
        <button type="button" id="qb-export-diag-btn" class="qb-btn qb-btn-secondary">
          Export Sanitized Diagnostic Report (.json)
        </button>
      </div>
    </div>

    <!-- 7. HELP -->
    <div class="qb-settings-section" data-section="help" style="display:none;font-size:0.86rem;line-height:1.6;">
      <h4 style="font-weight:700;margin-bottom:0.25rem;">Quick Start &amp; Camera Alignment</h4>
      <p style="color:var(--qb-text-secondary);margin-bottom:0.75rem;">
        1. On the sending device, open <strong>Send Files</strong>, choose a file, and click <strong>Start Optical Transmission</strong>.<br/>
        2. On the receiving device, open <strong>Receive Files</strong>, click <strong>Start Camera Scanner</strong>, and hold the camera parallel to the sender screen so all QR codes fit comfortably inside the dashed guide.<br/>
        3. Keep the sender screen brightness at 80–100% and avoid direct reflections. If 4-QR mode is hard for an older webcam to focus on, switch Panels to <strong>2 QR</strong> or <strong>1 QR</strong>.
      </p>
      <h4 style="font-weight:700;margin-bottom:0.25rem;">Why 60 FPS Display ≠ 60 FPS Transfer</h4>
      <p style="color:var(--qb-text-secondary);">
        Camera rolling shutter, exposure time, and frame decoding latency mean 15–30 FPS with 4 QR panels typically yields higher verified byte throughput than 60 FPS. Use the <strong>Calibration Stream</strong> to measure actual useful throughput on your device pair.
      </p>
    </div>
  `;

  // Tab switching inside settings modal
  const tabs = containerEl.querySelectorAll('.qb-settings-tab');
  const sections = containerEl.querySelectorAll('.qb-settings-section');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      sections.forEach((sec) => {
        sec.style.display = sec.getAttribute('data-section') === target ? 'block' : 'none';
      });
    });
  });

  // Bind controls
  const bindSelect = (id, key, transform = (v) => v) => {
    const el = containerEl.querySelector(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      appState.updatePreferences({ [key]: transform(e.target.value) });
      if (onPreferencesUpdated) onPreferencesUpdated();
    });
  };

  const bindCheckbox = (id, key) => {
    const el = containerEl.querySelector(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      appState.updatePreferences({ [key]: Boolean(e.target.checked) });
      if (onPreferencesUpdated) onPreferencesUpdated();
    });
  };

  bindSelect('#qb-set-theme', 'theme');
  bindSelect('#qb-set-accent', 'accent');
  bindSelect('#qb-set-density', 'density');
  bindCheckbox('#qb-set-motion', 'reducedMotion');
  bindCheckbox('#qb-set-automode', 'autoMode');
  bindSelect('#qb-set-qr-density', 'qrDensity');
  bindSelect('#qb-set-ec', 'ecLevel');
  bindSelect('#qb-set-redundancy', 'redundancyPercent', (v) => Math.max(10, Math.min(200, Number(v) || 35)));
  bindSelect('#qb-set-wire', 'wireEncoding');
  bindSelect('#qb-set-facing', 'preferredFacingMode');
  bindSelect('#qb-set-res', 'preferredResolution');
  bindSelect('#qb-set-decoder', 'decoderEngine');
  bindCheckbox('#qb-set-opfs', 'useOpfsStaging');
  bindSelect('#qb-set-maxsize', 'maxFileSizeMiB', (v) => Math.max(1, Math.min(256, Number(v) || 50)));
  bindCheckbox('#qb-set-encryption', 'enablePasswordEncryption');

  const clearBtn = containerEl.querySelector('#qb-set-clear-storage');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await performFullCleanup();
      showToast('Cleared temporary staging files and Object URLs.', 'success');
    });
  }

  const exportDiagBtn = containerEl.querySelector('#qb-export-diag-btn');
  if (exportDiagBtn) {
    exportDiagBtn.addEventListener('click', () => {
      const report = {
        application: 'QuadBeam Optical File Transfer',
        protocolVersion: 1,
        exportedAt: new Date().toISOString(),
        preferences: appState.preferences,
        capabilities: appState.runtime.capabilities,
        diagnostics: appState.runtime.diagnostics
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      triggerBrowserDownload(blob, 'quadbeam-diagnostics.json', 'application/json');
      showToast('Exported sanitized diagnostic report.', 'success');
    });
  }
}
