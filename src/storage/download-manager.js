/**
 * QuadBeam File Save, Download, & Native Share Manager
 * Supports:
 * 1. File System Access API (`window.showSaveFilePicker`) for direct streaming save
 * 2. Standard browser `<a download>` trigger with automatic ObjectURL cleanup
 * 3. Web Share API (`navigator.share({ files })`) on mobile devices
 */

import { sanitizeFilename } from '../utils/sanitization.js';
import { registerObjectUrl, revokeAllObjectUrls } from './cleanup.js';

export async function saveReconstructedFile({
  blob,
  filename,
  mimeType = 'application/octet-stream',
  preferPicker = true
}) {
  const safeName = sanitizeFilename(filename);

  // 1. Try File System Access API save picker if supported and requested
  if (preferPicker && typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: safeName
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: 'file-system-access', filename: safeName, saved: true };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'canceled', filename: safeName, saved: false };
      }
      // Fall through to standard anchor download if showSaveFilePicker is blocked (e.g. iframe)
    }
  }

  // 2. Standard compatible browser download via Object URL
  return triggerBrowserDownload(blob, safeName, mimeType);
}

export function triggerBrowserDownload(blob, filename, mimeType = 'application/octet-stream') {
  const safeName = sanitizeFilename(filename);
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return { method: 'headless', filename: safeName, saved: true };
  }

  const typedBlob = blob instanceof Blob ? blob : new Blob([blob], { type: mimeType });
  const url = URL.createObjectURL(typedBlob);
  registerObjectUrl(url);

  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return { method: 'browser-download', filename: safeName, saved: true, objectUrl: url };
}

export async function shareReconstructedFile({ blob, filename, mimeType = 'application/octet-stream' }) {
  const safeName = sanitizeFilename(filename);
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File === 'undefined') {
    throw new Error('Web Share API is not supported on this browser.');
  }

  const fileObj = new File([blob], safeName, { type: mimeType });
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [fileObj] })) {
    throw new Error('Sharing this file type is not supported by your operating system.');
  }

  await navigator.share({
    title: safeName,
    text: `Received via QuadBeam Optical Transfer (${safeName})`,
    files: [fileObj]
  });

  return { method: 'web-share', filename: safeName, shared: true };
}

export function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
