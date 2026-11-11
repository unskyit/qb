/**
 * QuadBeam Optical Data Protocol Constants (Protocol v1)
 */

export const PROTOCOL_MAGIC = 0x5142; // 'QB' in ASCII
export const PROTOCOL_VERSION = 1;
export const PACKET_HEADER_SIZE = 24;
export const PACKET_CRC_SIZE = 4;
export const PACKET_OVERHEAD_SIZE = PACKET_HEADER_SIZE + PACKET_CRC_SIZE; // 28 bytes

export const PACKET_TYPE = Object.freeze({
  METADATA: 0x01,
  SOURCE_BLOCK: 0x02,
  FOUNTAIN_BLOCK: 0x03,
  CALIBRATION: 0x04,
  REPAIR_REQUEST: 0x05,
  EOF_HEARTBEAT: 0x06
});

export const PACKET_FLAGS = Object.freeze({
  ENCRYPTED: 1 << 6,
  COMPRESSED: 1 << 7
});

export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
export const HARD_MAX_FILE_SIZE = 256 * 1024 * 1024; // 256 MiB
export const MAX_METADATA_BYTES = 2048;
export const MAX_PACKET_PAYLOAD_BYTES = 2048;

// Divide large files (up to 50 MiB) into bounded generations of up to 256 blocks
// so LT Fountain peeling/Gaussian elimination runs in O(1) bounded memory per generation.
export const DEFAULT_GENERATION_BLOCKS = 256;

export const TRANSMISSION_PROFILES = Object.freeze({
  reliable: {
    id: 'reliable',
    name: 'Reliable',
    description: 'Low QR density, fewer panels, longer frame dwell time for difficult lighting or older cameras.',
    qrCount: 1,
    fps: 10,
    blockSize: 140,
    ecLevel: 'M',
    redundancyPercent: 45
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'Optimal balance of 4-QR density, error resilience, and steady capture throughput.',
    qrCount: 4,
    fps: 15,
    blockSize: 220,
    ecLevel: 'M',
    redundancyPercent: 35
  },
  turbo: {
    id: 'turbo',
    name: 'Turbo',
    description: 'High-density 4-QR stream at 30 FPS for modern high-shutter cameras and large screens.',
    qrCount: 4,
    fps: 30,
    blockSize: 320,
    ecLevel: 'L',
    redundancyPercent: 30
  }
});

export const SUPPORTED_FPS = Object.freeze([5, 10, 15, 20, 30, 60]);
export const SUPPORTED_QR_COUNTS = Object.freeze([1, 2, 4]);
export const DENSITY_BLOCK_SIZES = Object.freeze({
  low: 140,
  medium: 220,
  high: 320
});
