/**
 * Generates the image fixtures for story 12.
 *
 * - tests/fixtures/images/: used by unit/integration tests (read via fs)
 * - public/test-fixtures/images/: served to e2e browsers (Vite copies public/ to dist)
 *
 * PNG and GIF are real, decodable images (hand-built; no dependencies).
 * JPEG/WebP carry valid magic bytes (sniffing is the contract; no test
 * requires them to decode). Run: node tests/fixtures/generate-images.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'tests', 'fixtures', 'images');
const publicDir = join(root, 'public', 'test-fixtures', 'images');
mkdirSync(outDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

// ─── PNG ────────────────────────────────────────────────────────────────────

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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Builds a real RGBA PNG. `pixel(x, y)` returns [r, g, b, a]. */
function makePng(width, height, pixel) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A fake "screenshot": light background with a blue header bar and blocks. */
function screenshotPixel(x, y, w, h) {
  if (y < h * 0.12) return [66, 133, 244, 255]; // header bar
  if (x < w * 0.2 && y >= h * 0.2 && y < h * 0.8) return [227, 242, 253, 255]; // sidebar
  const inBlock = (bx, by, bw, bh) => x >= bx && x < bx + bw && y >= by && y < by + bh;
  if (inBlock(w * 0.25, h * 0.2, w * 0.3, h * 0.25)) return [255, 205, 75, 255];
  if (inBlock(w * 0.6, h * 0.2, w * 0.3, h * 0.25)) return [129, 199, 132, 255];
  if (inBlock(w * 0.25, h * 0.5, w * 0.65, h * 0.25)) return [246, 246, 246, 255];
  return [242, 243, 245, 255];
}

const png1440 = makePng(1440, 900, (x, y) => screenshotPixel(x, y, 1440, 900));
const pngSmall = makePng(320, 200, (x, y) => screenshotPixel(x, y, 320, 200));

// ─── GIF (real 2-frame animation) ──────────────────────────────────────────

function lzwEncodeGif(bytes, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const table = new Map();
  const resetTable = () => {
    table.clear();
    for (let i = 0; i < clearCode; i++) table.set(String(i), i);
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetTable();
  const out = [];
  let acc = 0;
  let nBits = 0;
  const emit = (code) => {
    acc |= code << nBits;
    nBits += codeSize;
    while (nBits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      nBits -= 8;
    }
  };
  emit(clearCode);
  let prefix = '';
  for (const b of bytes) {
    const key = prefix + String(b);
    if (table.has(key)) {
      prefix = key;
      continue;
    }
    emit(table.get(prefix));
    table.set(key, nextCode);
    if (nextCode === (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    nextCode++;
    if (nextCode === 4096) {
      emit(clearCode);
      resetTable();
    }
    prefix = String(b);
  }
  if (prefix !== '') emit(table.get(prefix));
  emit(eoiCode);
  if (nBits > 0) out.push(acc & 0xff);
  return out;
}

function gifDataSubBlocks(bytes) {
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const slice = bytes.slice(i, i + 255);
    blocks.push(Buffer.from([slice.length]), Buffer.from(slice));
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function makeGif(width, height, frames) {
  // 2-colour global palette: red, blue
  const header = Buffer.from('GIF89a', 'ascii');
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x70 | 0x80; // GCT flag, colour res 7, GCT size 0 (2 colours)
  lsd[5] = 0; // background
  lsd[6] = 0; // aspect
  const gct = Buffer.from([255, 0, 0, 0, 0, 255]);
  const parts = [header, lsd, gct];
  for (const frame of frames) {
    // Graphics Control Extension: disposal 1, delay (1/100 s), no transparent
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x04, frame.delay & 0xff, (frame.delay >> 8) & 0xff, 0x00, 0x00]);
    parts.push(gce);
    const id = Buffer.alloc(10);
    id[0] = 0x2c;
    id.writeUInt16LE(0, 1); // left
    id.writeUInt16LE(0, 3); // top
    id.writeUInt16LE(width, 5);
    id.writeUInt16LE(height, 7);
    id[9] = 0; // no local GCT
    parts.push(id);
    const minCodeSize = 2;
    const lzw = lzwEncodeGif(frame.pixels, minCodeSize);
    parts.push(Buffer.from([minCodeSize]), gifDataSubBlocks(lzw));
  }
  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}

const gif = makeGif(40, 30, [
  { delay: 50, pixels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { delay: 50, pixels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
]);

// ─── JPEG / WebP (valid magic bytes; content not required to decode) ──────

function fakeWithMagic(magic, size) {
  const buf = Buffer.alloc(size);
  magic.copy(buf, 0);
  return buf;
}

const jpeg4032 = fakeWithMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46]), 3 * 1024 * 1024);
const webp = fakeWithMagic(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]), 4096);

// ─── Non-image files ────────────────────────────────────────────────────────

const svgWithScript = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>\n',
);

const pdfRenamed = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

// Truncated PNG: valid signature + IHDR, then a cut-off IDAT
const corruptPng = png1440.subarray(0, 60);

// ─── Write files ────────────────────────────────────────────────────────────

writeFileSync(join(outDir, 'screenshot-1440x900.png'), png1440);
writeFileSync(join(outDir, 'sample-320x200.png'), pngSmall);
writeFileSync(join(outDir, 'photo-4032x3024.jpg'), jpeg4032);
writeFileSync(join(outDir, 'animated.gif'), gif);
writeFileSync(join(outDir, 'sample.webp'), webp);
writeFileSync(join(outDir, 'svg-with-script.svg'), svgWithScript);
writeFileSync(join(outDir, 'pdf-renamed.png'), pdfRenamed);
writeFileSync(join(outDir, 'corrupt.png'), corruptPng);

// E2E: served to the browser from public/test-fixtures/images/ (Vite copies
// public/ into dist/client at build time). The 11 MB JPEG is generated at
// e2e setup time (tests/e2e/global-setup.ts) to keep the repo small.
writeFileSync(join(publicDir, 'screenshot-1440x900.png'), png1440);
writeFileSync(join(publicDir, 'sample-320x200.png'), pngSmall);
writeFileSync(join(publicDir, 'animated.gif'), gif);

console.log('fixtures written to', outDir, 'and', publicDir);
