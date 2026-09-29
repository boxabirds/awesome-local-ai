#!/usr/bin/env node
/**
 * One-off generator for the binary e2e fixtures in `tests/fixtures/images/`
 * (story 12). Run `node tests/fixtures/generate-images.mjs` after changing the
 * fixture set; the produced files are committed so specs need no image tooling.
 *
 * Real PNG/JPEG/WebP bytes come from Chromium's canvas encoder; the animated GIF
 * is assembled with the ffmpeg binary Playwright downloads. Files that must be
 * exactly 10 MB (and 10 MB + 1) are generated in-test instead, so the repository
 * does not carry 20 MB of padding.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'images');
const tmp = join(outDir, '.tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

/** Draw a colourful "screenshot"-like image and return its encoded bytes. */
async function canvasImage(page, { width, height, type, quality }) {
  const dataUrl = await page.evaluate(
    ({ width, height, type, quality }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#4A90D9');
      gradient.addColorStop(0.5, '#F48FB1');
      gradient.addColorStop(1, '#263238');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${(i * 31) % 360} 70% 60%)`;
        ctx.fillRect((i * width) / 12, height * 0.25, width / 24, height * 0.5);
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.max(12, Math.round(height / 12))}px sans-serif`;
      ctx.fillText(`${width}x${height}`, width * 0.06, height * 0.2);
      return canvas.toDataURL(type, quality);
    },
    { width, height, type, quality },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function withPage(run) {
  const browser = await chromium.launch();
  try {
    return await run(await browser.newPage());
  } finally {
    await browser.close();
  }
}

await withPage(async (page) => {
  writeFileSync(join(outDir, 'screenshot.png'), await canvasImage(page, { width: 1440, height: 900, type: 'image/png' }));
  writeFileSync(join(outDir, 'drawing.png'), await canvasImage(page, { width: 640, height: 480, type: 'image/png' }));
  writeFileSync(join(outDir, 'tiny.png'), await canvasImage(page, { width: 40, height: 30, type: 'image/png' }));
  writeFileSync(join(outDir, 'photo.jpg'), await canvasImage(page, { width: 4032, height: 3024, type: 'image/jpeg', quality: 0.92 }));
  writeFileSync(join(outDir, 'small.webp'), await canvasImage(page, { width: 320, height: 240, type: 'image/webp', quality: 0.9 }));
});

// Animated GIF: written directly (Playwright's ffmpeg build has no GIF muxer).
writeFileSync(join(outDir, 'anim.gif'), animatedGif());

/**
 * A tiny animated GIF89a written with "uncompressed" LZW: the encoder emits a
 * Clear code often enough that the code width never grows, which keeps the
 * bit packing trivial while remaining fully spec-conformant.
 */
function animatedGif() {
  const width = 32;
  const height = 32;
  const bpp = 2; // 4 colours
  const minCodeSize = 2;
  const palette = [
    [0x26, 0x32, 0x38],
    [0x4a, 0x90, 0xd9],
    [0xf4, 0x8f, 0xb1],
    [0xff, 0xf5, 0x9d],
  ];
  const frames = [
    (x, y) => (x >> 2) % 2,
    (x, y) => ((x >> 2) + (y >> 2)) % 4,
    (x, y) => (y >> 2) % 4,
  ].map((pixelAt) => {
    const pixels = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.push(pixelAt(x, y) & 3);
    return pixels;
  });

  const out = [];
  const u8 = (...values) => out.push(...values);
  const u16 = (value) => u8(value & 0xff, (value >>> 8) & 0xff);
  const subBlocks = (bytes) => {
    for (let i = 0; i < bytes.length; i += 255) {
      const slice = bytes.slice(i, i + 255);
      u8(slice.length, ...slice);
    }
    u8(0);
  };

  // Header + logical screen descriptor + global colour table.
  out.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
  u16(width);
  u16(height);
  u8(0x80 | ((bpp - 1) << 4) | (bpp - 1), 0, 0);
  for (const [r, g, b] of palette) u8(r, g, b);

  // Netscape loop extension: repeat forever.
  u8(0x21, 0xff, 0x0b);
  out.push(...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)));
  u8(0x03, 0x01);
  u16(0);
  u8(0x00);

  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  // Codes decodable before the table would force a wider code.
  const codesPerClear = (1 << (minCodeSize + 1)) - (clear + 2) - 1;

  for (const pixels of frames) {
    u8(0x21, 0xf9, 0x04, 0x04); // graphics control: disposal 1
    u16(20); // 0.2 s per frame
    u8(0x00, 0x00);
    u8(0x2c); // image descriptor
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    u8(0x00);
    u8(minCodeSize);

    const codes = [clear];
    for (let i = 0; i < pixels.length; i++) {
      codes.push(pixels[i]);
      if ((i + 1) % codesPerClear === 0 && i + 1 < pixels.length) codes.push(clear);
    }
    codes.push(eoi);

    // Pack codes into bytes, least-significant bit first.
    const bitWidth = minCodeSize + 1;
    const bytes = [];
    let accumulator = 0;
    let bitsHeld = 0;
    for (const code of codes) {
      accumulator |= code << bitsHeld;
      bitsHeld += bitWidth;
      while (bitsHeld >= 8) {
        bytes.push(accumulator & 0xff);
        accumulator >>>= 8;
        bitsHeld -= 8;
      }
    }
    if (bitsHeld > 0) bytes.push(accumulator & 0xff);
    subBlocks(bytes);
  }

  u8(0x3b); // trailer
  return Buffer.from(out);
}

// Textual and damaged fixtures.
writeFileSync(
  join(outDir, 'evil.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
    '<script>alert("xss")</script><rect width="40" height="40" fill="#0af" /></svg>\n',
);
writeFileSync(
  join(outDir, 'renamed-pdf.png'),
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);

// Undecodable "image": correct PNG signature, every chunk after it destroyed.
const tiny = readFileSync(join(outDir, 'tiny.png'));
const broken = Buffer.concat([tiny.subarray(0, 8), Buffer.alloc(200, 0x00)]);
writeFileSync(join(outDir, 'corrupt.png'), broken);

rmSync(tmp, { recursive: true, force: true });
console.log('fixtures written to', outDir);
