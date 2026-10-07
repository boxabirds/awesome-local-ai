/**
 * Image files for the tests, made out of bytes rather than checked in as binaries
 * (`tests/fixtures/image-fixtures.ts`, story 12).
 *
 * A test about `image.types` is a test about *content*, so the fixtures have to be
 * honest about content in a way a comment cannot be: a "PDF renamed to .png" is a
 * file whose bytes start `%PDF` and whose name ends `.png`, and a "valid PNG" is a
 * file a real browser will decode and show. Anything less would let a test pass that
 * should not: a fixture that was only ever a magic-number stub would happily accept
 * a server that stored bytes it could never serve, and a fixture that was a real PNG
 * renamed `.pdf` would happily accept a client that judged files by their names.
 *
 * So there are two kinds of fixture here, and the difference between them is stated
 * on every one:
 *
 * - **decodable** images, built byte by byte: {@link pngBytes} writes a whole PNG -
 *   signature, `IHDR`, an uncompressed (`stored`) `IDAT` deflate stream, `IEND`, with
 *   the CRC32 of every chunk and the Adler-32 of the stream, because that is what a
 *   PNG is. It is a real image that Chrome, Firefox and WebKit all draw, which is
 *   what the e2e suite puts into a real `<img>` and resizes. It is written by hand
 *   rather than with a library because the alternative is a dependency in front of a
 *   test whose whole subject is the bytes.
 * - **signature-only** images: {@link jpegBytes}, {@link gifBytes}, {@link webpBytes}
 *   and friends carry a correct signature and then filler. Nothing here decodes a
 *   JPEG - but nothing in this story's server needs to, because the Worker's decision
 *   is made from the first twelve bytes and the size, and the browser's from the
 *   type the file claims. Where a test needs an image that *decodes* it is a PNG.
 *
 * Nothing in this file reaches for a Node or browser API: it is imported by tests
 * that run in workerd as well as by tests that run in a DOM.
 */

import { IMAGE_MAX_BYTES } from '../../src/shared/config.js';

/** The first bytes of a PNG ({@link pngBytes} writes the rest). */
export const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47] as const;
/** The first bytes of a JPEG. */
export const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff] as const;
/** The first bytes of a PDF, which is what a renamed `.png` PDF still starts with. */
export const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46] as const;

/** A `Uint8Array` from a list of byte values, for the signature-only fixtures. */
export function bytes(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

/**
 * A copy of these bytes in a plain `ArrayBuffer`, ready to hand to `new File()`,
 * `new Blob()` or Playwright's `setInputFiles`, whose `buffer` is typed as exactly
 * that rather than as "some kind of buffer".
 */
export function blobPart(source: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

/* ------------------------------------------------------------------ PNG, real */

/** The eight bytes every PNG starts with, which is how `sniffImageType` knows one. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_POLYNOMIAL = 0xedb88320;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a PNG chunk carries, over its type and its data together. */
function crc32(chunks: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      crc = (CRC_TABLE[(crc ^ (chunk[index] as number)) & 0xff] as number) ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The Adler-32 that closes a zlib stream. */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let index = 0; index < data.length; index += 1) {
    a = (a + (data[index] as number)) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) >>> 0) + a) >>> 0;
}

const ascii = (text: string): Uint8Array => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

const uint32 = (value: number): Uint8Array =>
  Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

const uint16Le = (value: number): Uint8Array => Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]);

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const kind = ascii(type);
  return concat([uint32(data.length), kind, data, uint32(crc32([kind, data]))]);
}

/**
 * A zlib stream of stored (uncompressed) deflate blocks.
 *
 * Deflate's stored block *is* the format's "just put the bytes here" mode: a flag
 * byte, the length, the ones'-complement of the length, and the bytes. It is a
 * perfectly legal, perfectly valid deflate stream that every decoder has to
 * implement, and it means this file needs no deflate implementation - which is the
 * entire reason the fixtures are PNG rather than JPEG, whose baseline encoding is a
 * Huffman-coded DCT that is not worth writing for a test.
 */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.from([0x78, 0x01])]; // CMF/FLG: deflate, 32K window
  const MAX_BLOCK = 65_535;
  let at = 0;
  do {
    const size = Math.min(MAX_BLOCK, data.length - at);
    const last = at + size >= data.length;
    blocks.push(Uint8Array.from([last ? 1 : 0]));
    blocks.push(uint16Le(size));
    blocks.push(uint16Le(~size & 0xffff));
    blocks.push(data.subarray(at, at + size));
    at += size;
    // A stream of length zero still has to say "nothing, finished".
    if (data.length === 0) break;
  } while (at < data.length);
  blocks.push(uint32(adler32(data)));
  return concat(blocks);
}

/**
 * A real, decodable PNG: `width` x `height`, 8-bit grayscale, with a vertical
 * gradient so two images of the same size are visibly two images.
 *
 * Grayscale is the cheapest colour type that every browser draws - one byte a pixel,
 * no palette - and a gradient is the cheapest way for a test to tell one screenshot
 * from another by looking at the pixels rather than by trusting a name.
 */
export function pngBytes(width: number, height: number, tone = 0): Uint8Array {
  const header = new Uint8Array(13);
  const put = (at: number, value: number): void => {
    header[at] = (value >>> 24) & 0xff;
    header[at + 1] = (value >>> 16) & 0xff;
    header[at + 2] = (value >>> 8) & 0xff;
    header[at + 3] = value & 0xff;
  };
  put(0, width);
  put(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: grayscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlacing

  const raw = new Uint8Array(height * (1 + width));
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    raw[at] = 0; // this row is not filtered
    at += 1;
    for (let column = 0; column < width; column += 1) {
      raw[at] = (row * 3 + column + tone * 71) % 256;
      at += 1;
    }
  }

  return concat([
    bytes(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A PNG that stops in the middle of its data: signed like a PNG, undecodable. */
export function truncatedPngBytes(): Uint8Array {
  const whole = pngBytes(8, 8);
  return whole.slice(0, Math.floor(whole.length / 2));
}

/* --------------------------------------------------- signature-only fixtures */

/**
 * A file that is a JPEG as far as its signature and its size are concerned.
 *
 * `IMAGE_SNIFF_BYTES` bytes of a real JPEG header, then filler. Enough for the
 * Worker's decision (three bytes) and for the client's (the `File.type` the caller
 * gives it), not enough for a browser to draw - which is why nothing in this story
 * puts one in an `<img>`.
 */
export function jpegBytes(total: number, filler = 0x41): Uint8Array {
  const out = new Uint8Array(total).fill(filler);
  out.set(JPEG_MAGIC_BYTES);
  // A JPEG's fifth byte is the start of a marker; `\0` is not one, and the App0
  // "JFIF" comment is what a real camera file carries. Neither matters here, but a
  // fixture that looks like a JPEG is a fixture nobody has to wonder about.
  out[3] = 0xe0;
  out[4] = 0x00;
  out.set(ascii('JFIF\0'), 5);
  return out;
}

/** A GIF, `GIF87a` or `GIF89a` (the two signatures `sniffImageType` accepts). */
export function gifBytes(version: '87a' | '89a' = '89a'): Uint8Array {
  // Header + logical screen descriptor: a 2 x 2 image, no global colour table.
  return concat([ascii(`GIF${version}`), bytes([0x02, 0x00, 0x02, 0x00, 0x00])]);
}

/** A WebP: `RIFF`, the container length, `WEBP`, and a filler chunk. */
export function webpBytes(): Uint8Array {
  const payload = bytes([0x56, 0x50, 0x38, 0x20, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const size = 4 + payload.length;
  return concat([ascii('RIFF'), uint32LeAll(size), ascii('WEBP'), payload]);
}

/** Little-endian 32-bit, which is what a RIFF container writes its lengths in. */
function uint32LeAll(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/**
 * An SVG that carries a script (`image.types`: the reason the server refuses SVG
 * rather than merely not offering it). Text, not bytes - and the script tag is the
 * point of it: a file that would run code if it were ever served with a permissive
 * `Content-Type`.
 */
export function svgWithScriptBytes(): Uint8Array {
  return ascii(
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>alert("svg")</script><rect width="10" height="10"/></svg>',
  );
}

/** A PDF. Renamed `.png` by {@link renamedPdfFixture}, it is a claim about a file. */
export function pdfBytes(total = 2048): Uint8Array {
  const out = new Uint8Array(total).fill(0x20);
  out.set(ascii('%PDF-1.4\n'));
  out.set(ascii('% a PDF, which is not an image as far as this board is concerned'), 9);
  return out;
}

/** `n` bytes of nothing in particular, which is not any of the four types. */
export function junkBytes(n: number): Uint8Array {
  // Not random: a fixture that changes between runs is a fixture that cannot explain
  // its own failures. Values that are not a signature of anything.
  const out = new Uint8Array(n);
  for (let index = 0; index < n; index += 1) out[index] = (index % 251) + 1 === 0x89 ? 0x01 : (index % 251) + 1;
  return out;
}

/* ------------------------------------------------------------------- fixtures */

/** One file a test can hand to a browser, an input or a `fetch` body. */
export interface ImageFixture {
  /** The file name, which the client is not allowed to make its decision from. */
  name: string;
  /** The type the *file* claims to be, which is the claim under test. */
  mimeType: string;
  bytes: Uint8Array;
  /** What the board is expected to do with it. */
  expect: 'accepted' | 'rejected';
}

/** A screenshot-sized PNG (1440 x 900), the way a real one arrives. */
export const screenshotFixture = (): ImageFixture => ({
  name: 'screenshot.png',
  mimeType: 'image/png',
  bytes: pngBytes(1440, 900),
  expect: 'accepted',
});

/** A small PNG, for a test that only needs one that decodes. */
export const smallPngFixture = (tone = 0, name = 'photo.png'): ImageFixture => ({
  name,
  mimeType: 'image/png',
  bytes: pngBytes(40, 30, tone),
  expect: 'accepted',
});

/** A portrait PNG, to show `image.placement_size` scaling the long side. */
export const portraitPngFixture = (): ImageFixture => ({
  name: 'receipt.png',
  mimeType: 'image/png',
  bytes: pngBytes(60, 400, 3),
  expect: 'accepted',
});

/** A photo at the natural size the PRD's examples use, as a signature-only JPEG. */
export const photoFixture = (): ImageFixture => ({
  name: 'DSC_0432.jpg',
  mimeType: 'image/jpeg',
  bytes: jpegBytes(4096),
  expect: 'accepted',
});

/** An animated GIF, by signature. */
export const gifFixture = (): ImageFixture => ({
  name: 'loop.gif',
  mimeType: 'image/gif',
  bytes: gifBytes('89a'),
  expect: 'accepted',
});

/** A WebP. */
export const webpFixture = (): ImageFixture => ({
  name: 'picture.webp',
  mimeType: 'image/webp',
  bytes: webpBytes(),
  expect: 'accepted',
});

/** An SVG carrying a script: refused by both sides, and it must never be stored. */
export const svgFixture = (): ImageFixture => ({
  name: 'diagram.svg',
  mimeType: 'image/svg+xml',
  bytes: svgWithScriptBytes(),
  expect: 'rejected',
});

/** A PDF wearing a PNG's name and a PNG's claimed type: content decides. */
export const renamedPdfFixture = (): ImageFixture => ({
  name: 'holiday.png',
  mimeType: 'image/png',
  bytes: pdfBytes(),
  expect: 'rejected',
});

/** A PNG whose data was cut off: accepted by the checks, refused by the decoder. */
export const corruptPngFixture = (): ImageFixture => ({
  name: 'broken.png',
  mimeType: 'image/png',
  bytes: truncatedPngBytes(),
  expect: 'rejected',
});

/** A PDF that calls itself a PDF, for the `type` branch of `validateFiles`. */
export const documentFixture = (): ImageFixture => ({
  name: 'contract.pdf',
  mimeType: 'application/pdf',
  bytes: pdfBytes(1024),
  expect: 'rejected',
});

/**
 * `total` bytes that start with `magic`.
 *
 * This is not a picture - it is a *file*: the size and the signature are what the
 * board's two checks look at, so this is the fixture for a test about either, and it
 * costs one allocation rather than a whole encoded image.
 */
export function bytesOfLength(total: number, magic: readonly number[]): Uint8Array {
  const out = new Uint8Array(total);
  out.set(magic.slice(0, Math.min(magic.length, total)));
  return out;
}

/** A file of exactly the largest size the board accepts (`image.size_limit`). */
export const atLimitPngFixture = (): ImageFixture => ({
  name: 'exactly-10mb.png',
  mimeType: 'image/png',
  bytes: bytesOfLength(IMAGE_MAX_BYTES, PNG_MAGIC_BYTES),
  expect: 'accepted',
});

/** One byte over it. */
export const overLimitFixture = (): ImageFixture => ({
  name: 'one-byte-over.jpg',
  mimeType: 'image/jpeg',
  bytes: jpegBytes(IMAGE_MAX_BYTES + 1),
  expect: 'rejected',
});

/** An 11 MB JPEG, which is the size the PRD's "over 10 MB" example uses. */
export const elevenMegabyteJpegFixture = (): ImageFixture => ({
  name: 'huge.jpg',
  mimeType: 'image/jpeg',
  bytes: jpegBytes(11 * 1024 * 1024),
  expect: 'rejected',
});

/** Every fixture, for a test that wants them all. */
export const imageFixtures = (): ImageFixture[] => [
  smallPngFixture(),
  photoFixture(),
  gifFixture(),
  webpFixture(),
  svgFixture(),
  renamedPdfFixture(),
  corruptPngFixture(),
];
