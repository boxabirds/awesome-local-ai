/**
 * Story 12: image fixtures (tests/fixtures/images).
 *
 * Real image bytes for the unit / integration / component / e2e suites.
 * Pure TypeScript (no Node builtins): the PNG is built with a stored-block
 * zlib writer (valid deflate: uncompressed blocks + Adler-32), so the IDAT
 * inflates to the exact scanlines and the PNG decodes in browsers, node and
 * workerd alike.
 *
 * - `makePng(width, height, rgb)` — a real decodable solid-color PNG
 *   (the 1440x900 "screenshot" fixtures are made with this);
 * - `JPEG_BYTES` / `makeGif()` / `WEBP_BYTES` — small real JPEG (canonical
 *   minimal baseline JPEG), a two-frame animated GIF (hand-built valid
 *   GIF89a) and a minimal WebP (RIFF/WEBP container);
 * - `makeSvgWithScript()` / `makePdf()` / `makeCorruptPng()` — the negative
 *   fixtures (SVG with a script, a PDF disguised as .png, a truncated PNG);
 * - `makeJpegOfSize(n)` — a file of exactly n bytes with a JPEG magic head
 *   (the IMAGE_MAX_BYTES boundary fixtures).
 */

// ---------------------------------------------------------------------------
// zlib stored-block writer (pure): valid deflate, no compression.
// ---------------------------------------------------------------------------

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps raw bytes in a zlib stream made of stored (uncompressed) blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const CHUNK = 0x7fff;
  const bodyLen =
    data.length +
    Math.ceil(data.length / CHUNK) * 5 + // per-block headers
    2 + // CMF/FLG
    4; // Adler-32
  const out = new Uint8Array(bodyLen);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  let offset = 0;
  for (;;) {
    const len = Math.min(CHUNK, data.length - offset);
    const last = offset + len >= data.length;
    out[p] = last ? 0x01 : 0x00; // BFINAL (bit 0), BTYPE = 00 (stored)
    out[p + 1] = len & 0xff;
    out[p + 2] = (len >> 8) & 0xff;
    out[p + 3] = (~len) & 0xff;
    out[p + 4] = ((~len) >> 8) & 0xff;
    p += 5;
    out.set(data.subarray(offset, offset + len), p);
    p += len;
    offset += len;
    if (last) break;
  }
  const adler = adler32(data);
  out[p++] = (adler >> 24) & 0xff;
  out[p++] = (adler >> 16) & 0xff;
  out[p++] = (adler >> 8) & 0xff;
  out[p++] = adler & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder (RGB, 8-bit, filter 0).
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out[0] = (data.length >> 24) & 0xff;
  out[1] = (data.length >> 16) & 0xff;
  out[2] = (data.length >> 8) & 0xff;
  out[3] = data.length & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = Buffer_crc(type, data);
  out[8 + data.length] = (crc >>> 24) & 0xff;
  out[9 + data.length] = (crc >>> 16) & 0xff;
  out[10 + data.length] = (crc >>> 8) & 0xff;
  out[11 + data.length] = crc & 0xff;
  return out;
}

/** CRC32 over the chunk type bytes + data (PNG spec 5.4). */
function Buffer_crc(type: string, data: Uint8Array): number {
  const joined = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) joined[i] = type.charCodeAt(i);
  joined.set(data, 4);
  return crc32(joined);
}

/** Builds a real decodable PNG of `width`x`height` solid-color pixels. */
export function makePng(
  width: number,
  height: number,
  rgb: [number, number, number] = [226, 119, 60],
): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[1 + x * 3 + 1] = rgb[1];
    row[1 + x * 3 + 2] = rgb[2];
  }
  const raw = new Uint8Array(height * row.length);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  return concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small real JPEG (canonical minimal baseline JPEG) + animated GIF
// (hand-built) + WebP (canonical minimal RIFF/WEBP container).
// ---------------------------------------------------------------------------

export const JPEG_BYTES: Uint8Array = fromBase64(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
);

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Two-frame animated GIF, 2x2, white frame then black frame (valid GIF89a). */
export function makeGif(): Uint8Array {
  const header = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    0x02, 0x00, 0x02, 0x00, // width 2, height 2
    0x80, // GCT flag, 2 colors
    0x00, 0x00, // background index 0, aspect 0
    0xff, 0xff, 0xff, // GCT[0] white
    0x00, 0x00, 0x00, // GCT[1] black
  ]);
  const gce = new Uint8Array([0x21, 0xf9, 0x04, 0x08, 0x32, 0x00, 0x00, 0x00]); // delay 50cs
  const imageDesc = new Uint8Array([
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
  ]);
  // LZW solid frame 1 (white, index 0): clear,0,0,0,0 → 04 00
  const lzwWhite = new Uint8Array([0x02, 0x02, 0x04, 0x00, 0x00]);
  // LZW solid frame 2 (black, index 1): clear,1,1,1,1 → 2C 54
  const lzwBlack = new Uint8Array([0x02, 0x02, 0x2c, 0x54, 0x00]);
  return concat([
    header,
    gce,
    imageDesc,
    lzwWhite,
    gce,
    imageDesc,
    lzwBlack,
    new Uint8Array([0x3b]), // trailer
  ]);
}

/** Minimal real WebP (RIFF/WEBP container, canonical embedded bytes). */
export const WEBP_BYTES: Uint8Array = fromBase64(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
);

// ---------------------------------------------------------------------------
// Negative fixtures + exact-limit files.
// ---------------------------------------------------------------------------

export function makeSvgWithScript(): Uint8Array {
  return fromUtf8(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>location="xss"</script><rect width="10" height="10"/></svg>',
  );
}

export function makePdf(): Uint8Array {
  return fromUtf8(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );
}

function fromUtf8(s: string): Uint8Array {
  // ASCII-only content; a TextEncoder-free path (workerd + node + browser).
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** A valid PNG truncated mid-stream: the magic stays, the image is corrupt. */
export function makeCorruptPng(): Uint8Array {
  return makePng(64, 64, [10, 200, 30]).slice(0, 60);
}

/** A file of exactly n bytes with a JPEG magic head. */
export function makeJpegOfSize(n: number): Uint8Array {
  const buf = new Uint8Array(n).fill(0xab);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

/** Base64-encodes bytes (pure; chunked to avoid call-stack limits). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
