// Story 12 fixtures: deterministic in-memory image bytes.
//
// Every fixture is generated in code (no committed binaries):
// - PNG files are REAL PNGs (IHDR/IDAT/IEND, truecolor, zlib "stored"
//   deflate blocks — a valid zlib stream the browser can decode at any
//   size);
// - the animated GIF and the WebP are the exact bytes produced by
//   Pillow (PIL) for a 1x1 two-frame GIF and a 1x1 WebP, embedded below;
// - "JPEG" fixtures carry a real JFIF header (FF D8 FF E0) and padding:
//   nothing in this product decodes a JPEG (the server sniffs magic bytes,
//   the browser rejects over-limit files before decoding, and a decode
//   failure maps to the type message), so a decodable body adds nothing;
// - the SVG and the renamed PDF exist to prove content-based rejection.

import { IMAGE_MAX_BYTES } from '../../../src/shared/config';

// --- CRC-32 / Adler-32 -------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE === null) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
  }
  return CRC_TABLE;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// --- PNG (truecolor, stored-deflate zlib) ------------------------------------

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
}

/** Little-endian u16 (deflate stored-block LEN/NLEN — not PNG order). */
function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** A valid zlib stream: header 78 01 + deflate "stored" blocks + adler32. */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let off = 0; off < data.length; off += 65535) {
    const len = Math.min(65535, data.length - off);
    const last = off + len === data.length ? 1 : 0;
    blocks.push(new Uint8Array([last]));
    blocks.push(u16le(len));
    blocks.push(u16le((~len) & 0xffff));
    blocks.push(data.subarray(off, off + len));
  }
  blocks.push(u32(adler32(data)));
  return concat(blocks);
}

export type PngPainter = (x: number, y: number) => [number, number, number];

/** The default "screenshot" pattern: a deterministic gradient. */
export const screenshotPainter: PngPainter = (x, y) => [
  (x * 13 + 40) & 255,
  (y * 7 + 90) & 255,
  ((x + y) * 3) & 255,
];

/**
 * A real PNG (8-bit truecolor) of `width` x `height`. Every scanline is
 * prefixed with filter byte 0; the IDAT is a valid zlib stream (stored
 * deflate blocks), so the browser decodes it at any size.
 */
export function pngBytes(
  width: number,
  height: number,
  painter: PngPainter = screenshotPainter,
): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = painter(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = concat([u32(width), u32(height), new Uint8Array([8, 2, 0, 0, 0])]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A 1440x900 "screenshot" PNG. */
export function screenshotPngBytes(width = 1440, height = 900): Uint8Array {
  return pngBytes(width, height);
}

// --- JPEG (JFIF header + padding) --------------------------------------------

/**
 * JPEG-shaped bytes: a real JFIF SOI/APP0 header followed by padding up to
 * `totalBytes`. See the module header: nothing decodes these.
 */
export function jpegBytes(totalBytes: number): Uint8Array {
  if (totalBytes < 12) throw new Error('jpegBytes needs at least the 12-byte header');
  const out = new Uint8Array(totalBytes);
  // SOI, APP0 marker, length 16, "JFIF\0", version 1.1, units 1, density.
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe0;
  out[4] = 0x00;
  out[5] = 0x10;
  out.set(new TextEncoder().encode('JFIF'), 6);
  out[10] = 0;
  out[11] = 0x01;
  // Deterministic padding (a repeating pattern, not random: reproducible).
  for (let i = 12; i < totalBytes; i += 1) out[i] = (i * 31 + 7) & 0xff;
  // A trailing EOI-ish pair keeps the bytes from looking like a truncation.
  if (totalBytes >= 14) {
    out[totalBytes - 2] = 0xff;
    out[totalBytes - 1] = 0xd9;
  }
  return out;
}

/** A valid small JPEG for the storage tests (2 MB). */
export function smallJpegBytes(): Uint8Array {
  return jpegBytes(2 * 1024 * 1024);
}

/** Exactly IMAGE_MAX_BYTES — the accepted boundary (image.size_limit). */
export function exactLimitJpegBytes(): Uint8Array {
  return jpegBytes(IMAGE_MAX_BYTES);
}

/** IMAGE_MAX_BYTES + 1 — the first rejected byte (image.size_limit). */
export function overLimitJpegBytes(): Uint8Array {
  return jpegBytes(IMAGE_MAX_BYTES + 1);
}

// --- GIF ---------------------------------------------------------------------

/**
 * A real 1x1 two-frame ANIMATED GIF89a (red, then blue, 100 cs each,
 * infinite loop) — the exact bytes Pillow writes for that image.
 */
export const animatedGifBytes: Uint8Array = hexToBytes(
  '47494638396101000100810000ff000000000000000000000021f904000a00000021ff0b4e45545343415045322e3003010000002c0000000001000100000804000104040021f904000a00000021ff0b4e45545343415045322e3003010000002c0000000001000100810000ff000000000000000000080400010404003b',
);

/** A GIF87a header (sniffing distinguishes 87a from 89a). */
export function gif87aBytes(): Uint8Array {
  return hexToBytes('4749463837610100010000');
}

// --- WebP --------------------------------------------------------------------

/** A real 1x1 WebP (VP8 lossy) — the exact bytes Pillow writes. */
export const webpBytes: Uint8Array = hexToBytes(
  '524946463e000000574542505650382032000000d001009d012a0100010001402625a00274ba01f80003b000fee9221ffbcf9fb9f3f73e7fd19fff94fdf238fe471ffca04000',
);

// --- Non-image files ---------------------------------------------------------

/** An SVG document with a script tag: must be refused by content. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>alert("svg-script")</script><rect width="10" height="10"/></svg>',
  );
}

/** A minimal but genuine PDF, for the "PDF renamed to .png" case. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
  );
}

/**
 * A corrupt PNG: a genuine 32x32 PNG truncated mid-IDAT (the decoder must
 * reject it; createImageBitmap rejects it in the browser).
 */
export function corruptPngBytes(): Uint8Array {
  return pngBytes(32, 32).slice(0, 64);
}

// --- File helpers --------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The dimensions a complete PNG in `bytes` decodes to, or null. (The jsdom
 * component setup's createImageBitmap stub reads this side channel, because
 * jsdom's File has no arrayBuffer(); real browsers decode the bytes
 * themselves.)
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const head =
    bytes.length >= 33 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const IEND_TAIL = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const tail = bytes.slice(-12);
  const complete = tail.length === 12 && tail.every((b, i) => b === IEND_TAIL[i]!);
  if (!head || !complete) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/** The symbol under which fileFromBytes stashes decodable dimensions. */
export const FIXTURE_DIMENSIONS: unique symbol = Symbol('vidi6.fixtureDimensions');

/** A DOM File from bytes (unit/component/e2e fixture construction). */
export function fileFromBytes(name: string, bytes: Uint8Array, type: string): File {
  const file = new File([bytes], name, { type });
  const dims = pngDimensions(bytes);
  if (dims !== null) {
    Object.defineProperty(file, FIXTURE_DIMENSIONS, { value: dims, enumerable: false });
  }
  return file;
}

/** The first IMAGE_SNIFF_BYTES of `bytes` (what the server sniffs). */
export function sniffHead(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, 12);
}
