/**
 * QuadBeam Error Hierarchy & Actionable Recovery Guidance
 */

export const ERROR_CODES = Object.freeze({
  CAMERA_PERMISSION_DENIED: 'CAMERA_PERMISSION_DENIED',
  CAMERA_NOT_FOUND: 'CAMERA_NOT_FOUND',
  CAMERA_DISCONNECTED: 'CAMERA_DISCONNECTED',
  CAMERA_INSECURE_CONTEXT: 'CAMERA_INSECURE_CONTEXT',
  PROTOCOL_INVALID_MAGIC: 'PROTOCOL_INVALID_MAGIC',
  PROTOCOL_UNSUPPORTED_VERSION: 'PROTOCOL_UNSUPPORTED_VERSION',
  PROTOCOL_CHECKSUM_MISMATCH: 'PROTOCOL_CHECKSUM_MISMATCH',
  PROTOCOL_TRUNCATED_PACKET: 'PROTOCOL_TRUNCATED_PACKET',
  PROTOCOL_OVERSIZED_METADATA: 'PROTOCOL_OVERSIZED_METADATA',
  PROTOCOL_SESSION_MISMATCH: 'PROTOCOL_SESSION_MISMATCH',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_READ_FAILED: 'FILE_READ_FAILED',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_EVICTED: 'STORAGE_EVICTED',
  INTEGRITY_HASH_MISMATCH: 'INTEGRITY_HASH_MISMATCH',
  RECONSTRUCTION_INCOMPLETE: 'RECONSTRUCTION_INCOMPLETE',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  DECODER_INIT_FAILED: 'DECODER_INIT_FAILED'
});

export class QuadBeamError extends Error {
  constructor(code, message, recoveryHint = '', details = null) {
    super(message);
    this.name = 'QuadBeamError';
    this.code = code;
    this.recoveryHint = recoveryHint;
    this.details = details;
    this.timestamp = Date.now();
  }
}

export function describeCameraError(err) {
  if (!globalThis.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return new QuadBeamError(
      ERROR_CODES.CAMERA_INSECURE_CONTEXT,
      'Camera access requires a secure HTTPS connection or localhost.',
      'Open QuadBeam via https:// (such as your GitHub Pages URL) or http://localhost.'
    );
  }
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new QuadBeamError(
      ERROR_CODES.CAMERA_PERMISSION_DENIED,
      'Camera permission was denied by the browser.',
      'Click the camera or lock icon in your browser address bar, allow Camera access, and click Retry Camera.'
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new QuadBeamError(
      ERROR_CODES.CAMERA_NOT_FOUND,
      'No compatible camera device was detected on this system.',
      'Connect a webcam or use the Simulated Optical Loopback / File Frame Scanner for testing.'
    );
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new QuadBeamError(
      ERROR_CODES.CAMERA_DISCONNECTED,
      'The selected camera is currently in use by another application or disconnected.',
      'Close other apps using the camera or switch to another camera from the selector.'
    );
  }
  return new QuadBeamError(
    ERROR_CODES.CAMERA_DISCONNECTED,
    err?.message || 'Unable to start camera stream.',
    'Try selecting another camera or refreshing permissions.'
  );
}
