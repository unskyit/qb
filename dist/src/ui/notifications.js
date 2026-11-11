/**
 * QuadBeam Accessible Notifications & Screen-Reader Live Region Announcer
 */

import { escapeHtml } from '../utils/sanitization.js';

let toastContainer = null;
let liveRegion = null;

export function initNotifications() {
  if (typeof document === 'undefined') return;
  toastContainer = document.getElementById('qb-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'qb-toast-container';
    toastContainer.className = 'qb-toast-container';
    document.body.appendChild(toastContainer);
  }

  liveRegion = document.getElementById('qb-sr-announcer');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'qb-sr-announcer';
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegion);
  }
}

export function announceStatus(message) {
  if (!liveRegion) initNotifications();
  if (liveRegion) {
    liveRegion.textContent = '';
    setTimeout(() => {
      if (liveRegion) liveRegion.textContent = message;
    }, 30);
  }
}

export function showToast(message, type = 'info', durationMs = 4200) {
  if (typeof document === 'undefined') return;
  if (!toastContainer) initNotifications();

  const toast = document.createElement('div');
  toast.className = `qb-toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <div>${escapeHtml(message)}</div>
    <button type="button" class="qb-btn-icon" style="width:26px;height:26px;min-height:26px;" aria-label="Dismiss notification">&times;</button>
  `;

  const closeBtn = toast.querySelector('button');
  const remove = () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  };
  if (closeBtn) closeBtn.addEventListener('click', remove);

  toastContainer.appendChild(toast);
  announceStatus(message);

  if (durationMs > 0) {
    setTimeout(remove, durationMs);
  }
}
