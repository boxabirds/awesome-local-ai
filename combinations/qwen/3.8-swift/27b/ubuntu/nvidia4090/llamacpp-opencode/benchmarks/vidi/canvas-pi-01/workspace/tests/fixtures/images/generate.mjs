// Generates the binary image fixtures in this directory. Run once:
//   node tests/fixtures/images/generate.mjs
// PNGs are real, decodable, solid-colour bitmaps (Node zlib, no deps).
// GIF/WebP/JPEG are canonical 1x1 raster fixtures.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

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
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const len = new DataView(out.buffer);
  len.setUint32(0, data.length);
  out.set(Uint8Array.from(type, (c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  len.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Solid-colour RGB PNG of the given size (filter byte 0 per row). */
function solidPng(width, height, rgb) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

writeFileSync(join(dir, 'screenshot.png'), solidPng(1440, 900, [100, 116, 139]));
writeFileSync(join(dir, 'photo.png'), solidPng(400, 300, [214, 157, 102]));
writeFileSync(join(dir, 'wide.png'), solidPng(600, 400, [120, 170, 120]));
writeFileSync(join(dir, 'portrait.png'), solidPng(200, 800, [160, 120, 170]));

// Canonical 1x1 rasters (decode fine in every browser engine).
writeFileSync(
  join(dir, 'animated.gif'),
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
);
writeFileSync(
  join(dir, 'sample.webp'),
  Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64'),
);
writeFileSync(
  join(dir, 'tiny.jpg'),
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
    'base64',
  ),
);
writeFileSync(
  join(dir, 'script.svg'),
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert("x")</script><rect width="10" height="10"/></svg>',
  ),
);
writeFileSync(
  join(dir, 'renamed.pdf.png'),
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF',
  ),
);
// PNG signature + a valid-looking IHDR, then truncated mid-IDAT: any decoder
// must reject it (client decode-failure path).
writeFileSync(
  join(dir, 'corrupt.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgF/dfkAAAAASUVORK5CYII=',
    'base64',
  ).subarray(0, 24),
);
console.log('fixtures written');
