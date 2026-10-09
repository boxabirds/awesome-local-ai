/**
 * Image fixtures for the story 12 tests (unit / integration / e2e).
 *
 * Everything is generated locally — no external files are downloaded:
 *  - real PNGs are encoded here (IHDR + zlib-deflated scanlines + IEND), so
 *    the browser actually decodes them in the e2e specs;
 *  - the other formats (JPEG / GIF / WebP) are magic-byte-padded bytes, which
 *    is all the worker's sniffer and the client's type gate ever read;
 *  - the "corrupt" / "renamed" / oversized files are derived from those.
 */
import { deflateSync } from 'node:zlib';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder (truecolor, 8-bit, no interlace).
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32be(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

export interface PngPixel {
  (x: number, y: number): [number, number, number];
}

/** Encode a width×height truecolor PNG from a pixel function. */
export function makePng(width: number, height: number, pixel: PngPixel): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r & 0xff;
      raw[o++] = g & 0xff;
      raw[o++] = b & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** A solid-color PNG. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  return makePng(width, height, () => rgb);
}

/** A two-tone PNG (left/right halves) so tests can tell images apart visually. */
export function halfPng(width: number, height: number, a: [number, number, number], b: [number, number, number]): Uint8Array {
  return makePng(width, height, (x) => (x < width / 2 ? a : b));
}

/* ------------------------------------------------------------------ *
 * Synthetic (magic-byte only) fixtures.
 * ------------------------------------------------------------------ */

function pad(head: Uint8Array, total: number): Uint8Array {
  const out = new Uint8Array(total);
  out.set(head, 0);
  return out;
}

/** JPEG magic (FF D8 FF E0 … JFIF) padded to `total` bytes. */
export const jpegBytes = (total: number): Uint8Array =>
  pad(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Math.max(total, 12));

/** GIF87a / GIF89a magic padded to `total` bytes. */
export const gifBytes = (total: number, variant: '87a' | '89a' = '89a'): Uint8Array =>
  pad(
    new Uint8Array([0x47, 0x49, 0x46, 0x38, variant === '87a' ? 0x37 : 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]),
    Math.max(total, 10),
  );

/** RIFF…WEBP (VP8L) magic padded to `total` bytes. */
export const webpBytes = (total: number): Uint8Array =>
  pad(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]), Math.max(total, 16));

/** A minimal SVG document that contains a script tag (must be rejected). */
export const svgWithScript: Uint8Array = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);

/** A minimal PDF (the "renamed to .png" fixture). */
export const pdfBytes: Uint8Array = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\nxref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
);

/** A PNG cut short mid-IDAT (the "corrupt" fixture). */
export const corruptPng = (width = 32, height = 32): Uint8Array => {
  const png = solidPng(width, height, [200, 30, 30]);
  return png.slice(0, Math.max(1, png.length - 12));
};

/** Exactly `total` bytes starting with the given magic (size-limit tests). */
export const sizedBytes = (total: number, magic: Uint8Array): Uint8Array => pad(magic, total);

/** The PRD boundary cases in one place. */
export const pngJpegAtLimit = { at: IMAGE_MAX_BYTES, over: IMAGE_MAX_BYTES + 1 };
