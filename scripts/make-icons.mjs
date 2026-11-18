/**
 * Generates the PWA PNG icons from a tiny hand-rolled encoder, so the repo
 * needs no image tooling. Run with: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [11, 13, 16];
const LINE = [233, 234, 236];
const ACCENT = [200, 67, 60];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Mirrors favicon.svg: three ascending bars, an accent bar, and a dot. */
function pixel(x, y) {
  const s = 512;
  const u = (v) => (v / s) * 64;
  const px = u(x);
  const py = u(y);
  const inBar = (top, left, width) =>
    py >= top && py <= top + 4 && px >= left && px <= left + width;
  if (inBar(14, 12, 40)) return LINE.map((c) => c * 0.28);
  if (inBar(24, 12, 26)) return LINE.map((c) => c * 0.55);
  if (inBar(34, 12, 33)) return LINE.map((c) => c * 0.8);
  if (inBar(44, 12, 18)) return ACCENT;
  const dx = px - 50;
  const dy = py - 26;
  if (Math.sqrt(dx * dx + dy * dy) <= 4) return ACCENT;
  return BG;
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192, pixel));
writeFileSync('public/icon-512.png', png(512, pixel));
console.log('wrote public/icon-192.png and public/icon-512.png');