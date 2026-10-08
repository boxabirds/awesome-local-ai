#!/usr/bin/env node
// Builds the story 12 image fixtures into this directory, then decodes every one of
// them in headless Chromium and prints what the browser saw.
//
// The app decides what an image is by its first bytes, so these files have to be real:
// a fixture whose header lies is a fixture that tests the wrong thing. Everything here
// is generated rather than downloaded, so a fixture can be rebuilt (or its exact byte
// count recomputed) without fetching anything.
//
//   node tests/fixtures/images/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// --- hand-written encoders ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Uint8Array.from([
    (body.length >>> 24) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff,
    body.length & 0xff,
  ]);
  const head = new TextEncoder().encode(type);
  const crc = new DataView(new ArrayBuffer(4));
  crc.setUint32(0, crc32(new Uint8Array([...head, ...body])));
  return [length, head, body, new Uint8Array(crc.buffer)];
}

/** A truecolour PNG, one RGBA byte per channel, rows filtered with byte 0. */
function encodePng(width, height, pixel) {
  const raw = new Uint8Array(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
      raw[at++] = a;
    }
  }
  const ihdr = new DataView(new ArrayBuffer(13));
  ihdr.setUint32(0, width);
  ihdr.setUint32(4, height);
  ihdr.setUint8(8, 8); // bit depth
  ihdr.setUint8(9, 6); // colour type: truecolour with alpha
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunk('IHDR', new Uint8Array(ihdr.buffer)),
    ...chunk('IDAT', new Uint8Array(deflateSync(raw))),
    ...chunk('IEND', new Uint8Array(0)),
  ];
  return concat(parts);
}

/**
 * A GIF compressed the way an encoder that never compresses does it: emit a code-size
 * reset, then literal palette indices, always resetting before the code width would
 * have to grow. A decoder cannot tell the difference, and no LZW dictionary is needed.
 */
function lzwUncompressed(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const codeSize = minCodeSize + 1;
  const out = [];
  let bits = 0;
  let held = 0;
  const emit = (code) => {
    bits |= code << held;
    held += codeSize;
    while (held >= 8) {
      out.push(bits & 0xff);
      bits >>>= 8;
      held -= 8;
    }
  };
  let sinceReset = 0;
  const reset = () => {
    emit(clear);
    sinceReset = 0;
  };
  reset();
  for (const index of indices) {
    // +2 leaves room for the codes the decoder still has to invent (clear, end).
    if (sinceReset + 2 >= 1 << codeSize) reset();
    emit(index);
    sinceReset++;
  }
  emit(end);
  if (held > 0) out.push(bits & 0xff);
  return Uint8Array.from(out);
}

/** Sub-blocks: a length byte, then at most 255 bytes of payload. */
function subBlocks(data) {
  const parts = [];
  for (let at = 0; at < data.length; at += 0xff) {
    const slice = data.subarray(at, at + 0xff);
    parts.push(Uint8Array.from([slice.length]), slice);
  }
  parts.push(new Uint8Array([0])); // the block-set terminator
  return parts;
}

/** An animated GIF89a: `frames` palettes-indexed grids, one loop, no transparency. */
function encodeGif(width, height, frames, delayCs) {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    palette[i * 3] = (i * 4) & 0xff;
    palette[i * 3 + 1] = (i * 8) & 0xff;
    palette[i * 3 + 2] = (i * 16) & 0xff;
  }
  const head = new TextEncoder().encode('GIF89a');
  const screen = Uint8Array.from([
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0xf7, // global colour table follows, 256 entries
    0,
    0,
  ]);
  const netscape = Uint8Array.from([
    0x21,
    0xff,
    0x0b,
    ...new TextEncoder().encode('NETSCAPE2.0'),
    0x03,
    0x01,
    0,
    0, // loop forever
    0x00,
  ]);
  const parts = [head, screen, palette, netscape];
  for (const pixels of frames) {
    parts.push(
      Uint8Array.from([0x21, 0xf9, 0x04, 0x00, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00]),
      Uint8Array.from([
        0x2c,
        0,
        0,
        0,
        0,
        width & 0xff,
        (width >> 8) & 0xff,
        height & 0xff,
        (height >> 8) & 0xff,
        0x00,
      ]),
      Uint8Array.from([8]), // LZW minimum code size
      ...subBlocks(lzwUncompressed(pixels, 8)),
    );
  }
  parts.push(new Uint8Array([0x3b]));
  return concat(parts);
}

function concat(parts) {
  return new Uint8Array(parts.flat().reduce((all, part) => [...all, ...part], []));
}

/** The smallest PDF that is still a PDF: `%PDF` magic, one page, one xref-less body. */
const PDF = new TextEncoder().encode(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 210 297] >> endobj',
    'trailer << /Root 1 0 R /Size 4 >>',
    '%%EOF',
    '',
  ].join('\n'),
);

// --- the fixtures themselves -------------------------------------------------

const gradient = (scale) => (x, y) => [
  Math.round((x * 255) / scale.width),
  Math.round((y * 255) / scale.height),
  128,
  255,
];

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

const files = [];
const write = (name, bytes) => {
  writeFileSync(`${HERE}${name}`, bytes);
  files.push({ name, mime: MIME[name.split('.').pop()], bytes });
};

const photo = encodePng(120, 90, gradient({ width: 120, height: 90 }));
const screenshot = encodePng(1440, 900, gradient({ width: 1440, height: 900 }));
const gif = encodeGif(
  4,
  4,
  [
    Array.from({ length: 16 }, (_, i) => i * 8),
    Array.from({ length: 16 }, (_, i) => 255 - i * 8),
  ],
  20,
);

write('photo.png', photo);
write('screenshot.png', screenshot);
write('animated.gif', gif);
write('corrupt.png', screenshot.subarray(0, Math.floor(screenshot.length * 0.6)));
write('document.pdf', PDF);
write('fake.png', PDF); // a real PDF wearing a PNG's name
write(
  'script.svg',
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
      '<script>console.warn("svg script ran")</script>' +
      '<rect width="80" height="80" fill="rgb(2,102,7)"/></svg>\n',
  ),
);

// The two formats no hand-written encoder in this file produces: Chromium paints them
// and hands back the bytes, which is also how the app will see them.
const browser = await chromium.launch();
const page = await browser.newPage();
const canvasDataUrls = await page.evaluate(async () => {
  const grab = (width, height, type, quality) =>
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#08103a');
      gradient.addColorStop(0.5, '#c72d4a');
      gradient.addColorStop(1, '#f5c518');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.arc(((i * 977) % width), ((i * 571) % height), (i % 9) * 9 + 4, 0, Math.PI * 2);
        ctx.fill();
      }
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }, type, quality);
    });
  return {
    jpg: await grab(4032, 3024, 'image/jpeg', 0.82),
    webp: await grab(640, 480, 'image/webp', 0.9),
  };
});
await browser.close();

const fromDataUrl = (dataUrl) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (character) => character.charCodeAt(0));

write('photo.jpg', fromDataUrl(canvasDataUrls.jpg));
write('photo.webp', fromDataUrl(canvasDataUrls.webp));

// --- proof: every fixture is decoded by the browser the app runs in -----------

const checker = await chromium.launch();
const checkPage = await checker.newPage();
const rows = await checkPage.evaluate(
  async (specs) => {
    const out = [];
    for (const { name, mime, bytes } of specs) {
      const blob = Uint8Array.from(bytes);
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      const decoded = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
        img.onerror = () => resolve('—');
        img.src = url;
      });
      URL.revokeObjectURL(url);
      const magic = Array.from(bytes.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
      out.push({ name, bytes: bytes.length, magic, decoded });
    }
    return out;
  },
  files.map(({ name, mime, bytes }) => ({ name, mime, bytes: Array.from(bytes) })),
);
await checker.close();

console.table(rows);

// --- the same bytes, for runtimes without a filesystem -----------------------
//
// Integration tests run *inside* workerd, where reading this directory is denied.
// Rather than keep a second set of images by hand, the bytes are emitted here as
// well, and `fixtureBytes` in ./index.ts falls back to them. A unit test compares
// the embedded copies with these files, so the two cannot drift unnoticed.

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const embedded = [
  '// GENERATED by make-fixtures.mjs — do not edit. Fixture bytes for runtimes that',
  '// cannot read this directory (the worker pool runs inside workerd). See the comment',
  '// beside `fixtureBytes` in ./index.ts; `tests/unit/fixtures.test.ts` keeps these',
  '// bytes equal to the files next to it.',
  '',
  'const BASE64: Record<string, string> = {',
  ...files.map(({ name, bytes }) => `  ${JSON.stringify(name)}: ${JSON.stringify(b64(bytes))},`),
  '};',
  '',
  '/** Fixture names this file carries. */',
  'export const EMBEDDED_FIXTURES = Object.keys(BASE64).sort();',
  '',
  '/** The bytes for `name`, or undefined when this file has never heard of it. */',
  'export function embeddedFixture(name: string): Uint8Array<ArrayBuffer> | undefined {',
  '  const text = BASE64[name];',
  '  return text === undefined ? undefined : fromBase64(text);',
  '}',
  '',
  'const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";',
  '',
  '/** Base64 without depending on `Buffer` or `atob`, neither of which every pool has. */',
  'function fromBase64(text: string): Uint8Array<ArrayBuffer> {',
  '  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));',
  '  let at = 0;',
  '  let buffer = 0;',
  '  let bits = 0;',
  '  for (const char of text) {',
  '    if (char === "=") break;',
  '    buffer = (buffer << 6) | ALPHABET.indexOf(char);',
  '    bits += 6;',
  '    if (bits >= 8) {',
  '      bits -= 8;',
  '      bytes[at++] = (buffer >>> bits) & 0xff;',
  '    }',
  '  }',
  '  return bytes.subarray(0, at);',
  '}',
  '',
].join('\n');
writeFileSync(`${HERE}embedded.ts`, embedded);
console.log(`embedded.ts: ${files.length} fixtures, ${embedded.length} characters`);
