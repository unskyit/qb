/**
 * QuadBeam Security & Filename Sanitization Utilities
 * Prevents path traversal, control characters, OS reserved filenames, and XSS.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeFilename(rawName, fallback = 'received-file.bin') {
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    return fallback;
  }

  // Strip null bytes and ASCII control characters
  let cleaned = rawName.replace(/[\x00-\x1f\x7f]/g, '');

  // Normalize path separators and take only the final path segment
  // Also strip any '../' or '..\' sequences explicitly
  cleaned = cleaned.replace(/\\/g, '/');
  const segments = cleaned.split('/').filter((seg) => seg && seg !== '.' && seg !== '..');
  cleaned = segments.length > 0 ? segments[segments.length - 1] : '';

  // Remove characters illegal on Windows/macOS/Linux filesystems or dangerous in HTML
  cleaned = cleaned.replace(/[<>:"/\\|?*]/g, '_').trim();

  // Strip leading dots or trailing dots/spaces
  cleaned = cleaned.replace(/^\.+/, '').replace(/[. ]+$/, '');

  if (!cleaned || WINDOWS_RESERVED.test(cleaned)) {
    cleaned = `file_${cleaned || 'transfer.bin'}`;
  }

  // Enforce maximum filename length (200 chars) while preserving extension
  if (cleaned.length > 200) {
    const dotIdx = cleaned.lastIndexOf('.');
    if (dotIdx > 0 && cleaned.length - dotIdx <= 16) {
      const ext = cleaned.slice(dotIdx);
      cleaned = cleaned.slice(0, 200 - ext.length) + ext;
    } else {
      cleaned = cleaned.slice(0, 200);
    }
  }

  return cleaned || fallback;
}

export function sanitizeMimeType(rawMime) {
  if (typeof rawMime !== 'string' || !rawMime.trim()) {
    return 'application/octet-stream';
  }
  const clean = rawMime.trim().toLowerCase();
  if (!/^[a-z0-9!#$&-^_]+\/[a-z0-9!#$&-^_.+]+$/.test(clean) || clean.length > 120) {
    return 'application/octet-stream';
  }
  return clean;
}

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
