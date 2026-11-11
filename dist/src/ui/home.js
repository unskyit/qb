/**
 * QuadBeam Clean, Fast Single-Screen Home View
 * Minimalist first view with zero scrolling and zero technical clutter.
 */

export function renderHomeView(containerEl, { onNavigate }) {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <div class="qb-home-wrap">
      <section class="qb-hero">
        <div class="qb-hero-badge">
          <span class="qb-live-dot"></span>
          <span>1 · 2 · 4 · 6 QR Optical Engine · Offline Ready</span>
        </div>
        <h1 class="qb-hero-title">Send files through light.</h1>
        <p class="qb-hero-subtitle">
          No Wi-Fi. No cables. No uploads. Choose your QR grid and scan.
        </p>
      </section>

      <section class="qb-action-grid" aria-label="Primary actions">
        <div class="qb-action-card" id="qb-home-send-card" role="button" tabindex="0" aria-label="Send Files">
          <div>
            <div class="qb-action-card-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 17L17 7"/><path d="M7 7h10v10"/>
              </svg>
            </div>
            <h2 class="qb-action-card-title" style="margin-top:0.55rem;">Send Files</h2>
            <p class="qb-action-card-desc">Pick a file and stream 1, 2, 4, or 6 square QR codes.</p>
          </div>
          <span class="qb-btn qb-btn-primary" style="width:100%;">
            Send
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </span>
        </div>

        <div class="qb-action-card" id="qb-home-receive-card" role="button" tabindex="0" aria-label="Receive Files">
          <div>
            <div class="qb-action-card-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M18 18h3v3h-3z"/>
              </svg>
            </div>
            <h2 class="qb-action-card-title" style="margin-top:0.55rem;">Receive Files</h2>
            <p class="qb-action-card-desc">Choose 1, 2, 4, or 6 QR scanner mode and capture via camera.</p>
          </div>
          <span class="qb-btn qb-btn-secondary" style="width:100%;">
            Receive
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </span>
        </div>
      </section>

      <section class="qb-benefits-row" aria-label="Key benefits">
        <div class="qb-benefit-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--qb-accent)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Private optical transfer</span>
        </div>
        <div class="qb-benefit-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--qb-accent)" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/></svg>
          <span>Works 100% offline</span>
        </div>
        <div class="qb-benefit-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--qb-accent)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
          <span>SHA-256 verified</span>
        </div>
      </section>
    </div>
  `;

  const sendCard = containerEl.querySelector('#qb-home-send-card');
  const receiveCard = containerEl.querySelector('#qb-home-receive-card');

  const bindCard = (el, target) => {
    if (!el) return;
    el.addEventListener('click', () => onNavigate(target));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNavigate(target);
      }
    });
  };

  bindCard(sendCard, 'send');
  bindCard(receiveCard, 'receive');
}
