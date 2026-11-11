/**
 * QuadBeam OPFS & Bounded Generation Temporary Storage Manager
 *
 * Uses Origin Private File System (`navigator.storage.getDirectory()`) when available
 * so 50 MiB transfers stage completed generations directly to temporary disk storage
 * rather than keeping all packets and reconstructed blocks in RAM.
 * Falls back cleanly to consolidated generation buffers in environments without OPFS.
 */

import { QuadBeamError, ERROR_CODES } from '../core/errors.js';

const OPFS_DIR_NAME = 'quadbeam_staging_v1';

export class TemporaryStorageManager {
  constructor(options = {}) {
    this.preferOpfs = options.preferOpfs !== false;
    this.opfsAvailable = Boolean(
      this.preferOpfs &&
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
    this.memoryStore = new Map(); // fileKey -> Map(genId -> Uint8Array)
    this.activeBytesStaged = 0;
  }

  async checkQuotaForSize(requiredBytes) {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        if (est.quota && est.usage !== undefined) {
          const available = est.quota - est.usage;
          if (available < requiredBytes * 1.1) {
            throw new QuadBeamError(
              ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
              `Insufficient browser temporary storage (${Math.round(available / (1024 * 1024))} MiB free, ${Math.round(requiredBytes / (1024 * 1024))} MiB required).`,
              'Clear temporary storage in Settings → Storage or free up disk space.'
            );
          }
        }
      } catch (err) {
        if (err instanceof QuadBeamError) throw err;
      }
    }
    return true;
  }

  async _getStagingDir() {
    if (!this.opfsAvailable) return null;
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    } catch {
      this.opfsAvailable = false;
      return null;
    }
  }

  _fileKey(sessionId, fileId) {
    return `qb_${sessionId >>> 0}_${fileId >>> 0}`;
  }

  /**
   * Persist a completed generation's contiguous byte array to OPFS (or consolidated memory slot).
   */
  async writeGeneration(sessionId, fileId, generationId, contiguousBytes) {
    const key = this._fileKey(sessionId, fileId);
    const dir = await this._getStagingDir();

    if (dir) {
      try {
        const fileDir = await dir.getDirectoryHandle(key, { create: true });
        const handle = await fileDir.getFileHandle(`gen_${generationId}.bin`, { create: true });
        if (typeof handle.createWritable === 'function') {
          const writable = await handle.createWritable();
          await writable.write(contiguousBytes);
          await writable.close();
          this.activeBytesStaged += contiguousBytes.byteLength;
          return { backend: 'opfs', bytes: contiguousBytes.byteLength };
        }
      } catch {
        // Fall through to consolidated memory store if OPFS writable fails
      }
    }

    if (!this.memoryStore.has(key)) {
      this.memoryStore.set(key, new Map());
    }
    const genMap = this.memoryStore.get(key);
    if (!genMap.has(generationId)) {
      this.activeBytesStaged += contiguousBytes.byteLength;
    }
    genMap.set(generationId, contiguousBytes);
    return { backend: 'memory-consolidated', bytes: contiguousBytes.byteLength };
  }

  /**
   * Read a single generation back as a Uint8Array (for streaming SHA-256 verification or export).
   */
  async readGeneration(sessionId, fileId, generationId) {
    const key = this._fileKey(sessionId, fileId);
    const genMap = this.memoryStore.get(key);
    if (genMap && genMap.has(generationId)) {
      return genMap.get(generationId);
    }

    const dir = await this._getStagingDir();
    if (dir) {
      try {
        const fileDir = await dir.getDirectoryHandle(key, { create: false });
        const handle = await fileDir.getFileHandle(`gen_${generationId}.bin`, { create: false });
        const file = await handle.getFile();
        const ab = await file.arrayBuffer();
        return new Uint8Array(ab);
      } catch (err) {
        throw new QuadBeamError(
          ERROR_CODES.STORAGE_EVICTED,
          `Temporary storage for generation ${generationId} could not be read: ${err?.message || err}`,
          'Avoid clearing browser site data while a transfer is in progress.'
        );
      }
    }

    throw new QuadBeamError(
      ERROR_CODES.STORAGE_EVICTED,
      `Missing staged generation ${generationId}`
    );
  }

  /**
   * Assemble a Blob (or Uint8Array in Node.js) across all `totalGenerations` without duplicating RAM
   * when OPFS File handles are available (Blob can reference File slices on disk!).
   */
  async assembleFileBlob(sessionId, fileId, totalGenerations, mimeType = 'application/octet-stream') {
    const key = this._fileKey(sessionId, fileId);
    const parts = [];
    const dir = await this._getStagingDir();

    for (let g = 0; g < totalGenerations; g++) {
      const genMap = this.memoryStore.get(key);
      if (genMap && genMap.has(g)) {
        parts.push(genMap.get(g));
        continue;
      }
      if (dir) {
        const fileDir = await dir.getDirectoryHandle(key, { create: false });
        const handle = await fileDir.getFileHandle(`gen_${g}.bin`, { create: false });
        const file = await handle.getFile(); // File is a Blob backed by disk!
        parts.push(file);
        continue;
      }
      throw new QuadBeamError(ERROR_CODES.STORAGE_EVICTED, `Generation ${g} missing during file assembly`);
    }

    if (typeof Blob !== 'undefined') {
      return new Blob(parts, { type: mimeType });
    }
    // Node.js fallback if Blob is not used
    const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
    const out = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.byteLength;
    }
    return out;
  }

  async deleteSessionStaging(sessionId, fileId) {
    const key = this._fileKey(sessionId, fileId);
    if (this.memoryStore.has(key)) {
      const genMap = this.memoryStore.get(key);
      for (const buf of genMap.values()) {
        this.activeBytesStaged = Math.max(0, this.activeBytesStaged - buf.byteLength);
      }
      this.memoryStore.delete(key);
    }

    const dir = await this._getStagingDir();
    if (dir && typeof dir.removeEntry === 'function') {
      try {
        await dir.removeEntry(key, { recursive: true });
      } catch {
        // Ignore if not present
      }
    }
  }

  async clearAll() {
    this.memoryStore.clear();
    this.activeBytesStaged = 0;
    if (this.opfsAvailable && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(OPFS_DIR_NAME, { recursive: true });
      } catch {
        // Ignore if directory didn't exist
      }
    }
  }
}

export const tempStorage = new TemporaryStorageManager();
