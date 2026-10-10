#!/usr/bin/env node
/**
 * Write the image fixtures the story 12 tests read (`tests/fixtures/images/`).
 *
 * Real bytes, produced once and committed: a real PNG, a real (large) JPEG, a
 * real WebP, a hand-written animated GIF, an SVG carrying a disallowed script,
 * a PDF renamed `.png` and a truncated PNG. The two oversized files (exactly
 * `IMAGE_MAX_BYTES` and one byte more) are built at test time instead - see
 * `tests/fixtures/oversizeImage.ts`, which pads these JPEG magic bytes with a
 * JPEG comment segment, so the 10 MB boundary is a real file without committing
 * 20 MB of binary.
 *
 * Run with `npm run fixtures:images`. It needs the same Chromium the e2e run
 * uses (see `scripts/prepare-e2e.mjs`); everything except the JPEG, PNG and
 * WebP is written without a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'tests', 'fixtures', 'images');

/* ---------------------------------------------------------------- GIF (hand-written) */

/** GIF LZW: the standard variable-width, least-significant-bit-first encoder. */
function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dictionary = new Map();
  let nextCode = eoiCode + 1;
  const out = [];
  let buffer = 0;
  let bits = 0;

  const emit = (code) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 0xff);
      buffer >>= 8;
      bits -= 8;
    }
  };

  emit(clearCode);
  let current = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const pixel = indices[i];
    const key = (current << 8) | pixel;
    if (dictionary.has(key)) {
      current = dictionary.get(key);
      continue;
    }
    emit(current);
    dictionary.set(key, nextCode);
    if (nextCode === (1 << codeSize)) {
      if (codeSize < 12) {
        codeSize += 1;
      } else {
        emit(clearCode);
        dictionary = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
    }
    nextCode += 1;
    current = pixel;
  }
  emit(current);
  emit(eoiCode);
  if (bits > 0) {
    out.push(buffer & 0xff);
  }
  return out;
}

/** Split bytes into GIF sub-blocks (max 255 bytes each) with the 0 terminator. */
function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];

/**
 * A small animated GIF89a: `frames` solid-colour frames of a 16x16 square that
 * shifts colour each frame, so it carries the NETSCAPE2.0 loop extension a real
 * animated file has.
 */
function animatedGif(size, frames) {
  const bytes = [
    ...'GIF89a'.split('').map((c) => c.charCodeAt(0)),
    ...u16(size),
    ...u16(size),
    0xf1, // global colour table present, 8 bits, 16 entries
    0x00,
    0x00,
    // Global colour table: 16 distinguishable colours.
    ...Array.from({ length: 16 }, (_, i) => [(i * 16) & 0xff, 255 - i * 16, (i * 90) & 0xff]).flat(),
    // NETSCAPE2.0 looping application extension.
    0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00,
  ];

  for (let frame = 0; frame < frames.length; frame += 1) {
    bytes.push(0x21, 0xf9, 0x04, 0x08, ...u16(10), 0x00, 0x00); // GCE, 100 ms delay
    bytes.push(0x2c, ...u16(0), ...u16(0), ...u16(size), ...u16(size), 0x00);
    const colour = frames[frame] ?? 1;
    const pixels = new Array(size * size).fill(colour);
    const data = lzwEncode(4, pixels);
    bytes.push(4, ...subBlocks(data));
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/* ---------------------------------------------------------------- the fixtures */

/** The Chromium `scripts/prepare-e2e.mjs` resolved, else @sparticuz, else Playwright's own. */
async function resolveExecutable() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.e2e', 'browser.json'), 'utf8'));
    if (cfg.executablePath) {
      return cfg.executablePath;
    }
  } catch {
    // Not resolved yet: fall through to the package fallback.
  }
  try {
    const mod = await import('@sparticuz/chromium');
    const sparticuz = mod.default ?? mod;
    return typeof sparticuz?.executablePath === 'function' ? sparticuz.executablePath() : undefined;
  } catch {
    return undefined;
  }
}

async function browserImages() {
  const executablePath = await resolveExecutable();

  const browser = await chromium.launch({
    executablePath,
    args: executablePath ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });
  try {
    const page = await browser.newPage();

    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1440;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      canvas.width = 640;
      canvas.height = 480;
      const gradient = ctx.createLinearGradient(0, 0, 640, 480);
      gradient.addColorStop(0, '#1f6feb');
      gradient.addColorStop(0.5, '#f7b731');
      gradient.addColorStop(1, '#e5534b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 640, 480);
      for (let i = 0; i < 40; i += 1) {
        ctx.fillStyle = `hsl(${i * 9}deg 70% ${30 + (i % 7) * 8}%)`;
        ctx.beginPath();
        ctx.arc((i * 137) % 640, (i * 211) % 480, 20 + (i % 5) * 12, 0, Math.PI * 2);
        ctx.fill();
      }
      return canvas.toDataURL('image/png');
    });

    // A large photo-like JPEG: a fine repeating pattern keeps entropy high enough
    // that a real encoder produces a multi-megabyte file.
    let jpegDataUrl = null;
    for (const quality of [0.98, 0.96, 0.94, 0.92, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62]) {
      const dataUrl = await page.evaluate((q) => {
        const canvas = document.createElement('canvas');
        canvas.width = 4032;
        canvas.height = 3024;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#243447';
        ctx.fillRect(0, 0, 4032, 3024);
        for (let y = 0; y < 3024; y += 6) {
          for (let x = 0; x < 4032; x += 6) {
            const h = (x * 7 + y * 13) % 360;
            ctx.fillStyle = `hsl(${h}deg 45% ${25 + ((x * y) % 40)}%)`;
            ctx.fillRect(x, y, 6, 6);
          }
        }
        return canvas.toDataURL('image/jpeg', q);
      }, quality);
      jpegDataUrl = dataUrl;
      // A photo-sized fixture (~3 MB), not the largest file the encoder will make.
      if (Buffer.from(dataUrl.split(',')[1], 'base64').length <= 3.5 * 1024 * 1024) {
        break;
      }
    }

    // A normal-sized photo fixture: real JPEG bytes, well under the byte limit.
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#243447';
      ctx.fillRect(0, 0, 640, 480);
      for (let y = 0; y < 480; y += 4) {
        for (let x = 0; x < 640; x += 4) {
          const h = (x * 7 + y * 13) % 360;
          ctx.fillStyle = `hsl(${h}deg 45% ${25 + ((x * y) % 40)}%)`;
          ctx.fillRect(x, y, 4, 4);
        }
      }
      return canvas.toDataURL('image/jpeg', 0.82);
    });

    const webp = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 640, 480);
      gradient.addColorStop(0, '#2da44e');
      gradient.addColorStop(1, '#8957e5');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#ffffff';
      ctx.font = '120px sans-serif';
      ctx.fillText('webp', 60, 300);
      return canvas.toDataURL('image/webp');
    });

    const dataUrlBytes = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
    return {
      'photo.png': dataUrlBytes(png),
      'photo.jpg': dataUrlBytes(jpeg),
      'photo-large.jpg': dataUrlBytes(jpegDataUrl),
      'photo.webp': dataUrlBytes(webp),
    };
  } finally {
    await browser.close();
  }
}

const SVG_WITH_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#dbebff" />
  <circle cx="160" cy="120" r="70" fill="#1f6feb" />
  <script type="text/javascript">document.body.innerHTML = "disallowed";</script>
</svg>
`;

const PDF_BYTES = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
    'trailer << /Size 3 /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
  'latin1',
);

const files = await browserImages();
files['animated.gif'] = animatedGif(16, [1, 5, 9, 13]);
files['drawing.svg'] = Buffer.from(SVG_WITH_SCRIPT, 'utf8');
files['not-an-image.png'] = PDF_BYTES;
files['truncated.png'] = Buffer.from(
  files['photo.png'].subarray(0, Math.floor(files['photo.png'].length / 2)),
);

fs.mkdirSync(outDir, { recursive: true });
for (const [name, bytes] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
console.log(`wrote ${Object.keys(files).length} fixtures to ${outDir}`);
