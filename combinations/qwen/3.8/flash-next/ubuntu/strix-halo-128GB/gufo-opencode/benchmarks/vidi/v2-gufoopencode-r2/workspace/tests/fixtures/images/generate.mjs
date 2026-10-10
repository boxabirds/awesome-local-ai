// Generates story 12 image fixtures with no image library (Node zlib only).
// PNGs are real decodable files (RGB8, filter 0, gradient pixels so they
// compress small). The 4032x3024 "photo" fixture is a PNG rather than a JPEG
// so Chromium can decode it in e2e; server-side sniffing accepts both formats
// through the same path. The 10 MB files are a valid PNG padded with trailing
// bytes to the exact sizes. Run: node tests/fixtures/images/generate.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

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

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = Math.round((255 * x) / Math.max(1, width - 1));
      raw[row + 2 + x * 3] = Math.round((255 * y) / Math.max(1, height - 1));
      raw[row + 3 + x * 3] = Math.round(((x + y) * 255) / Math.max(1, width + height - 2));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paddedTo(pngBytes, totalBytes) {
  const pad = totalBytes - pngBytes.length;
  if (pad < 16) throw new Error(`base PNG (${pngBytes.length} B) too big to pad to ${totalBytes}`);
  // Extra trailing bytes after IEND: decoders ignore them; tests only need
  // the magic header and the exact file size.
  const marker = Buffer.from('PADDING', 'ascii');
  return Buffer.concat([pngBytes, marker, Buffer.alloc(pad - marker.length)]);
}

// Two-frame 1x1 GIF89a with a Netscape loop extension: real, animated, tiny.
function animatedGif() {
  return Buffer.concat([
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
    Buffer.from([0xff, 0xff, 0xff, 0x00, 0x00, 0x00]), // 2-color global table
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00]),
    Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0x02, 0x02, 0x44, 0x01, 0x00]),
    Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]),
    Buffer.from([0x3b]),
  ]);
}

const screenshot = png(1440, 900);
writeFileSync(join(OUT, 'screenshot-1440x900.png'), screenshot);

const photo = png(4032, 3024);
writeFileSync(join(OUT, 'photo-4032x3024.png'), photo);

const small = png(400, 300);
writeFileSync(join(OUT, 'note-400x300.png'), small);

const exactly = paddedTo(png(8, 8), IMAGE_MAX_BYTES);
if (exactly.length !== IMAGE_MAX_BYTES) throw new Error('exactly-max wrong size');
writeFileSync(join(OUT, 'exactly-10mb.png'), exactly);

const over = paddedTo(png(8, 8), IMAGE_MAX_BYTES + 1);
if (over.length !== IMAGE_MAX_BYTES + 1) throw new Error('over-max wrong size');
writeFileSync(join(OUT, 'over-10mb.png'), over);

writeFileSync(join(OUT, 'animated.gif'), animatedGif());

// Crafted WebP header bytes (no browser test decodes WebP; sniffing and
// upload treat it as opaque bytes).
const webpPayload = Buffer.from('lossless-payload', 'ascii');
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 ', 'ascii'),
  (() => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(webpPayload.length);
    return size;
  })(),
  webpPayload,
]);
webp.writeUInt32LE(webp.length - 8, 4);
writeFileSync(join(OUT, 'sample.webp'), webp);

writeFileSync(
  join(OUT, 'evil.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);

writeFileSync(
  join(OUT, 'report.png'),
  Buffer.concat([
    Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    Buffer.alloc(64, 0x20),
  ]),
);

writeFileSync(join(OUT, 'corrupt.png'), screenshot.subarray(0, Math.floor(screenshot.length / 3)));

console.log('fixtures written to', OUT);
