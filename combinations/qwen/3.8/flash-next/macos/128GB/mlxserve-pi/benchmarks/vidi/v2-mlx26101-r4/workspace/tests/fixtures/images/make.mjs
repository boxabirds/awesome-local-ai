// Makes the three pictures in this directory that a test drops onto a board.
//
// They are real image files, in three of the four formats the board takes, because an end-to-end test asks whether
// a browser decoded the bytes and drew them: `createImageBitmap` has to measure them, the upload has to carry them,
// the object store has to give them back, and an `<img>` has to have a `naturalWidth` at the other end. None of that
// is testable with a header and some padding, and a picture made up in a test file is not a picture.
//
// Run it with `node tests/fixtures/images/make.mjs` if a file here is ever found to be not what it says it is — the
// fixtures check their own magic bytes when they are loaded, so that is a loud failure rather than a mystery.
//
// It needs two things that are not in the repository:
//   - `sips`, which is the macOS image converter, for the JPEG and the GIF;
//   - Chromium, which is the only encoder here that can write a WebP.
// A machine without them cannot rebuild these files, which is why they are committed rather than generated at test
// time: a test run should not depend on which operating system it happens to be happening on.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = resolve(HERE, '..', '..', '..', '.ua', 'fixtures-work');

/** The PNG encoder, in eleven lines. A picture is IHDR, one compressed IDAT and IEND. */
const CRC = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

/**
 * Flat colour with a diagonal band through it and a rule along two edges: the stripes a screenshot has in it,
 * drawn without a screenshot. The stripes are wide on purpose — a fine pattern is what costs a JPEG hundreds of
 * kilobytes, and these files are read off disk into a browser for every test that drops one.
 */
function stripes(x, y) {
  if (x < 3 || y < 3) return [26, 32, 56];
  if (((x + y) >> 5) % 2 === 0) return [46, 84, 160];
  return [214, 122, 58];
}

/** Four blocks of colour and a rule: enough that a picture drawn the wrong way round looks wrong. */
function blocks(x, y, width, height) {
  const left = x < width / 2;
  const top = y < height / 2;
  if (x < 4 || y < 4 || x > width - 5 || y > height - 5) return [26, 32, 56];
  if (left && top) return [46, 84, 160];
  if (!left && top) return [214, 122, 58];
  if (left && !top) return [232, 226, 208];
  return [92, 142, 110];
}

function png(width, height, paint = stripes) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour with alpha
  const rows = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    rows[at++] = 0; // no filter on the scanline
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y, width, height);
      rows[at++] = r;
      rows[at++] = g;
      rows[at++] = b;
      rows[at++] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The intermediate PNG a format is converted from, in a working directory nobody else is looking at. */
function source(name, width, height, paint) {
  mkdirSync(WORK, { recursive: true });
  const path = join(WORK, name);
  writeFileSync(path, png(width, height, paint));
  return path;
}

function convert(from, out, format) {
  const run = spawnSync('sips', ['-s', 'format', format, from, '--out', join(HERE, out)], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error(`sips could not make ${out} (${run.stderr || run.stdout}); see the note at the top of this file`);
  }
  console.log(`made ${out} (${readFileSync(join(HERE, out)).length} bytes)`);
}

/** WebP has no encoder in macOS, but every browser the board is tested in can draw one, and Chromium can write one. */
async function webp(from, out, quality) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(
      async ({ href, min } ) => {
        const image = new Image();
        image.src = href;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas.toDataURL('image/webp', min);
      },
      { href: `data:image/png;base64,${readFileSync(from).toString('base64')}`, min: quality },
    );
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    writeFileSync(join(HERE, out), Buffer.from(base64, 'base64'));
    console.log(`made ${out} (${readFileSync(join(HERE, out)).length} bytes)`);
  } finally {
    await browser.close();
  }
}

// A wide photograph: twice as wide as it is tall, and larger on its longest side than the size the board places a
// picture at, so a test can tell "placed at its own size" from "placed at the largest size it is allowed".
convert(source('photo-source.png', 1600, 900, blocks), 'photo.jpg', 'jpeg');
// A picture at a size a screenshot might be, in the one format whose magic bytes are a string of letters.
convert(source('gif-source.png', 320, 200, stripes), 'picture.gif', 'gif');
// Four three, and smaller than the placement limit, so it is placed at its own size.
await webp(source('webp-source.png', 640, 480, blocks), 'picture.webp', 0.9);
