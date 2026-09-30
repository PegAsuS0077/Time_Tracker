// Generates the PWA icons (PNG) with Node built-ins only. Run: node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [31, 95, 191]; // #1f5fbf
const FG = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A clock face on a blue background. Coordinates are in a 0..1 unit square.
 * `maskable` leaves a full-bleed background and keeps the glyph inside the safe zone.
 */
function draw(size, { maskable }) {
  const SS = 4; // supersampling for anti-aliasing
  const rgba = Buffer.alloc(size * size * 4);
  const corner = maskable ? 0 : 0.22;
  const scale = maskable ? 0.72 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          // Rounded-square background.
          const cx = Math.max(corner, Math.min(1 - corner, u));
          const cy = Math.max(corner, Math.min(1 - corner, v));
          const inBg = corner === 0 || Math.hypot(u - cx, v - cy) <= corner;
          if (!inBg) continue;
          bgHits++;
          // Glyph in local coordinates centred on 0.5.
          const gu = 0.5 + (u - 0.5) / scale;
          const gv = 0.5 + (v - 0.5) / scale;
          const r = Math.hypot(gu - 0.5, gv - 0.5);
          const ring = r >= 0.27 && r <= 0.335;
          const hourHand = distToSegment(gu, gv, 0.5, 0.5, 0.5, 0.31) <= 0.03;
          const minuteHand = distToSegment(gu, gv, 0.5, 0.5, 0.64, 0.5) <= 0.03;
          if (ring || hourHand || minuteHand) fgHits++;
        }
      }
      const total = SS * SS;
      const i = (y * size + x) * 4;
      const fg = fgHits / Math.max(bgHits, 1);
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - fg) + FG[c] * fg);
      rgba[i + 3] = Math.round((bgHits / total) * 255);
    }
  }
  return png(size, rgba);
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('pwa-192x192.png', out), draw(192, { maskable: false }));
writeFileSync(new URL('pwa-512x512.png', out), draw(512, { maskable: false }));
writeFileSync(new URL('maskable-512x512.png', out), draw(512, { maskable: true }));
writeFileSync(new URL('apple-touch-icon.png', out), draw(180, { maskable: true }));
console.log('Icons written to public/');
