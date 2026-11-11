/**
 * QuadBeam Compact Camera Picker & Scanner Input Control Bar
 * Includes Camera Device Selector, Flip/Prev/Next, Mirror, Torch, Zoom, Exposure.
 */

import { escapeHtml } from '../utils/sanitization.js';

export function renderCameraControls(containerEl, {
  devices = [],
  activeDeviceId = null,
  capabilities = {},
  mirrored = false,
  onSelectDevice,
  onNextCamera,
  onPrevCamera,
  onToggleFacing,
  onToggleTorch,
  onChangeZoom,
  onChangeExposure,
  onToggleMirror
}) {
  if (!containerEl) return;

  const deviceOptions =
    devices.length > 0
      ? devices
          .map(
            (d, idx) =>
              `<option value="${escapeHtml(d.deviceId)}" ${
                d.deviceId === activeDeviceId ? 'selected' : ''
              }>${escapeHtml(d.label || `Camera ${idx + 1}`)}</option>`
          )
          .join('')
      : `<option value="">Default Camera</option>`;

  const showTorch = Boolean(capabilities?.torch);
  const zoomCap = capabilities?.zoom;
  const evCap = capabilities?.exposureCompensation;

  containerEl.innerHTML = `
    <div class="qb-toolbar-group" style="width:100%;justify-content:space-between;">
      <div class="qb-toolbar-group">
        <label for="qb-camera-select" class="sr-only">Select Camera</label>
        <select id="qb-camera-select" class="qb-select" aria-label="Select camera device" style="max-width:145px;">
          ${deviceOptions}
        </select>
        <button type="button" id="qb-cam-prev-btn" class="qb-btn qb-btn-secondary" title="Previous Camera" aria-label="Previous Camera">Prev</button>
        <button type="button" id="qb-cam-next-btn" class="qb-btn qb-btn-secondary" title="Next Camera" aria-label="Next Camera">Next</button>
        <button type="button" id="qb-cam-facing-btn" class="qb-btn qb-btn-secondary" title="Flip Front/Rear Camera">Flip</button>
        <button type="button" id="qb-cam-mirror-btn" class="qb-btn qb-btn-secondary ${mirrored ? 'active' : ''}" title="Mirror Preview">Mirror</button>
        ${
          showTorch
            ? `<button type="button" id="qb-cam-torch-btn" class="qb-btn ${
                capabilities.torchActive ? 'qb-btn-primary' : 'qb-btn-secondary'
              }">Torch</button>`
            : ''
        }
      </div>
      <div class="qb-toolbar-group">
        ${
          zoomCap
            ? `<label style="font-size:0.7rem;display:flex;align-items:center;gap:0.25rem;">
                <span>Zm</span>
                <input type="range" id="qb-cam-zoom-range" min="${zoomCap.min}" max="${zoomCap.max}" step="${zoomCap.step}" value="${zoomCap.current}" style="width:60px;"/>
              </label>`
            : ''
        }
        ${
          evCap
            ? `<label style="font-size:0.7rem;display:flex;align-items:center;gap:0.25rem;">
                <span>EV</span>
                <input type="range" id="qb-cam-ev-range" min="${evCap.min}" max="${evCap.max}" step="${evCap.step}" value="${evCap.current}" style="width:60px;"/>
              </label>`
            : ''
        }
      </div>
    </div>
  `;

  const sel = containerEl.querySelector('#qb-camera-select');
  if (sel && onSelectDevice) {
    sel.addEventListener('change', (e) => {
      if (e.target.value) onSelectDevice(e.target.value);
    });
  }

  const prevBtn = containerEl.querySelector('#qb-cam-prev-btn');
  if (prevBtn && onPrevCamera) prevBtn.addEventListener('click', onPrevCamera);

  const nextBtn = containerEl.querySelector('#qb-cam-next-btn');
  if (nextBtn && onNextCamera) nextBtn.addEventListener('click', onNextCamera);

  const facingBtn = containerEl.querySelector('#qb-cam-facing-btn');
  if (facingBtn && onToggleFacing) facingBtn.addEventListener('click', onToggleFacing);

  const mirrorBtn = containerEl.querySelector('#qb-cam-mirror-btn');
  if (mirrorBtn && onToggleMirror) mirrorBtn.addEventListener('click', onToggleMirror);

  const torchBtn = containerEl.querySelector('#qb-cam-torch-btn');
  if (torchBtn && onToggleTorch) {
    torchBtn.addEventListener('click', () => onToggleTorch(!capabilities.torchActive));
  }

  const zoomInput = containerEl.querySelector('#qb-cam-zoom-range');
  if (zoomInput && onChangeZoom) {
    zoomInput.addEventListener('input', (e) => onChangeZoom(Number(e.target.value)));
  }

  const evInput = containerEl.querySelector('#qb-cam-ev-range');
  if (evInput && onChangeExposure) {
    evInput.addEventListener('input', (e) => onChangeExposure(Number(e.target.value)));
  }
}
