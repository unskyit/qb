#!/usr/bin/env node
/**
 * QuadBeam Icon Generator
 * Generates minimal, high-precision SVG and PNG application icons locally
 * without external binary dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="qb-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#1E3A8A"/>
    </linearGradient>
    <linearGradient id="qb-beam" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#77AAEF"/>
      <stop offset="100%" stop-color="#477FDF"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#qb-bg)"/>
  <!-- Top-left finder quad -->
  <rect x="96" y="96" width="132" height="132" rx="22" fill="none" stroke="#77AAEF" stroke-width="20"/>
  <rect x="134" y="134" width="56" height="56" rx="10" fill="#FFFFFF"/>
  <!-- Top-right finder quad -->
  <rect x="284" y="96" width="132" height="132" rx="22" fill="none" stroke="#77AAEF" stroke-width="20"/>
  <rect x="322" y="134" width="56" height="56" rx="10" fill="#77AAEF"/>
  <!-- Bottom-left finder quad -->
  <rect x="96" y="284" width="132" height="132" rx="22" fill="none" stroke="#77AAEF" stroke-width="20"/>
  <rect x="134" y="322" width="56" height="56" rx="10" fill="#77AAEF"/>
  <!-- Bottom-right optical beam matrix -->
  <rect x="284" y="284" width="132" height="132" rx="22" fill="url(#qb-beam)"/>
  <path d="M318 350 L344 376 L386 324" fill="none" stroke="#FFFFFF" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Center synchronization cross -->
  <circle cx="256" cy="256" r="14" fill="#FFFFFF"/>
</svg>`;

// CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.max(Math.abs(px - cx) - hw + r, 0);
  const dy = Math.max(Math.abs(py - cy) - hh + r, 0);
  return Math.hypot(dx, dy) - r;
}

function renderQuadBeamIcon(size, maskable = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const padScale = maskable ? 0.82 : 1.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalized 0..512 coordinate space
      let nx = x / scale;
      let ny = y / scale;
      if (maskable) {
        nx = (nx - 256) / padScale + 256;
        ny = (ny - 256) / padScale + 256;
      }

      const idx = (y * size + x) * 4;

      // Background rounded rect (or full bleed for maskable)
      const bgDist = maskable ? -10 : sdRoundedBox(nx, ny, 256, 256, 248, 248, 108);
      if (bgDist > 0.8) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }

      const bgAlpha = bgDist > -0.8 ? Math.max(0, Math.min(1, 0.5 - bgDist / 1.6)) : 1;
      const t = (x + y) / (2 * size);
      let r = Math.round(15 + (24 - 15) * t);
      let g = Math.round(23 + (45 - 23) * t);
      let b = Math.round(42 + (108 - 42) * t);

      // Helper to blend color
      const blend = (cr, cg, cb, alpha) => {
        const a = Math.max(0, Math.min(1, alpha));
        r = Math.round(r * (1 - a) + cr * a);
        g = Math.round(g * (1 - a) + cg * a);
        b = Math.round(b * (1 - a) + cb * a);
      };

      // 3 Finder Quads: Top-Left (162,162), Top-Right (350,162), Bottom-Left (162,350)
      const quads = [
        { cx: 162, cy: 162, innerWhite: true },
        { cx: 350, cy: 162, innerWhite: false },
        { cx: 162, cy: 350, innerWhite: false }
      ];

      for (const q of quads) {
        const outerD = sdRoundedBox(nx, ny, q.cx, q.cy, 66, 66, 20);
        const ringD = Math.abs(outerD + 10) - 10;
        if (ringD < 1.0) {
          blend(119, 170, 239, 1 - Math.max(0, ringD));
        }
        const innerD = sdRoundedBox(nx, ny, q.cx, q.cy, 26, 26, 8);
        if (innerD < 1.0) {
          if (q.innerWhite) {
            blend(255, 255, 255, 1 - Math.max(0, innerD));
          } else {
            blend(71, 127, 223, 1 - Math.max(0, innerD));
          }
        }
      }

      // Bottom-right solid beam quad (350, 350)
      const brD = sdRoundedBox(nx, ny, 350, 350, 66, 66, 20);
      if (brD < 1.0) {
        blend(71, 127, 223, 1 - Math.max(0, brD));
        // Inner white module grid pattern (2x2 mini modules)
        const subCenters = [
          [326, 326], [374, 326],
          [326, 374], [374, 374]
        ];
        for (const [sx, sy] of subCenters) {
          const sd = sdRoundedBox(nx, ny, sx, sy, 14, 14, 4);
          if (sd < 1.0) {
            blend(255, 255, 255, 1 - Math.max(0, sd));
          }
        }
      }

      // Center optical sync dot
      const centerD = Math.hypot(nx - 256, ny - 256) - 13;
      if (centerD < 1.0) {
        blend(255, 255, 255, 1 - Math.max(0, centerD));
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(bgAlpha * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

const targetDirs = [
  path.join(ROOT, 'public', 'icons'),
  path.join(ROOT, 'icons')
];

for (const dir of targetDirs) {
  fs.mkdirSync(dir, { recursive: true });
}

const files = [
  { name: 'favicon.svg', data: Buffer.from(SVG_ICON, 'utf8') },
  { name: 'favicon.png', data: renderQuadBeamIcon(64, false) },
  { name: 'apple-touch-icon.png', data: renderQuadBeamIcon(180, true) },
  { name: 'icon-192.png', data: renderQuadBeamIcon(192, false) },
  { name: 'icon-512.png', data: renderQuadBeamIcon(512, false) },
  { name: 'icon-maskable-512.png', data: renderQuadBeamIcon(512, true) }
];

for (const file of files) {
  for (const dir of targetDirs) {
    fs.writeFileSync(path.join(dir, file.name), file.data);
  }
  console.log(`Generated ${file.name} (${file.data.length} bytes)`);
}
