// One-time generator for the story 12 image fixtures (tests/fixtures/images/index.ts).
//
// Why a generator and not files committed in binary: the same bytes have to reach a node
// unit test, a test that runs *inside* the Workers runtime (where the fixture directory is
// not something we can read) and a browser page that is being handed a synthetic file drop.
// A TypeScript module holding base64 is the one form all three can import.
//
// Why a browser: the files must be *real* images — decodable by `createImageBitmap` in the
// client and sniffable from their magic bytes by the Worker — and a browser canvas is the
// smallest encoder this repo already depends on. GIF is the exception: a browser can decode
// GIFs but not encode them, so the animated one is written by hand below.
//
// Run `node tools/make-image-fixtures.mjs` and commit the produced module. Nothing in the
// suites runs this script.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();

/** Draw a screenshot-like image on a canvas and hand back its encoded bytes. */
async function encode(kind, width, height, quality = 0.9) {
  const chunks = await page.evaluate(
    async ({ kind, width, height, quality }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      // Flat areas rather than a gradient: a screenshot of a real UI is mostly flat
      // colour, which is what keeps this fixture kilobytes instead of megabytes.
      ctx.fillStyle = '#f4f6fb';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#2b3a67';
      ctx.fillRect(0, 0, width, height * 0.12);
      ctx.fillStyle = '#dbe4f0';
      for (let r = 0; r < 6; r++) {
        ctx.fillRect(width * 0.06, height * (0.2 + r * 0.12), width * 0.5, height * 0.07);
      }
      ctx.fillStyle = '#f6bd60';
      ctx.beginPath();
      ctx.arc(width * 0.3, height * 0.35, Math.min(width, height) * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2b3a67';
      ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.01);
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(width, 0);
      ctx.stroke();
      const palette = ['#f6bd60', '#84a98c', '#ad5a4a', '#355070', '#b56576'];
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillRect(
          width * (0.62 + (i % 3) * 0.12),
          height * (0.2 + Math.floor(i / 3) * 0.19),
          48,
          48,
        );
      }
      const dataUrl = canvas.toDataURL(`image/${kind}`, quality);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const out = [];
      for (let i = 0; i < base64.length; i += 65536) out.push(base64.slice(i, i + 65536));
      return out;
    },
    { kind, width, height, quality },
  );
  return chunks.join('');
}

/**
 * A real animated GIF, written by hand because a browser cannot encode one.
 *
 * The LZW stream is deliberately uncompressed: a clear code follows every pixel, so the
 * decoder's table never grows past its initial size and every code stays 9 bits. That is
 * legal GIF (a decoder must handle a clear code whenever it sees one) and it costs about
 * two bytes per pixel, which for a 32 x 32, two-frame fixture is a few hundred bytes.
 */
async function animatedGif() {
  return page.evaluate(() => {
    const bytes = [];
    const put = (...b) => {
      for (const v of b) bytes.push(v & 0xff);
    };
    const putAll = (list) => {
      for (const b of list) bytes.push(b & 0xff);
    };
    const str = (s) => {
      for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    };
    const le16 = (n) => {
      bytes.push(n & 0xff, (n >> 8) & 0xff);
    };

    // Logical screen descriptor: 32 x 32 with a two-entry global colour table.
    str('GIF89a');
    le16(32);
    le16(32);
    put(0x80); // global colour table present, size field 0 = 2 entries
    put(0x00, 0x00); // background colour index, pixel aspect ratio
    put(0x00, 0x00, 0x00, 0xff, 0xff, 0xff); // the table: black, white

    // NETSCAPE 2.0 application extension: loop the animation forever.
    put(0x21, 0xff, 0x0b);
    str('NETSCAPE2.0');
    put(0x03, 0x01);
    le16(0);
    put(0x00);

    /** Pack LZW codes, LSB first, into sub-blocks of at most 255 bytes. */
    const lzwBlock = (indices) => {
      const minCodeSize = 2;
      const clear = 1 << minCodeSize;
      const eoi = clear + 1;
      const codeSize = minCodeSize + 1; // 9 bits, and it never has to grow
      let buffer = 0;
      let held = 0;
      const out = [];
      const emit = (code) => {
        buffer |= code << held;
        held += codeSize;
        while (held >= 8) {
          out.push(buffer & 0xff);
          buffer >>= 8;
          held -= 8;
        }
      };
      emit(clear);
      for (const index of indices) {
        emit(index);
        emit(clear);
      }
      emit(eoi);
      if (held > 0) out.push(buffer & 0xff);
      return out;
    };

    const frame = (offset) => {
      // Graphic control extension: 100 ms delay, disposal method "do not dispose".
      put(0x21, 0xf9, 0x04, 0x04);
      le16(10);
      put(0x00, 0x00); // no transparent colour, block terminator
      put(0x2c); // image descriptor, full frame, no local colour table
      le16(0);
      le16(0);
      le16(32);
      le16(32);
      put(0x00);
      put(2); // LZW minimum code size
      const data = lzwBlock(
        Array.from({ length: 32 * 32 }, (_, i) => ((i + offset) % 8 < 4 ? 0 : 1)),
      );
      for (let i = 0; i < data.length; i += 255) {
        const slice = data.slice(i, i + 255);
        put(slice.length);
        putAll(slice);
      }
      put(0x00); // data block terminator
    };

    frame(0);
    frame(4);
    put(0x3b); // trailer
    return bytes;
  });
}

const png = await encode('png', 1440, 900);
const jpeg = await encode('jpeg', 4032, 3024, 0.5);
const webp = await encode('webp', 640, 480);
const smallPng = await encode('png', 24, 24);
const smallJpeg = await encode('jpeg', 24, 24);
const gif = await animatedGif();

const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>\n`;
const pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

const out = `// Real image bytes for story 12's tests, held as base64. Every one of them was produced by
// a real encoder — tools/make-image-fixtures.mjs, a browser canvas for the raster formats
// and a hand-written GIF writer for the animated one. The suites do not run that generator:
// these constants are the fixtures, and they are checked to decode by tests/unit/image-format.
//
// Base64 rather than files on disk because the same bytes are needed by a node unit test, by
// a test that runs inside the Workers runtime (where the fixture directory is not readable)
// and by a browser page that has to be handed a synthetic file drop.

/** A real PNG screenshot: 1440 x 900, the size of a laptop display. */
export const PNG_1440x900_B64 = ${JSON.stringify(png)};

/** A real JPEG photo: 4032 x 3024, a phone camera's output. */
export const JPEG_4032x3024_B64 = ${JSON.stringify(jpeg)};

/** A real WebP still: 640 x 480. */
export const WEBP_640x480_B64 = ${JSON.stringify(webp)};

/** The same PNG encoder at 24 x 24: real bytes at the size a unit test wants. */
export const PNG_24_B64 = ${JSON.stringify(smallPng)};

/** The same JPEG encoder at 24 x 24. */
export const JPEG_24_B64 = ${JSON.stringify(smallJpeg)};

/** A real animated GIF: two frames, looping forever. */
export const GIF_ANIMATED_B64 = ${JSON.stringify(toB64(gif))};

/** An SVG that carries a script: never an accepted upload, whatever it is named. */
export const SVG_WITH_SCRIPT = ${JSON.stringify(svg)};

/** The first bytes of a PDF: the shape of a document, not an image. */
export const PDF_B64 = ${JSON.stringify(toB64(Buffer.from(pdf, 'latin1')))};
`;

writeFileSync('tests/fixtures/images/index.ts', out);
await browser.close();
console.log(
  `wrote tests/fixtures/images/index.ts (png ${png.length}, jpeg ${jpeg.length}, webp ${
    webp.length
  }, gif ${gif.length} bytes of base64)`,
);
