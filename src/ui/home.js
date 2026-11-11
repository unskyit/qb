/**
 * QuadBeam Home View & Optical Architecture Logic Overview
 */

export function renderHomeView(containerEl, { onNavigate }) {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <section class="qb-hero">
      <div class="qb-hero-badge">
        <span class="qb-live-dot"></span>
        <span>4-Channel Synchronized Optical Engine · Offline Ready</span>
      </div>
      <h1 class="qb-hero-title">Send files through light.</h1>
      <p class="qb-hero-subtitle">
        No Wi-Fi. No cables. No uploads. Just scan and transfer.
      </p>
    </section>

    <section class="qb-action-grid" aria-label="Primary actions">
      <div class="qb-action-card" id="qb-home-send-card" role="button" tabindex="0" aria-label="Send Files">
        <div>
          <div class="qb-action-card-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 17L17 7"/><path d="M7 7h10v10"/>
            </svg>
          </div>
          <h2 class="qb-action-card-title" style="margin-top:1rem;">Send Files</h2>
          <p class="qb-action-card-desc">Choose a file and display its synchronized 4-QR optical stream.</p>
        </div>
        <div>
          <span class="qb-btn qb-btn-primary" style="width:100%;">
            Send Files
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </span>
        </div>
      </div>

      <div class="qb-action-card" id="qb-home-receive-card" role="button" tabindex="0" aria-label="Receive Files">
        <div>
          <div class="qb-action-card-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M18 18h3v3h-3z"/><path d="M14 19h2"/>
            </svg>
          </div>
          <h2 class="qb-action-card-title" style="margin-top:1rem;">Receive Files</h2>
          <p class="qb-action-card-desc">Use your camera to scan the QR grid, reconstruct the file, and verify its SHA-256 digest.</p>
        </div>
        <div>
          <span class="qb-btn qb-btn-secondary" style="width:100%;">
            Receive Files
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </span>
        </div>
      </div>
    </section>

    <section class="qb-benefits-row" aria-label="Key benefits">
      <div class="qb-benefit-card">
        <div class="qb-benefit-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div>
          <div class="qb-benefit-title">Private optical transfer</div>
          <div class="qb-benefit-sub">Air-gapped screen-to-camera path</div>
        </div>
      </div>

      <div class="qb-benefit-card">
        <div class="qb-benefit-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        </div>
        <div>
          <div class="qb-benefit-title">Works offline</div>
          <div class="qb-benefit-sub">Zero servers, Bluetooth, or Wi-Fi</div>
        </div>
      </div>

      <div class="qb-benefit-card">
        <div class="qb-benefit-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <div>
          <div class="qb-benefit-title">Verified file integrity</div>
          <div class="qb-benefit-sub">Per-packet CRC32 + Full SHA-256</div>
        </div>
      </div>
    </section>

    <section class="qb-panel" style="max-width:920px;margin:0.5rem auto 0;width:100%;">
      <div class="qb-panel-header">
        <h3 class="qb-panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          How QuadBeam's Optical Engine Works
        </h3>
        <span style="font-size:0.78rem;color:var(--qb-text-secondary);font-weight:600;">Protocol v1 (0x5142)</span>
      </div>
      <div class="qb-telemetry-grid">
        <div class="qb-stat-box">
          <span class="qb-stat-label">1. Chunk &amp; Hash</span>
          <span style="font-size:0.83rem;color:var(--qb-text-secondary);">Splits files up to 50 MiB into 256-block generations with streaming SHA-256 digesting.</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">2. LT Fountain Coding</span>
          <span style="font-size:0.83rem;color:var(--qb-text-secondary);">Combines systematic blocks with Robust Soliton parity droplets so missed camera frames heal automatically.</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">3. Base45 4-QR Stream</span>
          <span style="font-size:0.83rem;color:var(--qb-text-secondary);">Encodes binary packets in RFC 9285 Base45 QR Alphanumeric mode (only 3.1% overhead vs 33.3% Base64).</span>
        </div>
        <div class="qb-stat-box">
          <span class="qb-stat-label">4. OPFS &amp; SHA-256 Verify</span>
          <span style="font-size:0.83rem;color:var(--qb-text-secondary);">Stages decoded generations to disk and verifies exact byte-for-byte SHA-256 integrity before saving.</span>
        </div>
      </div>
    </section>
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
