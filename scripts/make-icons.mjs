// Draws the extension icon (dark rounded square, play triangle, seek bar) and writes
// icons/icon-{16,32,48,128}.png. No dependencies: shapes are rasterized with 4x4
// supersampling and encoded with Node's built-in zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { crc32 } from './lib/crc32.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersamples per axis

const ACCENT = [255, 61, 90];
const BG_TOP = [38, 38, 50];
const BG_BOTTOM = [18, 18, 26];
const WHITE = [255, 255, 255];

// Shapes in unit space (0..1). Later shapes paint over earlier ones.
function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
}

function circle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function triangle([ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}

const background = roundedRect(0, 0, 1, 1, 0.22);
const layers = [
  { shape: triangle([0.39, 0.2], [0.39, 0.56], [0.69, 0.38]), color: WHITE, alpha: 1 },
  { shape: roundedRect(0.16, 0.7, 0.84, 0.78, 0.04), color: WHITE, alpha: 0.35 },
  { shape: roundedRect(0.16, 0.7, 0.58, 0.78, 0.04), color: ACCENT, alpha: 1 },
  { shape: circle(0.58, 0.74, 0.085), color: ACCENT, alpha: 1 },
];

function pixel(u, v) {
  if (!background(u, v)) return null;
  const bg = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * v);
  let rgb = bg;
  for (const { shape, color, alpha } of layers) {
    if (shape(u, v)) rgb = rgb.map((c, i) => c + (color[i] - c) * alpha);
  }
  return rgb;
}

function render(size) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    data[row] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (!px) continue;
          r += px[0];
          g += px[1];
          b += px[2];
          a++;
        }
      }
      const o = row + 1 + x * 4;
      if (a) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
        data[o + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return encodePng(size, size, data);
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, render(size));
  console.log(`wrote ${file}`);
}
