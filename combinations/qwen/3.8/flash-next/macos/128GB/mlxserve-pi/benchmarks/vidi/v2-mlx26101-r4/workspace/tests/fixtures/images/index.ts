/**
 * The files an end-to-end test hands to a board.
 *
 * Six real pictures and four files that are not what they are called. The real ones exist because the thing being
 * checked at the far end of an upload is a browser drawing a picture: `createImageBitmap` has to measure it, the
 * Worker has to recognise it from its bytes, the object store has to give back the same bytes, and an `<img>` has to
 * report a `naturalWidth` that matches. A file invented out of padding would pass every check up to that last one
 * and then be a test that asserts nothing.
 *
 * The three formats that cannot be written by hand — JPEG, GIF and WebP — are committed as files in this directory
 * and read from disk; `make.mjs` alongside them rebuilds them. Everything else is made here, from a PNG encoder of
 * twelve lines, because a picture whose every byte is in the test file is a picture a reader can check. The
 * differences a test needs are all in the numbers the encoder is given: a screenshot of 1440x900, a portrait of
 * 600x900, a small one of 320x200 that is placed at its own size.
 *
 * The sizes of the four false files are not accidents either: `TOO_BIG` is one byte past what the board takes, and
 * `CORRUPT` has the beginning of a PNG and none of the rest, which is what a file truncated on the way to the
 * clipboard actually looks like.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { IMAGE_MAX_BYTES } from '../../../src/shared/config';

/** One file as a test describes it, before anyone is asked to pick it. */
export interface ImageFixture {
  readonly name: string;
  /** The type the browser says the file is, which is what the board's own first check looks at. */
  readonly type: string;
  readonly bytes: Buffer;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The same files, in the shape Playwright's `setInputFiles` and `fileChooser.setFiles` take. */
export function pickable(
  files: readonly ImageFixture[],
): { name: string; mimeType: string; buffer: Buffer }[] {
  return files.map((file) => ({ name: file.name, mimeType: file.type, buffer: file.bytes }));
}

// ---------------------------------------------------------------------------
// A PNG encoder, so that a picture can be made at whatever size a test is about
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

/** Wide bands of two colours, with a dark rule along the top and left: a screenshot, drawn without a screen. */
function bands(x: number, y: number): [number, number, number] {
  if (x < 3 || y < 3) return [26, 32, 56];
  return ((x + y) >> 5) % 2 === 0 ? [46, 84, 160] : [214, 122, 58];
}

/**
 * A PNG of the given size.
 *
 * This is a duplicate of the encoder in `make.mjs`, and deliberately so: that file is plain Node run by a person,
 * this is TypeScript compiled with the tests, and the two are better off each holding their own copy of eleven
 * lines than the test build depending on a script that only runs on a Mac.
 */
function png(name: string, width: number, height: number): ImageFixture {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour, with alpha
  const rows = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    rows[at++] = 0; // an unfiltered scanline
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = bands(x, y);
      rows[at++] = r;
      rows[at++] = g;
      rows[at++] = b;
      rows[at++] = 255;
    }
  }
  return {
    name,
    type: 'image/png',
    bytes: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  };
}

/** Reads a committed picture, and refuses to hand out anything that is not the format it is named for. */
function committed(name: string, type: string, magic: { offset: number; bytes: number[] }[]): ImageFixture {
  const bytes = readFileSync(join(HERE, name));
  for (const { offset, bytes: want } of magic) {
    const found = bytes.subarray(offset, offset + want.length);
    if (!want.every((byte, index) => found[index] === byte)) {
      throw new Error(
        `tests/fixtures/images/${name} is not a ${type}; rebuild it with \`node tests/fixtures/images/make.mjs\``,
      );
    }
  }
  return { name, type, bytes };
}

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

/**
 * A screenshot, taller than the whole visible board and wider than the size a picture is placed at — the file a
 * person drops because it is what they were looking at. Its longest side is above `IMAGE_MAX_PLACE_SIZE_WORLD`, so
 * the box it lands in is smaller than the file, at the file's own proportions.
 */
export const SCREENSHOT: ImageFixture = png('screenshot.png', 1440, 900);

/** Portrait: taller than it is wide, so a row of pictures is a row of different shapes and not of squares. */
export const PORTRAIT: ImageFixture = png('portrait.png', 600, 900);

/** Small enough to be placed at its own size, which is the other half of the placement rule. */
export const SMALL: ImageFixture = png('small.png', 320, 200);

/** A JPEG photograph, 1600x900: the biggest of the committed files, and the only one whose first byte is 0xff. */
export const PHOTO: ImageFixture = committed('photo.jpg', 'image/jpeg', [
  { offset: 0, bytes: [0xff, 0xd8, 0xff] },
]);

/** A GIF, 320x200 — the one format whose magic bytes spell something. */
export const GIF: ImageFixture = committed('picture.gif', 'image/gif', [
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
]);

/** A WebP, 640x480: `RIFF` at the start and `WEBP` eight bytes later, which is both of the checks the board makes. */
export const WEBP: ImageFixture = committed('picture.webp', 'image/webp', [
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
]);

/** Everything the board takes, for a test that wants one of each. */
export const ALL_PICTURES: readonly ImageFixture[] = [SMALL, SCREENSHOT, PORTRAIT, PHOTO, GIF, WEBP];

// ---------------------------------------------------------------------------
// The files that are not pictures, or are more of one than the board takes
// ---------------------------------------------------------------------------

/** A PDF, named `.png`. The browser calls it a PNG — that is what the picker is told by the extension — and the
 * only thing that can say otherwise is the decoder, which does. */
export const RENAMED_PDF: ImageFixture = {
  name: 'invoice.png',
  type: 'image/png',
  bytes: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n', 'latin1'),
};

/** One byte past the largest file the board takes. */
export const TOO_BIG: ImageFixture = {
  name: 'huge.png',
  type: 'image/png',
  bytes: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(IMAGE_MAX_BYTES + 1 - 8, 0x20),
  ]),
};

/** A PNG that stops in the middle: the header is a promise and the rest of the file is not there. */
export const CORRUPT: ImageFixture = {
  name: 'corrupt.png',
  type: 'image/png',
  bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
};

/** A picture that is also a program, in the one format that is. The board does not take this one. */
export const SVG: ImageFixture = {
  name: 'logo.svg',
  type: 'image/svg+xml',
  bytes: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=\'pwned\'">' +
      '<script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>',
    'utf8',
  ),
};
