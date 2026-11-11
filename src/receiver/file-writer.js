/**
 * QuadBeam Receiver File Writer & Post-Export Cleanup
 */

import {
  saveReconstructedFile,
  triggerBrowserDownload,
  shareReconstructedFile,
  isIosSafari
} from '../storage/download-manager.js';

export class VerifiedFileWriter {
  constructor(reconstructor) {
    this.reconstructor = reconstructor;
  }

  async saveWithPicker() {
    this._assertVerified();
    return saveReconstructedFile({
      blob: this.reconstructor.reconstructedBlob,
      filename: this.reconstructor.metadata.filename,
      mimeType: this.reconstructor.metadata.mimeType,
      preferPicker: true
    });
  }

  downloadDirect() {
    this._assertVerified();
    return triggerBrowserDownload(
      this.reconstructor.reconstructedBlob,
      this.reconstructor.metadata.filename,
      this.reconstructor.metadata.mimeType
    );
  }

  async shareFile() {
    this._assertVerified();
    return shareReconstructedFile({
      blob: this.reconstructor.reconstructedBlob,
      filename: this.reconstructor.metadata.filename,
      mimeType: this.reconstructor.metadata.mimeType
    });
  }

  needsIosSaveGuidance() {
    return isIosSafari();
  }

  _assertVerified() {
    if (
      !this.reconstructor ||
      this.reconstructor.state !== 'completed' ||
      !this.reconstructor.verificationResult?.verified ||
      !this.reconstructor.reconstructedBlob
    ) {
      throw new Error('Refusing to save file: SHA-256 integrity verification has not completed.');
    }
  }
}
