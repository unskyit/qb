/**
 * QuadBeam Formatting Utilities
 * Exact binary unit formatting (KiB, MiB) and throughput/duration formatters.
 */

export function formatBytes(bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  if (i === 0) return `${Math.round(bytes)} B`;
  return `${(bytes / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
}

export function formatThroughput(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0.0 KB/s';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KiB/s`;
  }
  return `${(kb / 1024).toFixed(2)} MiB/s`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Calibrating...';
  const s = Math.ceil(seconds);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  if (mins < 60) {
    return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatPercent(ratio, decimals = 1) {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const pct = Math.min(100, Math.max(0, ratio * 100));
  if (pct >= 100) return '100%';
  return `${pct.toFixed(decimals)}%`;
}

export function getFileExtension(filename) {
  if (typeof filename !== 'string') return 'BIN';
  const base = filename.split(/[\\/]/).pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return 'BIN';
  return base.slice(idx + 1).toUpperCase().slice(0, 8);
}
