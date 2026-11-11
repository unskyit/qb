/**
 * QuadBeam Reactive Application State & Preferences Store
 * Persists only non-sensitive UI preferences in localStorage (wrapped in try/catch).
 */

import { appEvents } from './events.js';

const STORAGE_KEY = 'quadbeam_preferences_v2';

export const DEFAULT_PREFERENCES = Object.freeze({
  // Appearance
  theme: 'system', // 'light' | 'dark' | 'system'
  accent: 'calm-blue', // 'calm-blue' | 'cobalt' | 'cyan'
  compactMode: true,
  reducedMotion: false,
  density: 'compact', // 'comfortable' | 'compact'

  // Transmission (Sender)
  autoMode: false, // Honor selected QR count directly while sizing squares cleanly to viewport
  profile: 'balanced', // 'reliable' | 'balanced' | 'turbo' | 'custom'
  qrCount: 4, // 1 | 2 | 4 | 6
  fps: 15, // 5 | 10 | 15 | 20 | 30 | 60
  qrDensity: 'medium', // 'low' (110B) | 'medium' (160B) | 'high' (240B)
  ecLevel: 'M', // 'L' | 'M' | 'Q' | 'H'
  redundancyPercent: 35,
  wireEncoding: 'base45', // 'base45' | 'byte'
  highContrastQr: false,
  keepScreenAwake: true,
  experimentalTurbo: false,

  // Camera & Receiver Input
  receiverQrCount: 4, // 0 ('Auto') | 1 | 2 | 4 | 6
  preferredFacingMode: 'environment', // 'environment' | 'user'
  preferredResolution: '1080p', // '720p' | '1080p' | '4k'
  mirrorPreview: false,
  decoderEngine: 'auto', // 'auto' | 'pure-js'

  // Storage & Limits
  defaultSaveBehavior: 'picker', // 'picker' | 'download'
  useOpfsStaging: true,
  maxFileSizeMiB: 50,

  // Privacy
  enablePasswordEncryption: false
});

export class AppStateStore {
  constructor() {
    this.preferences = this.loadPreferences();
    this.runtime = {
      activeView: 'home', // 'home' | 'send' | 'receive'
      transferState: 'idle',
      capabilities: null,
      senderQueue: [],
      activeSenderIndex: 0,
      receiverSession: null,
      diagnostics: {
        framesCapturedFps: 0,
        framesDecodedFps: 0,
        validPacketsPerSec: 0,
        usefulPayloadBytesPerSec: 0,
        decodeSuccessRate: 0,
        checksumErrors: 0,
        duplicatePackets: 0,
        activeDecoderName: 'Auto (BarcodeDetector + ISO-18004 JS)',
        lastQrRenderMs: 0,
        lastQrDecodeMs: 0
      }
    };
  }

  loadPreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return { ...DEFAULT_PREFERENCES, ...parsed };
        }
      }
    } catch {
      // Ignore storage access errors in sandboxed iframes
    }
    return { ...DEFAULT_PREFERENCES };
  }

  savePreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
      }
    } catch {
      // Ignore storage errors
    }
  }

  updatePreferences(patch) {
    this.preferences = { ...this.preferences, ...patch };
    this.savePreferences();
    appEvents.emit('preferences:changed', this.preferences);
    return this.preferences;
  }

  resetPreferences() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.savePreferences();
    appEvents.emit('preferences:changed', this.preferences);
    return this.preferences;
  }

  setRuntime(patch) {
    Object.assign(this.runtime, patch);
    appEvents.emit('runtime:changed', this.runtime);
  }

  updateDiagnostics(patch) {
    Object.assign(this.runtime.diagnostics, patch);
    appEvents.emit('diagnostics:changed', this.runtime.diagnostics);
  }
}

export const appState = new AppStateStore();
