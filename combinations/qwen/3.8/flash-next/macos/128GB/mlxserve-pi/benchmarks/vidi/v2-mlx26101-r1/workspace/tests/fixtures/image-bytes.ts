// Image bytes that are built rather than read (story 12).
//
// The real fixture files in `images/` are read with `node:fs` by `image-files.ts`, which is fine for
// the unit, ui-component and e2e suites — all three run in Node. It is not fine for the integration
// suite: those tests run inside workerd, which has no filesystem at all, so a fixture that is loaded
// from disk fails at import, before a single assertion. This module is the answer to that: the same
// kinds of files, assembled from bytes in memory.
//
// How real each one is, stated plainly, because it decides what a test written with them can claim:
//
//   * `pngBytes` writes a **decodable** PNG — signature, IHDR, an IDAT holding raw (stored) deflate
//     blocks, IEND, with the chunk CRCs and the zlib adler32 computed for real. A browser draws it.
//   * `gifBytes` writes a **decodable** GIF89a: a global palette, one graphic control extension and
//     one image whose LZW data is the classic "uncompressed" encoding (clear code every 8 pixels).
//   * `jpegBytes` and `webpBytes` are **signature-grade**: the leading bytes are exactly right and the
//     rest is padding a decoder would not get far with. That is enough for everything the asset
//     endpoints do, which is sniff twelve bytes, count them and hand them back — and it is stated here
//     so nobody writes a test that mistakes one for a picture a browser drew. The decodable JPEG lives
//     in `images/photo-4032x3024.jpg` for the suites that can read it.
//   * `pdfBytes` and `svgBytes` are complete little files of their own kinds, because being *not* an
//     image is the only thing about them a test cares about.
//
// No `node:` import appears in this file, and none should ever be added.

import { IMAGE_MAX_BYTES } from '../../src/shared/config';

const encoder = new TextEncoder();

/** The leading bytes every PNG has. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_POLYNOMIAL = 0xedb88320;
const crcTable: number[] = [];
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? (value >>> 1) ^ CRC_POLYNOMIAL : value >>> 1;
  }
  crcTable.push(value >>> 0);
}

/** PNG's chunk checksum: CRC-32 over the type and the data, as a 32-bit unsigned value. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** zlib's cheap checksum, over the raw bytes the deflate blocks carry. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) >>> 0) + a) >>> 0;
}

/**
 * A zlib stream made of *stored* deflate blocks: no compression at all, which is perfectly legal
 * deflate and means a PNG can be written without a compressor. Each block carries its own length and
 * its complement, and the last one says so.
 */
function storedDeflate(raw: Uint8Array): Uint8Array {
  const blocks: number[] = [];
  let offset = 0;
  do {
    const length = Math.min(raw.length - offset, 0xffff);
    const last = offset + length >= raw.length;
    blocks.push(last ? 1 : 0, length & 0xff, length >>> 8, ~length & 0xff, (~length >>> 8) & 0xff);
    for (let index = 0; index < length; index += 1) blocks.push(raw[offset + index]);
    offset += length;
  } while (offset < raw.length);
  // The zlib header: 0x78 0x01 is "deflate, no compression preset, check bits that add to a multiple
  // of 31", which is the pair every decoder accepts.
  const zlib = [0x78, 0x01, ...blocks];
  const sum = adler32(raw);
  zlib.push((sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff);
  return Uint8Array.from(zlib);
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** A PNG chunk: length, type, data, CRC over type and data. */
function pngChunk(type: string, data: number[]): number[] {
  const body = [...encoder.encode(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}

/**
 * A real, decodable PNG: 8-bit RGB, no interlace, one colour or a horizontal gradient. The file size
 * grows with the area, which is what a test that wants "a small image" asks for.
 */
export function pngBytes(width = 8, height = 8, colour: readonly number[] = [214, 227, 253]): Uint8Array {
  if (width < 1 || height < 1) throw new Error('a PNG has to have a side to it');
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0); // this row is not filtered
    for (let x = 0; x < width; x += 1) {
      // A gradient rather than a flat fill, so a picture that shows up in a screenshot is visibly a
      // picture and not a grey square someone forgot to finish.
      const shade = (x * 251 + y * 7) & 0xff;
      raw.push((colour[0] + shade) & 0xff, (colour[1] + shade / 2) & 0xff, (colour[2] + shade / 4) & 0xff);
    }
  }
  const header = [
    ...u32(width),
    ...u32(height),
    8, // bit depth
    2, // colour type: truecolour
    0,
    0,
    0,
  ];
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', [...storedDeflate(Uint8Array.from(raw))]),
    ...pngChunk('IEND', []),
  ]);
}

/**
 * GIF's LZW, written by an encoder that never compresses: a clear code and then one code per pixel.
 *
 * The codes are half the job. A decoder widens its read width as its string table fills, and the table
 * fills one code later for the decoder than for the encoder, because neither of them adds an entry for
 * the first code after a clear. Getting that one byte wrong is a GIF that no browser will open, which
 * is why the bookkeeping below is spelled out instead of guessed at.
 */
function lzwEncode(indices: number[], minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let held = 0;
  let width = minCodeSize + 1;
  let next = clear + 2; // the entry the next added pair would be given
  let first = true; // the first code after a clear starts a string and adds nothing

  const write = (code: number): void => {
    acc |= code << held;
    held += width;
    while (held >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      held -= 8;
    }
  };
  const reset = (): void => {
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
        // No room left in a 12-bit code, so the table starts again — which is what a clear code is for.
        write(clear);
        reset();
      } else {
        width += 1;
      }
    }
  }
  write(end);
  if (held > 0) out.push(acc & 0xff);
  return out;
}

/** An image's LZW bytes, in the sub-blocks of at most 255 bytes the format is carried in. */
function subBlocks(bytes: number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < bytes.length; index += 255) {
    const size = Math.min(255, bytes.length - index);
    out.push(size, ...bytes.slice(index, index + size));
  }
  out.push(0); // the block terminator
  return out;
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

/**
 * A real, decodable GIF89a: one frame, a two-colour global palette, and one image. The graphic control
 * extension is included because the second `0x00` in it — the block terminator — is the byte most
 * hand-written GIFs forget, and a decoder that cannot find it refuses the whole file.
 */
export function gifBytes(width = 8, height = 8): Uint8Array {
  const minCodeSize = 1; // two colours in the palette
  const pixels = width * height;
  const indices = Array.from({ length: pixels }, (_unused, index) => index % 2);
  return Uint8Array.from([
    ...encoder.encode('GIF89a'),
    ...le16(width),
    ...le16(height),
    0xf0, // a global colour table follows, 8-bit colour resolution, two entries
    0, // background index
    0, // pixel aspect ratio
    // the palette: white and a blue
    0xff,
    0xff,
    0xff,
    0x25,
    0x63,
    0xeb,
    // graphic control extension: no disposal, no transparency, no delay — and the terminator
    0x21,
    0xf9,
    0x04,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    // image descriptor: at the origin, full size, no local table
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    ...le16(width),
    ...le16(height),
    0x00,
    minCodeSize,
    ...subBlocks(lzwEncode(indices, minCodeSize)),
    0x3b, // trailer
  ]);
}

/**
 * Signature-grade JPEG of exactly `size` bytes: SOI, a JFIF APP0 segment, comment segments to fill, and
 * EOI. Enough for the twelve-byte sniff and for counting; not a picture a browser draws. (The decodable
 * one is `images/photo-4032x3024.jpg`, for the suites that can read a file.)
 */
export function jpegBytes(size = 2048): Uint8Array {
  if (size < 20) throw new Error('a JPEG this small cannot carry a marker');
  const app0 = [
    0xff,
    0xe0,
    0x00,
    0x10, // segment length 16
    ...encoder.encode('JFIF\u0000'),
    0x01,
    0x01, // version 1.1
    0x00, // no units
    0x00,
    0x01,
    0x00,
    0x01, // one by one pixel aspect
    0x00,
    0x00, // no thumbnail
  ];
  const head = [0xff, 0xd8, ...app0];
  const tail = [0xff, 0xd9];
  const out = [...head];
  let spare = size - head.length - tail.length;
  while (spare > 0) {
    // A comment segment (FF FE) is the one thing a decoder is told to read past and forget, which makes
    // it the honest way to make a JPEG bigger without making it a different picture.
    const payload = Math.min(spare - 4, 0xfffb);
    if (payload < 0) break;
    out.push(0xff, 0xfe, (payload + 2) >> 8, (payload + 2) & 0xff);
    for (let i = 0; i < payload; i += 1) out.push(0x20);
    spare -= payload + 4;
  }
  // The last few bytes do not fit a segment header, so they go after the picture and before EOI — a
  // decoder has stopped reading by then, and a sniffer never looks.
  for (let i = 0; i < spare; i += 1) out.push(0x20);
  out.push(...tail);
  return Uint8Array.from(out);
}

/**
 * Signature-grade WebP: RIFF, the file length, WEBP, and a VP8 chunk whose header carries the frame
 * size. The sniff reads all twelve of those bytes, which is the whole of what this file is asked to
 * prove (image.sniff); the pixels are someone else's problem.
 */
export function webpBytes(width = 4, height = 4): Uint8Array {
  const frame = [
    0x30,
    0x01,
    0x00, // a lossy keyframe's beginning
    width & 0x3f,
    (width >>> 6) & 0xff,
    height & 0x3f,
    (height >>> 6) & 0xff,
    0x00,
    0x00,
    0x00,
  ];
  const payload = [...encoder.encode('VP8 '), ...u32(frame.length), ...frame];
  const riff = [...encoder.encode('RIFF'), ...u32(4 + payload.length), ...encoder.encode('WEBP'), ...payload];
  return Uint8Array.from(riff);
}

/** A PDF, which is what a "PNG" that says `image/png` and starts `%PDF` is (image.types). */
export function pdfBytes(): Uint8Array {
  return encoder.encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );
}

/** An SVG: a document that can carry a script, so never an image on this board. */
export function svgBytes(): Uint8Array {
  return encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><script>alert(1)</script><rect width="40" height="30"/></svg>',
  );
}

/** Anything at all, of a given size, for the paths that must refuse before looking at the contents. */
export function junkBytes(size = 64, start = 1): Uint8Array {
  return Uint8Array.from({ length: size }, (_unused, index) => (start + index) % 251);
}

/** A PNG of the largest size the board accepts, for the two files that decide the rule (image.size_limit). */
export function pngAtLimit(): Uint8Array {
  return padPngTo(pngBytes(4, 4), IMAGE_MAX_BYTES);
}

/**
 * Make a PNG exactly `size` bytes by adding a `tEXt` chunk, which is metadata a decoder reads and
 * discards. `pngBytes` is compressed-but-stored, so its own size is not a simple function of its
 * area and a test that wants an exact byte count says so here instead.
 */
export function padPngTo(png: Uint8Array, size: number): Uint8Array {
  const iend = png.length - 12; // IEND is length + 'IEND' + CRC, and it is always the last chunk
  if (png.length < 20 || iend < 8) throw new Error('not a PNG I can lengthen');
  const room = size - png.length;
  if (room === 0) return png;
  // A chunk is 12 bytes of its own (length, type, CRC) and the keyword 'Comment' plus its NUL are 8
  // more, so anything smaller than that cannot be a `tEXt` chunk at all.
  if (room < 20) throw new Error(`no room for a ${room}-byte chunk in a PNG`);
  const text = [...encoder.encode('Comment\u0000'), ...new Uint8Array(room - 20)];
  const chunk = pngChunk('tEXt', text);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend), 0);
  out.set(Uint8Array.from(chunk), iend);
  out.set(png.subarray(iend), iend + chunk.length);
  if (out.length !== size) throw new Error(`padded to ${out.length}, wanted ${size}`);
  return out;
}

/** A `File` from any of the builders above, with the type a test wants it to claim. */
export function fileFromBytes(
  bytes: Uint8Array,
  name: string,
  type = 'application/octet-stream',
): File {
  return new File([bytes.slice().buffer as unknown as BlobPart], name, { type });
}

/** The bytes of a `File`, for comparing what was sent with what the bucket kept. */
export async function bytesOf(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
