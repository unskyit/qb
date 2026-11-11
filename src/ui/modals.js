/**
 * QuadBeam Modal Dialog Manager (Settings, Help, and Repair Code Input)
 */

export class ModalManager {
  constructor() {
    this.backdropEl = null;
    this.titleEl = null;
    this.bodyEl = null;
  }

  init() {
    if (typeof document === 'undefined') return;
    this.backdropEl = document.getElementById('qb-modal-backdrop');
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.id = 'qb-modal-backdrop';
      this.backdropEl.className = 'qb-modal-backdrop';
      this.backdropEl.setAttribute('role', 'dialog');
      this.backdropEl.setAttribute('aria-modal', 'true');
      this.backdropEl.innerHTML = `
        <div class="qb-modal">
          <div class="qb-modal-header">
            <h3 id="qb-modal-title" style="font-size:1.1rem;font-weight:700;">Settings</h3>
            <button type="button" id="qb-modal-close-btn" class="qb-btn-icon" aria-label="Close modal">&times;</button>
          </div>
          <div id="qb-modal-body" class="qb-modal-body"></div>
        </div>
      `;
      document.body.appendChild(this.backdropEl);

      const closeBtn = this.backdropEl.querySelector('#qb-modal-close-btn');
      closeBtn.addEventListener('click', () => this.close());
      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl.classList.contains('open')) {
          this.close();
        }
      });
    }
    this.titleEl = this.backdropEl.querySelector('#qb-modal-title');
    this.bodyEl = this.backdropEl.querySelector('#qb-modal-body');
  }

  open(title, renderBodyFn) {
    if (!this.backdropEl) this.init();
    if (!this.backdropEl) return;
    this.titleEl.textContent = title;
    this.bodyEl.innerHTML = '';
    renderBodyFn(this.bodyEl);
    this.backdropEl.classList.add('open');
  }

  close() {
    if (this.backdropEl) {
      this.backdropEl.classList.remove('open');
    }
  }
}

export const modalManager = new ModalManager();
