// Byte fixtures for the image format tests: the signatures the four accepted formats
// really start with, and the bodies that must not pass for what they are not.
//
// These are not whole files - `sniffImageType` only ever reads the front of one, and the
// tests that need a file the browser can decode draw it in the browser instead (see
// `tests/e2e/helpers/images.ts`). Filler after a signature is the bytes that follow it in
// a real file of that shape; no signature reaches past the 12 bytes the sniffer is given.

import type { AcceptedImageType } from '../../src/shared/image-format';

function bytes(values: readonly number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values);
}

function text(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

/** `0x89 'PNG' CR LF 0x1a LF`, then the IHDR chunk that follows it in a real PNG. */
export function pngBytes(): Uint8Array<ArrayBuffer> {
  return bytes([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);
}

/** `FF D8 FF`, the Start Of Image marker every JPEG begins with. */
export function jpegBytes(): Uint8Array<ArrayBuffer> {
  return bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

/** `GIF87a`, the older of the two GIF magic strings. */
export function gif87aBytes(): Uint8Array<ArrayBuffer> {
  return bytes([...text('GIF87a'), 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);
}

/** `GIF89a`, the newer one. Both are GIF - the format is the same to a board. */
export function gif89aBytes(): Uint8Array<ArrayBuffer> {
  return bytes([...text('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0xf7, 0x00]);
}

/** `RIFF`, the file size, then `WEBP`: the only format whose signature is not at byte 0. */
export function webpBytes(): Uint8Array<ArrayBuffer> {
  return bytes([...text('RIFF'), 0x24, 0x00, 0x00, 0x00, ...text('WEBP'), ...text('VP8 ')]);
}

/** An SVG: text, and refused even though every browser displays it. */
export function svgBytes(): Uint8Array<ArrayBuffer> {
  return text('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
}

/** A PDF: what a "photo.png" that came out of a print dialog really is. */
export function pdfBytes(): Uint8Array<ArrayBuffer> {
  return text('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
}

/** Three bytes that are nothing at all - too short to hold any signature. */
export function shortBytes(): Uint8Array<ArrayBuffer> {
  return bytes([0x00, 0x01, 0x02]);
}

/** A byte string the tests use to make a body of an exact size with. */
export function fillerBytes(count: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(count);
}

/** The four accepted signatures, in the order the settings list them. */
export function acceptedFixtures(): { type: AcceptedImageType; bytes: Uint8Array<ArrayBuffer> }[] {
  return [
    { type: 'image/png', bytes: pngBytes() },
    { type: 'image/jpeg', bytes: jpegBytes() },
    { type: 'image/gif', bytes: gif89aBytes() },
    { type: 'image/webp', bytes: webpBytes() },
  ];
}
