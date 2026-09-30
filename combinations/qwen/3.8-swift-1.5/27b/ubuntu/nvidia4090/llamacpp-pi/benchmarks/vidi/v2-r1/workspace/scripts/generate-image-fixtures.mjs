/**
 * Story 12: generates the image fixtures used by unit, integration and e2e
 * tests (spec/stories/012 Fixtures). Run with: node scripts/generate-image-fixtures.mjs
 *
 * - screenshot.png: real PNG, 1440x900 (solid colour, zlib-compressed).
 * - small.png: real PNG, 64x48.
 * - photo.jpg: real baseline JPEG (1x1).
 * - animated.gif: real animated GIF89a, 2 frames 1x1 (hand-built bytes).
 * - image.webp: RIFF/WEBP magic with padded body (sniffing fixture; no test
 *   decodes it in the browser).
 * - script.svg: SVG containing a <script> tag (security negative).
 * - fake.png: a PDF renamed to .png (disguised file negative).
 * - corrupt.png: a valid PNG header with truncated IDAT data.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'images');
mkdirSync(outDir, { recursive: true });

// ---------- PNG encoder (RGB, 8-bit) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
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

function makePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: RGB
  // compression 0, filter 0, interlace 0
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 1 + x * 3 + 1] = rgb[1];
      raw[row + 1 + x * 3 + 2] = rgb[2];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- GIF bytes (1x1 red pixel frames) ----------
// Header: GIF89a, 1x1, GCT with one entry (red).
const gifHeader = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00,             // width=1 height=1
  0x80, 0x00, 0x00,                   // GCT flag, colour res, aspect
  0x00, 0x00, 0x00,                   // bg colour, aspect ratio
  0xff, 0x00, 0x00,                   // GCT entry 0: red
]);
// Image descriptor: left=0 top=0 w=1 h=1, no LCT.
const gifImageDescriptor = Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
// LZW: min code size 2, one block: clear(4) pixel(0) EOI(5) → 44 01, terminator.
const gifLzw = Buffer.from([0x02, 0x02, 0x44, 0x01, 0x00]);
// Graphics control extension: disposal=1, delay=0, transparent=0.
const gifGce = Buffer.from([0x21, 0xf9, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00]);
// NETSCAPE2.0 application extension: loop forever.
const gifLoop = Buffer.from([
  0x21, 0xff, 0x0b,
  ...Buffer.from('NETSCAPE2.0', 'ascii'),
  0x03, 0x01, 0x00, 0x00, 0x00,
]);

writeFileSync(join(outDir, 'screenshot.png'), makePng(1440, 900, [66, 133, 244]));
writeFileSync(join(outDir, 'small.png'), makePng(64, 48, [255, 235, 59]));
writeFileSync(
  join(outDir, 'animated.gif'),
  Buffer.concat([gifHeader, gifLoop, gifGce, gifImageDescriptor, gifLzw, gifGce, gifImageDescriptor, gifLzw, Buffer.from([0x3b])]),
);

// 1x1 baseline JPEG (known-good bytes).
writeFileSync(
  join(outDir, 'photo.jpg'),
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
);

// WebP: RIFF size WEBP + VP8L-ish body (sniffing fixture only).
{
  const body = Buffer.alloc(64);
  body[0] = 0x2f; // VP8L signature byte
  const riff = Buffer.alloc(4);
  riff.writeUInt32LE(4 + 8 + body.length, 0);
  writeFileSync(
    join(outDir, 'image.webp'),
    Buffer.concat([Buffer.from('RIFF', 'ascii'), riff, Buffer.from('WEBP', 'ascii'), body]),
  );
}

writeFileSync(
  join(outDir, 'script.svg'),
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert("xss")</script><rect width="10" height="10"/></svg>',
    'utf8',
  ),
);

// A real (minimal) PDF, renamed to .png.
writeFileSync(
  join(outDir, 'fake.png'),
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >> endobj\nxref\n0 4\n0000000000 65535 f \ntrailer << /Size 4 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    'utf8',
  ),
);

// Corrupt PNG: valid signature + IHDR, then truncated IDAT.
{
  const full = makePng(8, 8, [0, 0, 0]);
  writeFileSync(join(outDir, 'corrupt.png'), full.subarray(0, 20));
}

// bytes.ts: base64 of every fixture, so tests can run inside workerd where
// node:fs cannot see the real filesystem (integration project).
const FIXTURE_NAMES = ['screenshot.png', 'small.png', 'photo.jpg', 'animated.gif', 'image.webp', 'script.svg', 'fake.png', 'corrupt.png'];
let bytesTs = '/* Generated by scripts/generate-image-fixtures.mjs — do not edit. */\n\nexport const FIXTURES: Record<string, string> = {\n';
for (const name of FIXTURE_NAMES) {
  const b64 = readFileSync(join(outDir, name)).toString('base64');
  bytesTs += `  ${JSON.stringify(name)}: ${JSON.stringify(b64)},\n`;
}
bytesTs += '};\n';
writeFileSync(join(outDir, 'bytes.ts'), bytesTs);

console.log('fixtures written to', outDir);
