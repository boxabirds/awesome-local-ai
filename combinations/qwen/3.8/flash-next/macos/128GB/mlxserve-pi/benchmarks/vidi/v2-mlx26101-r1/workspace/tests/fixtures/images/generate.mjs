// How the image fixtures in this directory are made.
//
//   node tests/fixtures/images/generate.mjs
//
// Everything is generated here rather than committed from the internet: the tests need real,
// decodable files (a `<img>` that actually loads, a `createImageBitmap` that actually resolves),
// and they need files whose *bytes* are the point — a PDF that really starts with %PDF but is
// named .png, a PNG cut off in the middle, a JPEG of an exact size. Chromium does the PNG/JPEG/
// WebP encoding (canvas.toDataURL), the GIF and the PDF are written here, and every file is read
// back in a browser at the end to prove it decodes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- PNG / JPEG / WebP, via canvas

/**
 * A picture that looks like something: a light background, a coloured header bar, a few blocks.
 * Flat colours, so the PNG stays small while still being a real screenshot-shaped image.
 */
function drawPicture(ctx, width, height) {
  ctx.fillStyle = '#f7f7f5';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(0, 0, width, Math.round(height * 0.12));
  ctx.fillStyle = '#ffffff';
  const pad = Math.round(width * 0.04);
  const box = Math.round(width * 0.18);
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(pad + i * (box + pad), Math.round(height * 0.3), box, Math.round(height * 0.4));
  }
  ctx.fillStyle = '#1b1d23';
  for (let row = 0; row < 6; row += 1) {
    ctx.fillRect(pad, Math.round(height * 0.78) + row * 6, Math.round(width * (0.3 + 0.08 * row)), 3);
  }
  // A little noise, so a JPEG of it has something to compress and is not a single block colour.
  for (let i = 0; i < 400; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${(i % 7) / 40})`;
    ctx.fillRect((i * 37) % width, (i * 91) % height, 7, 7);
  }
}

/** Encode the same drawing in a browser, which is the only honest PNG/JPEG/WebP encoder around. */
async function encode(page, width, height, type, quality) {
  return page.evaluate(
    ({ width, height, type, quality, drawSource }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // The drawing function is passed as a string and run here, so the canvas code lives in the
      // browser while the file layout lives in Node.
      new Function('ctx', 'width', 'height', drawSource)(ctx, width, height);
      return canvas.toDataURL(type, quality);
    },
    { width, height, type, quality, drawSource: drawPicture.toString() },
  );
}

async function bytesFromDataUrl(page, type, width, height, quality) {
  const dataUrl = await encode(page, width, height, type, quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  // Decode it again in the browser: a fixture that fails here would fail in a test later.
  const ok = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
    try {
      const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/x' }));
      bitmap.close();
      return true;
    } catch {
      return false;
    }
  }, base64);
  if (!ok) throw new Error(`${type} ${width}x${height} did not decode`);
  return bytes;
}

// ------------------------------------------------------------------------ GIF89a, by hand

/**
 * GIF LZW as an encoder that never actually compresses (the classic "uncompressed GIF" method):
 * a clear code and then one code per pixel. The codes are only half the job — a decoder widens
 * its read width as the string table fills, and it fills one code later for the decoder than for
 * the encoder, because neither of them adds a table entry for the first code after a clear. That
 * is the whole trick, and the reason the bookkeeping below is spelled out.
 */
function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = [];
  let acc = 0;
  let held = 0;
  let width = minCodeSize + 1;
  let next = clear + 2; // the table entry the next added pair would get
  let first = true; // the first code after a clear starts a string, it adds nothing
  const write = (code) => {
    acc |= code << held;
    held += width;
    while (held >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      held -= 8;
    }
  };
  const reset = () => {
    width = minCodeSize + 1;
    next = clear + 2;
    first = true;
  };
  write(clear);
  reset();
  for (const index of indices) {
    write(index);
    if (first) {
      first = false;
      continue;
    }
    next += 1;
    if (next >= 1 << width) {
      if (width === 12) {
        // No room left in a 12-bit code: start the table over, which is what a clear code is for.
        write(clear);
        reset();
      } else {
        width += 1;
      }
    }
  }
  write(eoi);
  if (held > 0) out.push(acc & 0xff);
  return out;
}

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const size = Math.min(255, bytes.length - i);
    out.push(size, ...bytes.slice(i, i + size));
  }
  out.push(0);
  return out;
}

const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];

/** An animated GIF: `frames` images of two colours each, looping forever. */
function gifBytes(width, height, frames) {
  const bytes = [
    ...'GIF89a'.split('').map((c) => c.charCodeAt(0)),
    ...le16(width),
    ...le16(height),
    0xf0, // global colour table, 8-bit colour resolution, 2 entries
    0, // background index
    0, // pixel aspect ratio
    // global colour table: white and a blue
    0xff, 0xff, 0xff, 0x25, 0x63, 0xeb,
    // the NETSCAPE 2.0 application extension: loop forever
    0x21, 0xff, 0x0b,
    ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)),
    0x03, 0x01, 0x00, 0x00, 0x00,
  ];
  frames.forEach((frame, index) => {
    bytes.push(
      // a graphic control extension, so the frame count is real and not decorative: its four
      // data bytes are disposal, the two delay bytes and a transparent index, and then the
      // zero-length block that ends it
      0x21, 0xf9, 0x04, 0x04, ...le16(20), 0x00, 0x00,
      // the image descriptor
      0x2c,
      ...le16(0),
      ...le16(0),
      ...le16(width),
      ...le16(height),
      0x00,
    );
    const indices = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) indices.push(frame(x, y, index) ? 1 : 0);
    }
    // The LZW minimum code size, then the data as sub-blocks; the zero-length sub-block that
    // ends them is what `subBlocks` writes, so nothing else goes between it and the next block.
    bytes.push(2, ...subBlocks(lzwEncode(indices, 2)));
  });
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------------- fixtures

const SVG_WITH_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">
  <rect width="100" height="80" fill="#f7f7f5" />
  <circle cx="50" cy="40" r="24" fill="#2563eb" />
  <script>document.body.textContent = 'ran from an image'</script>
</svg>
`;

/** The smallest thing that is honestly a PDF: a header, one empty page, an EOF. */
const MINIMAL_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
trailer << /Root 1 0 R /Size 4 >>
%%EOF
`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  /** @type {Array<[string, Uint8Array | string]>} */
  const files = [];

  files.push(['screenshot-1440x900.png', await bytesFromDataUrl(page, 'image/png', 1440, 900)]);
  files.push(['diagram-1000x400.png', await bytesFromDataUrl(page, 'image/png', 1000, 400)]);
  files.push(['swatch-100x100.png', await bytesFromDataUrl(page, 'image/png', 100, 100)]);
  // A phone photo: the big natural size story 12 talks about. Quality is what keeps the file
  // a fixture rather than a megabyte haul.
  files.push(['photo-4032x3024.jpg', await bytesFromDataUrl(page, 'image/jpeg', 4032, 3024, 0.6)]);
  files.push(['picture.webp', await bytesFromDataUrl(page, 'image/webp', 320, 240, 0.9)]);

  const animation = gifBytes(24, 16, [
    (x, y, frame) => (x + y + frame * 6) % 12 < 6,
    (x, y, frame) => (x - y + frame * 4) % 10 < 5,
    (x, y, frame) => (x * y + frame) % 7 < 3,
  ]);
  files.push(['animation.gif', animation]);
  files.push(['script.svg', SVG_WITH_SCRIPT]);
  files.push(['renamed-pdf.png', MINIMAL_PDF]);

  const png = files[0][1];
  files.push(['truncated.png', Uint8Array.prototype.slice.call(png, 0, Math.floor(png.length * 0.4))]);

  for (const [name, content] of files) {
    const path = join(here, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : Buffer.from(content));
    console.log(`${name}: ${typeof content === 'string' ? content.length : content.length} bytes`);
  }

  // Prove every image fixture decodes, and that the ones that must not, do not.
  const report = await page.evaluate(async (entries) => {
    const out = [];
    for (const { name, base64, shouldDecode } of entries) {
      const bin = atob(base64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
      let decoded = false;
      let width = 0;
      let height = 0;
      try {
        const bitmap = await createImageBitmap(new Blob([buf]));
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
        decoded = true;
      } catch {
        decoded = false;
      }
      out.push({ name, decoded, width, height, ok: decoded === shouldDecode });
    }
    return out;
  },
    files
      .filter(([name]) => !name.endsWith('.svg'))
      .map(([name, content]) => ({
        name,
        base64: Buffer.from(typeof content === 'string' ? '' : content).toString('base64'),
        // A renamed PDF and a cut-off PNG are fixtures precisely because they do not decode.
        shouldDecode: name !== 'renamed-pdf.png' && name !== 'truncated.png',
      })),
  );
  for (const row of report) {
    console.log(
      `${row.ok ? 'ok  ' : 'FAIL'} ${row.name} decoded=${row.decoded} ${row.width}x${row.height}`,
    );
    if (!row.ok) process.exitCode = 1;
  }
  if (report.some((row) => !row.ok)) throw new Error('a fixture did not decode as expected');

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
