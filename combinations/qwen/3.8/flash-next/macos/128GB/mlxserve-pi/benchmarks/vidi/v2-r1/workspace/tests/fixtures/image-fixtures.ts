// Byte fixtures for the image tests.
//
// These build the *leading bytes* the tests reason about — a PNG signature, a JPEG
// one, a GIF, a WebP RIFF header, an SVG, a PDF — padded out to whatever length a
// case asks for (the size boundary, in particular). They are not decodable images:
// nothing under `tests/unit` or `tests/integration` ever decodes a file, only sniffs
// its first bytes or measures its length. The real, decodable images the e2e suite
// drops and displays live next to this file in `tests/fixtures/images/` and are read
// from disk by the e2e test itself.
//
// Keeping the builders here rather than inline means the same PNG signature is used
// by the sniffing test, the size-boundary test and the "renamed" test, so they cannot
// quietly disagree about what a PNG starts with.
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

const encoder = new TextEncoder();

/** A real PNG signature followed by `filler` bytes, totalled to `total` bytes. */
export function pngBytes(total: number): Uint8Array {
  return signed('png', total);
}

/** A JPEG (`FFD8FF` …) of exactly `total` bytes. */
export function jpegBytes(total: number): Uint8Array {
  return signed('jpeg', total);
}

/** A GIF (`GIF89a` …, or `GIF87a`) of exactly `total` bytes. */
export function gifBytes(total = 32, version: '87a' | '89a' = '89a'): Uint8Array {
  const bytes = new Uint8Array(Math.max(6, total));
  bytes.set(version === '87a' ? [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] : [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return bytes;
}

/** A WebP (`RIFF` … `WEBP`) of exactly `total` bytes. */
export function webpBytes(total = 32): Uint8Array {
  const bytes = new Uint8Array(Math.max(12, total));
  bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return bytes;
}

/** An SVG document carrying a `<script>` — the type the board refuses outright. */
export function svgBytes(): Uint8Array {
  return encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>document.body.innerHTML="pwned"</script></svg>',
  );
}

/** A PDF's leading bytes — what a "renamed PNG" or disguised upload really is. */
export function pdfBytes(total = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(8, total));
  bytes.set(encoder.encode('%PDF-1.4'));
  return bytes;
}

/** Bytes that are none of the above: three random-looking bytes. */
export function randomBytes(): Uint8Array {
  return Uint8Array.from([0x01, 0x23, 0x45]);
}

/** Exactly the size limit, with a PNG signature — accepted. */
export const exactlyAtLimitPng = (): Uint8Array => pngBytes(IMAGE_MAX_BYTES);

/** One byte over the size limit, with a PNG signature — refused. */
export const oneOverLimitPng = (): Uint8Array => pngBytes(IMAGE_MAX_BYTES + 1);

/** Exactly the size limit, with a JPEG signature — accepted at the boundary. */
export const exactlyAtLimitJpeg = (): Uint8Array => jpegBytes(IMAGE_MAX_BYTES);

type Signature = 'png' | 'jpeg';

function signed(kind: Signature, total: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(0, total));
  if (kind === 'png') bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

/**
 * A `File` of a given name, MIME type and bytes — for the client validation and hook
 * tests, which reason about `File.type` and `File.size` rather than decoded pixels.
 */
export function fileFrom(name: string, type: string, bytes: Uint8Array): File {
  // Copy into a fresh `ArrayBuffer` so the `BlobPart` is unambiguous (a `Uint8Array`
  // over a possible `SharedArrayBuffer` is not a `BlobPart` in the strict DOM lib).
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type });
}
