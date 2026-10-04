/**
 * Image fixtures that are *built* rather than read.
 *
 * The files in `images/` are the ones a browser needs: a real 4032x3024 photograph, an animated GIF, a
 * screenshot with something drawn on it. They are read from disk by the node-side tests and by the e2e
 * suite, which runs with a node process that has a file system.
 *
 * The integration tests do not have that. They run inside the Workers runtime, where there is no way to
 * open this directory - workerd's `node:fs` is a sandbox that does not contain the project - so the
 * fixtures those tests need are made here, out of nothing but the language itself: a PNG assembled from
 * its chunks and deflated with the runtime's own {@link CompressionStream}, a JPEG and a WebP carried in
 * as the base64 that `images/generate.mjs` wrote into `../embeddedImages.ts`.
 *
 * Everything here is real in the sense that matters to the tests: the bytes produced are bytes a real
 * decoder accepts, and the file a test claims to upload is the file it uploads. Nothing is a stand-in a
 * worker could mistake for an image while a real one could not.
 *
 * No node-only imports, and no `Buffer`: this module is imported by code that runs in workerd.
 */
import { TINY_JPEG_BASE64, TINY_WEBP_BASE64 } from './embeddedImages';

/* -------------------------------------------------------------------------- small utilities */

/**
 * A byte source from base64, using the `atob` every runtime in this repo has.
 *
 * The characters are turned into bytes one at a time rather than with `Buffer.from(x, 'base64')`, which
 * is the shorter way to write it and is not available inside a Worker.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * `size` bytes that look like nothing.
 *
 * Deterministic, because a test that uploads "random bytes" and then fails is a test nobody can rerun.
 * The stream is a multiply-with-carry generator, which is not for cryptography and is not used for any:
 * it produces the 193-byte file of a PDF's leading noise as readily as it produces the three bytes of
 * TC-01's "3 random bytes".
 */
export function pseudorandomBytes(size: number, seed = 0x2f6e2b1): Uint8Array {
  let state = seed >>> 0;
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state >>> 7, 2147483647) ^ Math.imul(state & 0x7fffffff, 0x6d2b79f5)) >>> 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint16LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function uint32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

/* ------------------------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    // `?? 0` because the table is indexed by a value the compiler cannot see is in range; the table has
    // all 256 entries, so it is never actually missing.
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([ascii(type), data]);
  return concat([uint32BE(data.length), body, uint32BE(crc32(body))]);
}

/**
 * A `Blob` of these bytes.
 *
 * The bytes are copied on the way in: `Blob`'s constructor is typed against `ArrayBufferView` under the
 * Workers type set and against `BufferSource` under the DOM one, and the one thing both of them accept
 * without argument is a plain array of the byte type itself.
 */
function blobOf(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

/** The zlib-wrapped deflate a PNG's IDAT chunk is made of, with the runtime's own compressor. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(bytes).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The colour of one pixel of {@link pngBytes}: bands, a disc and a stripe, so it is not flat. */
export type PixelColour = (x: number, y: number) => readonly [number, number, number];

export const screenshotPixel: PixelColour = (x, y) => {
  const dx = x - 700;
  const dy = y - 420;
  if (dx * dx + dy * dy < 180 * 180) {
    return [(x * 7) % 256, (y * 3) % 256, 200];
  }
  if (y > 820) {
    return x % 40 < 20 ? [40, 44, 52] : [238, 241, 245];
  }
  return Math.floor(y / 60) % 2 === 0 ? [226, 232, 240] : [203, 213, 225];
};

/**
 * A real PNG of `width` x `height`: 8-bit truecolour, one filter byte 0 per row, the pixel data deflated.
 *
 * This is the whole of what a PNG is, in about thirty lines, and the result is a file a browser decodes
 * - which is the only reason it exists. A test that wants to upload a PNG wants one whose *bytes* are a
 * PNG's bytes, because the thing under test reads those bytes and nothing else.
 */
export async function pngBytes(
  width = 1440,
  height = 900,
  colourOf: PixelColour = screenshotPixel,
): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  header.set(uint32BE(width), 0);
  header.set(uint32BE(height), 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourOf(x, y);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', await deflate(concat(rows))),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * A PNG that stops in the middle of its pixel data.
 *
 * The signature is a PNG's signature and the file is undecodeable - which is the difference between the
 * case the browser catches (`createImageBitmap` rejects) and the case the worker catches (it does not
 * decode anything at all, and so accepts it). TC-29 is about the first of those.
 */
export async function truncatedPngBytes(head = 400): Promise<Uint8Array> {
  return (await pngBytes(64, 48)).subarray(0, head);
}

/* ----------------------------------------------------------------------------------- JPEG */

/** The 16x12 JPEG fixture, decoded from what the generator wrote. */
export function jpegBytes(): Uint8Array {
  return base64ToBytes(TINY_JPEG_BASE64);
}

/**
 * A JPEG of exactly `length` bytes, made by putting comment segments into the fixture until it weighs that.
 *
 * A JPEG is SOI, a run of segments, then EOI, and a comment segment (`FF FE`, a two-byte length, some
 * bytes) is something every decoder is required to skip - which is what makes this the honest way to
 * reach ten megabytes. The alternative, a file of random bytes that begins `FF D8 FF`, would pass the
 * sniff and be a lie about being a photograph; this is a photograph with padding in it that no decoder is
 * asked to look at.
 */
export function jpegBytesOfLength(length: number): Uint8Array {
  const base = jpegBytes();
  if (length < base.length + 4) {
    throw new Error(
      `a JPEG fixture of ${length} bytes is smaller than the ${base.length}-byte JPEG it is made from plus one comment segment`,
    );
  }
  // How many comment bytes go in each segment. A segment is four bytes of marker and length plus up to
  // 65533 bytes of comment, so the sizes it can add to the file run from 4 to 65537 - and reaching an
  // exact weight is dividing by those, with one adjustment: when the greediest segment leaves behind one,
  // two or three bytes, there is no segment that can hold that many, so the segment before it gives up
  // the difference.
  const comments: number[] = [];
  let remaining = length - base.length;
  while (remaining > 0) {
    let segment = Math.min(remaining, 65537);
    const left = remaining - segment;
    if (left > 0 && left < 4) {
      segment -= 4 - left;
    }
    comments.push(segment - 4);
    remaining -= segment;
  }
  const segments: Uint8Array[] = [base.subarray(0, 2)]; // SOI
  for (const comment of comments) {
    // The comment's own bytes are zeros, which a decoder is obliged not to look at.
    segments.push(
      new Uint8Array([0xff, 0xfe, ((comment + 2) >>> 8) & 0xff, (comment + 2) & 0xff]),
      new Uint8Array(comment),
    );
  }
  segments.push(base.subarray(2));
  const file = concat(segments);
  if (file.length !== length) {
    // Cannot happen, and worth saying so in the one place that would notice: a test that asked for ten
    // megabytes and got ten megabytes and one byte is a boundary test that tested the wrong boundary.
    throw new Error(`built a JPEG of ${file.length} bytes when asked for ${length}`);
  }
  return file;
}

/* ----------------------------------------------------------------------------------- WebP */

/** The 16x12 WebP fixture, decoded from what the generator wrote. */
export function webpBytes(): Uint8Array {
  return base64ToBytes(TINY_WEBP_BASE64);
}

/* --------------------------------------------------------------------- the refused fixtures */

/** The leading bytes of a PDF - the first thing a renamed PDF gives the sniffer. */
export function pdfBytes(): Uint8Array {
  return ascii('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n%%EOF\n');
}

/** An SVG with a script in it: a file that is an image to a browser and a program to a server. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f3a"/><script>alert(document.cookie)</script></svg>\n`,
  );
}

/** GIF89a, from the fixture generator's own encoder, for the case where only the header is wanted. */
export function gifHeader(version: '87a' | '89a'): Uint8Array {
  return concat([ascii(`GIF${version}`), uint16LE(32), uint16LE(32), new Uint8Array([0x82, 0x00, 0x00])]);
}

/* ------------------------------------------------------------------------------- the files */

/**
 * A `File` with these bytes, this name and this claimed type.
 *
 * The claim is the point. `File.type` comes from the extension, so a test about a renamed PDF is a test
 * about a File that says one thing and contains another, and the only way to build one of those is to say
 * so here.
 */
export function fileOf(name: string, bytes: Uint8Array, type = 'application/octet-stream'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** `count` files of `bytes` each, named `name-1.png`, `name-2.png`, … */
export function filesOf(name: string, bytes: Uint8Array, count: number, type = 'image/png'): File[] {
  return Array.from({ length: count }, (_unused, index) => fileOf(`${name}-${index + 1}.png`, bytes, type));
}
