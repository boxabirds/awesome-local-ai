/**
 * Generates the e2e image fixtures (real, decodable PNGs + disguised files).
 * Run: node tests/e2e/fixtures/images/generate.mjs
 *
 * - small.png  40×30 red PNG (drop/paste/picker happy path)
 * - medium.png 400×200 blue PNG (resize: 2:1 aspect)
 * - a.png b.png c.png — copies of small.png for the 3-file drop (TC-25)
 * - fake.png   PDF bytes with a .png name (content decides: must be refused)
 * - big.png    11 MB (over the 10 MB limit; client-side size rejection)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// --- minimal PNG encoder (RGB, 8-bit) ---------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- fixtures -----------------------------------------------------------------
mkdirSync(dir, { recursive: true });

const small = png(40, 30, [220, 60, 60]);
const medium = png(400, 200, [40, 90, 220]);

writeFileSync(join(dir, 'small.png'), small);
writeFileSync(join(dir, 'medium.png'), medium);
writeFileSync(join(dir, 'a.png'), small);
writeFileSync(join(dir, 'b.png'), small);
writeFileSync(join(dir, 'c.png'), small);

// A minimal PDF with a .png name (the server sniffs content; the client's
// decoder must also refuse it).
writeFileSync(
  join(dir, 'fake.png'),
  Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Size 1 /Root 1 0 R >>\n%%EOF\n'),
);

// 11 MB — over the 10 MB limit (PNG signature + zero padding; never decoded).
const big = Buffer.alloc(11 * 1024 * 1024, 0);
small.subarray(0, 8).copy(big);
writeFileSync(join(dir, 'big.png'), big);

console.log('fixtures written to', dir);
