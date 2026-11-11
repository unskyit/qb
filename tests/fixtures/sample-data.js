/**
 * QuadBeam Deterministic Test Fixtures
 */

export function generateDeterministicBinary(byteLength, seed = 0x5142) {
  const buf = new Uint8Array(byteLength);
  let state = seed >>> 0;
  for (let i = 0; i < byteLength; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    buf[i] = (state >>> 16) & 0xff;
  }
  // Ensure explicit null bytes and 0xFF high-bit bytes appear when byteLength >= 4
  if (byteLength >= 4) {
    buf[0] = 0x00;
    buf[1] = 0xff;
    buf[byteLength - 2] = 0x00;
    buf[byteLength - 1] = 0xff;
  }
  return buf;
}
