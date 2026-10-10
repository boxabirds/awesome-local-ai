/**
 * Builds the image fixtures this story's tests upload and drop.
 *
 * Every file here is a real image the browser can decode — a fixture that only had the
 * right magic bytes would let a test pass that a person could not use — and every one is
 * generated rather than downloaded, so the repository holds no binary blobs it cannot
 * explain. Run it again with `node tests/fixtures/images/generate.mjs` after changing one.
 *
 * PNG, GIF, SVG and PDF are written from scratch. JPEG and WebP are encoded by Chromium's
 * canvas, because writing those two compressors is not this story's job.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(HERE, { recursive: true });

/* --------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([length, name, body, crc]);
}

/**
 * A truecolour PNG with one flat colour, built the long way round: signature, IHDR, one
 * IDAT of filter-0 scanlines, IEND. `pixel` is `[r, g, b]`.
 */
function png(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      scanlines[at] = pixel[0];
      scanlines[at + 1] = pixel[1];
      scanlines[at + 2] = pixel[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- GIF */

/** Codes written 9 bits at a time, little-endian, which is what a GIF reader expects. */
function lzwLiterals(codes, codeSize) {
  const out = [];
  let pending = 0;
  let bits = 0;
  for (const code of codes) {
    pending |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(pending & 0xff);
      pending >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out.push(pending & 0xff);
  return Buffer.from(out);
}

/**
 * A two-frame animated GIF89a, 8x8 and two colours. The LZW stream is written with literal
 * codes only (a clear code, one code per pixel, an end code) at a minimum code size of 8,
 * which keeps the code size at 9 bits for the whole image and needs no dictionary — the
 * simplest thing a real decoder accepts.
 */
function animatedGif() {
  const header = Buffer.from('GIF89a', 'ascii');
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(8, 0);
  lsd.writeUInt16LE(8, 2);
  lsd[4] = 0x80; // global colour table follows, 2 entries
  const gct = Buffer.from([200, 200, 200, 40, 120, 200]);
  const netscape = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ]);
  const frames = [];
  for (let frame = 0; frame < 2; frame += 1) {
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x08, 10, 0, 0x00, 0x00]);
    // Image descriptor: type byte, then left, top, width, height, packed.
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(8, 5);
    descriptor.writeUInt16LE(8, 7);
    const codes = [0x100]; // clear code (1 << minCodeSize, minCodeSize = 8)
    for (let pixel = 0; pixel < 64; pixel += 1) codes.push(frame === 0 ? 1 : 0);
    codes.push(0x101); // end of information
    const data = lzwLiterals(codes, 9);
    // Image data is a sequence of sub-blocks of at most 255 bytes.
    const blocks = [];
    for (let offset = 0; offset < data.length; offset += 255) {
      const part = data.subarray(offset, offset + 255);
      blocks.push(Buffer.from([part.length]), part);
    }
    frames.push(
      Buffer.concat([gce, descriptor, Buffer.from([0x08]), ...blocks, Buffer.from([0x00])]),
    );
  }
  return Buffer.concat([header, lsd, gct, netscape, ...frames, Buffer.from([0x3b])]);
}

/* ------------------------------------------------------------ SVG/PDF */

/** Not an image this board accepts, and it carries a script tag to make the point. */
function svgWithScript() {
  return Buffer.from(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">',
      '  <script>fetch("/steal-cookie?from=svg")</script>',
      '  <rect width="120" height="80" fill="#b3e5fc"/>',
      '</svg>',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** A short but well-formed PDF, for the file that wears a `.png` name. */
function minimalPdf() {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
    'trailer << /Size 3 /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n');
  return Buffer.from(body, 'ascii');
}

/* -------------------------------------------------- JPEG and WebP, by Chromium */

/**
 * Encode `width`x`height` pixels of a diagonal gradient as JPEG or WebP at `quality`,
 * which is how these two fixtures get to be real photographs of nothing in particular.
 */
async function encodeWithChromium(width, height, format, quality) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(
      ({ canvasWidth, canvasHeight, type, q }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const context = canvas.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
        gradient.addColorStop(0, '#1e88e5');
        gradient.addColorStop(0.5, '#fdd835');
        gradient.addColorStop(1, '#e53935');
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvasWidth, canvasHeight);
        // A few blocks of noise, so the encoder has something to spend bytes on.
        const noise = context.createImageData(64, 64);
        for (let i = 0; i < noise.data.length; i += 4) {
          const value = (i / 4) % 256;
          noise.data[i] = value;
          noise.data[i + 1] = 255 - value;
          noise.data[i + 2] = 128;
          noise.data[i + 3] = 255;
        }
        for (let y = 0; y < canvasHeight; y += 64) {
          for (let x = 0; x < canvasWidth; x += 64) context.putImageData(noise, x, y);
        }
        return canvas.toDataURL(type, q);
      },
      { canvasWidth: width, canvasHeight: height, type: `image/${format}`, q: quality },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    await browser.close();
  }
}

/* ---------------------------------------------------------------- write */

const files = [];
function write(name, bytes) {
  writeFileSync(join(HERE, name), bytes);
  files.push([name, bytes.length]);
}

const screenshot = png(1440, 900, [0x90, 0xca, 0xf9]);
write('screenshot-1440x900.png', screenshot);
write('screenshot-1200x800.png', png(1200, 800, [0xa5, 0xd6, 0xa7]));
write('screenshot-900x600.png', png(900, 600, [0xf8, 0xbb, 0xd0]));
write('broken.png', screenshot.subarray(0, Math.floor(screenshot.length / 3)));
write('animated.gif', animatedGif());
write('svg-with-script.svg', svgWithScript());
// A PDF with a `.png` name: its contents say what it is, and that is what counts (image.types).
write('disguised-pdf.png', minimalPdf());
write('photo-4032x3024.jpg', await encodeWithChromium(4032, 3024, 'jpeg', 0.6));
write('photo-640x480.webp', await encodeWithChromium(640, 480, 'webp', 0.8));

/* ---------------------------------------------------------- verify, in Chromium */

/** Which kinds of image the browser will decode, checked on the way out. */
function mimeTypeOf(name) {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name] of files) {
    if (!/\.(png|jpe?g|gif|webp)$/.test(name)) continue;
    const base64 = readFileSync(join(HERE, name)).toString('base64');
    const loaded = await page.evaluate(
      (args) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve({ error: 'did not decode' });
          img.src = `data:${args.type};base64,${args.base64}`;
        }),
      { type: mimeTypeOf(name), base64 },
    );
    console.log(`${name}: ${JSON.stringify(loaded)}`);
  }
} finally {
  await browser.close();
}

for (const [name, size] of files) console.log(`${name}\t${size} bytes`);
