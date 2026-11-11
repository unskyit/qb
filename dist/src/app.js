/**
 * QuadBeam Root Application Controller
 * Integrates Home, Send Files, Receive Files, Settings, PWA installation,
 * Theme management, Mobile lifecycle handling, and End-to-End 1/2/4/6-QR Optical Loopback Verification.
 */

import { detectCapabilities } from './core/capability-detector.js';
import { appState } from './core/state.js';
import { appEvents } from './core/events.js';
import { SenderController } from './sender/sender-controller.js';
import { getGridDimensionsForCount } from './sender/transmission-settings.js';
import { ScannerController } from './receiver/scanner-controller.js';
import { renderHomeView } from './ui/home.js';
import { renderSendView } from './ui/send-view.js';
import { renderReceiveView } from './ui/receive-view.js';
import { renderSettingsModalContent } from './ui/settings.js';
import { updateBottomProgressBar } from './ui/progress.js';
import { modalManager } from './ui/modals.js';
import { initNotifications, showToast } from './ui/notifications.js';

export class QuadBeamApp {
  constructor() {
    this.senderController = new SenderController();
    this.scannerController = new ScannerController();
    this.sendViewApi = null;
    this.receiveViewApi = null;
    this.deferredInstallPrompt = null;
  }

  async init() {
    initNotifications();
    modalManager.init();
    this.applyThemeAndPreferences();

    const capabilities = await detectCapabilities();
    appState.setRuntime({ capabilities });

    this._renderViews();
    this._bindHeaderControls();
    this._bindGlobalEvents();
    this._registerServiceWorker();
  }

  applyThemeAndPreferences() {
    if (typeof document === 'undefined') return;
    const prefs = appState.preferences;
    const root = document.documentElement;

    let effectiveTheme = prefs.theme;
    if (effectiveTheme === 'system') {
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = prefersDark ? 'dark' : 'light';
    }

    root.setAttribute('data-theme', effectiveTheme);
    root.setAttribute('data-accent', prefs.accent || 'calm-blue');
    root.setAttribute('data-density', prefs.density || 'compact');
    root.setAttribute('data-reduced-motion', String(Boolean(prefs.reducedMotion)));

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#050608' : '#F7F9FC');
    }

    const sendPwdWrap = document.getElementById('qb-send-password-wrap');
    if (sendPwdWrap) {
      sendPwdWrap.style.display = prefs.enablePasswordEncryption ? 'inline-flex' : 'none';
    }
  }

  navigateTo(viewName) {
    appState.setRuntime({ activeView: viewName });
    const views = {
      home: document.getElementById('qb-view-home'),
      send: document.getElementById('qb-view-send'),
      receive: document.getElementById('qb-view-receive')
    };

    for (const [k, el] of Object.entries(views)) {
      if (el) el.classList.toggle('active', k === viewName);
    }

    document.querySelectorAll('.qb-mode-tab').forEach((btn) => {
      const target = btn.getAttribute('data-view');
      btn.classList.toggle('active', target === viewName);
      btn.setAttribute('aria-selected', String(target === viewName));
    });

    if (viewName === 'send' && this.sendViewApi) {
      setTimeout(() => {
        const dims = this.sendViewApi.getStageDims();
        this.senderController.reconfigureLiveLayout(
          dims.viewportWidth,
          dims.viewportHeight,
          dims.isFullscreen,
          dims.stageWidth,
          dims.stageHeight
        );
      }, 20);
    } else if (viewName === 'receive' && this.receiveViewApi) {
      this.receiveViewApi.updateReticleGrid(appState.preferences.receiverQrCount ?? 4);
    }
  }

  _renderViews() {
    const homeEl = document.getElementById('qb-view-home');
    const sendEl = document.getElementById('qb-view-send');
    const receiveEl = document.getElementById('qb-view-receive');

    renderHomeView(homeEl, {
      onNavigate: (target) => this.navigateTo(target)
    });

    this.sendViewApi = renderSendView(sendEl, {
      senderController: this.senderController,
      onRunLoopbackTest: () => this.runOpticalLoopbackVerification(),
      onOpenRepairModal: () => this._openRepairInputModal()
    });

    this.receiveViewApi = renderReceiveView(receiveEl, {
      scannerController: this.scannerController
    });
  }

  _bindHeaderControls() {
    const brandEl = document.getElementById('qb-brand-home');
    if (brandEl) {
      brandEl.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigateTo('home');
      });
    }

    document.querySelectorAll('.qb-mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view) this.navigateTo(view);
      });
    });

    const themeBtn = document.getElementById('qb-header-theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        appState.updatePreferences({ theme: next });
        this.applyThemeAndPreferences();
        showToast(`Theme: ${next === 'dark' ? 'Dark AMOLED' : 'Light'}`, 'info', 1600);
      });
    }

    const helpBtn = document.getElementById('qb-header-help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        modalManager.open('QuadBeam Settings & Guide', (bodyEl) => {
          renderSettingsModalContent(bodyEl, {
            onPreferencesUpdated: () => this.applyThemeAndPreferences()
          });
          const helpTab = bodyEl.querySelector('[data-tab="help"]');
          if (helpTab) helpTab.click();
        });
      });
    }

    const settingsBtn = document.getElementById('qb-header-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        modalManager.open('QuadBeam Settings & Diagnostics', (bodyEl) => {
          renderSettingsModalContent(bodyEl, {
            onPreferencesUpdated: () => this.applyThemeAndPreferences()
          });
        });
      });
    }

    const installBtn = document.getElementById('qb-header-install-btn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (installBtn) installBtn.style.display = 'inline-flex';
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!this.deferredInstallPrompt) return;
        this.deferredInstallPrompt.prompt();
        await this.deferredInstallPrompt.userChoice;
        this.deferredInstallPrompt = null;
        installBtn.style.display = 'none';
      });
    }
  }

  _bindGlobalEvents() {
    const progressEl = document.getElementById('qb-bottom-progress');

    appEvents.on('sender:frame-rendered', (stats) => {
      if (this.sendViewApi) this.sendViewApi.updateTelemetry(stats);
      updateBottomProgressBar(progressEl, {
        mode: 'sender',
        transferState: appState.runtime.transferState,
        senderStats: stats,
        onPauseResume: () => {
          if (appState.runtime.transferState === 'paused') this.senderController.resume();
          else this.senderController.pause();
        },
        onStop: () => this.senderController.stop()
      });
    });

    appEvents.on('receiver:progress', (stats) => {
      if (this.receiveViewApi) this.receiveViewApi.updateReceiverUI(stats);
      updateBottomProgressBar(progressEl, {
        mode: 'receiver',
        transferState: appState.runtime.transferState,
        receiverStats: stats,
        onPauseResume: () => {
          if (this.scannerController.isScanning) this.scannerController.pauseScanning();
          else this.scannerController.resumeScanning();
        },
        onStop: () => this.scannerController.stopReceiving(false)
      });
    });

    appEvents.on('receiver:completed', (stats) => {
      if (this.receiveViewApi) this.receiveViewApi.updateReceiverUI(stats);
      updateBottomProgressBar(progressEl, {
        mode: 'idle',
        transferState: 'idle'
      });
      showToast(`Verified "${stats.filename}" (SHA-256 matched)!`, 'success', 4500);
    });

    appEvents.on('receiver:calibration-update', (summary) => {
      if (this.receiveViewApi && summary.ready) {
        this.receiveViewApi.showCalibrationSummary(summary);
      }
    });

    window.addEventListener('resize', () => {
      if (appState.runtime.activeView === 'send' && this.sendViewApi) {
        const dims = this.sendViewApi.getStageDims();
        this.senderController.reconfigureLiveLayout(
          dims.viewportWidth,
          dims.viewportHeight,
          dims.isFullscreen,
          dims.stageWidth,
          dims.stageHeight
        );
      } else if (appState.runtime.activeView === 'receive' && this.receiveViewApi) {
        this.receiveViewApi.updateReticleGrid(appState.preferences.receiverQrCount ?? 4);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.scannerController.isScanning) {
        this.scannerController.pauseScanning();
        showToast('Paused scanning in background. Received blocks preserved.', 'info', 2500);
      }
    });
  }

  _openRepairInputModal() {
    modalManager.open('Apply Receiver Repair Request Code', (bodyEl) => {
      bodyEl.innerHTML = `
        <p style="font-size:0.82rem;color:var(--qb-text-secondary);">
          Paste the Base45 Repair Request code generated on the Receiver screen to prioritize transmitting only the missing blocks:
        </p>
        <input type="text" id="qb-modal-repair-input" class="qb-input qb-mono" placeholder="Paste Repair QR string..." style="width:100%;" />
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button type="button" id="qb-modal-repair-apply" class="qb-btn qb-btn-primary">Apply Targeted Repair</button>
        </div>
      `;
      const input = bodyEl.querySelector('#qb-modal-repair-input');
      const applyBtn = bodyEl.querySelector('#qb-modal-repair-apply');
      applyBtn.addEventListener('click', () => {
        try {
          const res = this.senderController.applyReceiverRepairCode(input.value);
          modalManager.close();
          showToast(`Targeted repair queued for ${res.missingBlockIndices.length} missing blocks.`, 'success');
        } catch (err) {
          showToast(err?.message || 'Invalid repair code', 'error');
        }
      });
    });
  }

  /**
   * Run end-to-end Optical Loopback Verification across 1, 2, 4, or 6 QR panels.
   */
  async runOpticalLoopbackVerification() {
    const activeItem = this.senderController.getActiveItem();
    if (!activeItem) {
      showToast('Select or load a sample file first.', 'info');
      return;
    }

    try {
      this.scannerController.resetSession();
      const dims = this.sendViewApi ? this.sendViewApi.getStageDims() : {
        viewportWidth: window.innerWidth || 1024,
        viewportHeight: window.innerHeight || 768,
        stageWidth: 0,
        stageHeight: 0,
        isFullscreen: false
      };

      await this.senderController.startTransmission(dims);
      this.senderController.frameScheduler.pause();

      const qrCount = this.senderController.activeConfig.qrCount;
      showToast(`Loopback verifying ${qrCount}-QR stream (10% simulated frame drop)...`, 'info', 2500);

      const compositeCanvas = document.createElement('canvas');
      const ctx = compositeCanvas.getContext('2d', { willReadFrequently: true });

      let safetyFrames = 0;
      const maxFrames = Math.max(40, this.senderController.packetScheduler.totalBlocks * 3);

      while (
        this.scannerController.reconstructor.state !== 'completed' &&
        safetyFrames < maxFrames
      ) {
        safetyFrames++;
        await this.senderController._renderNextTransmissionFrame();
        const qrCanvases = this.senderController.gridRenderer.canvases;
        if (!qrCanvases || qrCanvases.length === 0) break;

        const pSize = qrCanvases[0].width;
        const gap = 12;
        const { cols, rows } = getGridDimensionsForCount(qrCanvases.length, true);

        compositeCanvas.width = cols * pSize + (cols + 1) * gap;
        compositeCanvas.height = rows * pSize + (rows + 1) * gap;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

        for (let i = 0; i < qrCanvases.length; i++) {
          const c = i % cols;
          const r = Math.floor(i / cols);
          ctx.drawImage(qrCanvases[i], gap + c * (pSize + gap), gap + r * (pSize + gap));
        }

        if (safetyFrames > 1 && safetyFrames % 10 === 0) {
          continue; // Simulate 10% camera frame drop
        }

        const imgData = ctx.getImageData(0, 0, compositeCanvas.width, compositeCanvas.height);
        await this.scannerController.processExternalImageData(
          imgData,
          performance.now(),
          qrCanvases.length
        );

        if (safetyFrames % 4 === 0) {
          await new Promise((r) => setTimeout(r, 8));
        }
      }

      this.senderController.stop();
      if (this.scannerController.reconstructor.state === 'completed') {
        this.navigateTo('receive');
        if (this.receiveViewApi) {
          this.receiveViewApi.updateReceiverUI(this.scannerController.getReceiverStats());
        }
      } else {
        showToast('Loopback stopped before completion.', 'error');
      }
    } catch (err) {
      showToast(err?.message || 'Loopback test failed', 'error');
    }
  }

  _registerServiceWorker() {
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
          // Ignore registration errors in restricted preview iframes
        });
      });
    }
  }
}
