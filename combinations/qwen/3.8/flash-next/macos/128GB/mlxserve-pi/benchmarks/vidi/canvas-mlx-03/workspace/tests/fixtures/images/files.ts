// The story 12 fixtures as things the tests actually want: bytes, Blobs and Files.
//
// The bytes themselves are in ./index.ts, produced by a real encoder (see
// tools/make-image-fixtures.mjs). This module is hand-written on purpose: it is where the
// awkward cases are built — a PNG cut off mid-file, a JPEG of an exact byte count — because
// those are the ones a client is supposed to catch and a file on disk would only document.

import {
  GIF_ANIMATED_B64,
  JPEG_24_B64,
  JPEG_4032x3024_B64,
  PDF_B64,
  PNG_1440x900_B64,
  PNG_24_B64,
  SVG_WITH_SCRIPT,
  WEBP_640x480_B64,
} from './index.ts';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config.ts';

/** base64 → bytes, with the globals every runtime here has (node, workerd, jsdom, browser). */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/** The fixture bytes under a short name, so a test says what it means. */
export function imageBytes(name: string): Uint8Array {
  switch (name) {
    case 'png-1440x900':
      return decodeBase64(PNG_1440x900_B64);
    case 'png-24':
      return decodeBase64(PNG_24_B64);
    case 'jpeg-4032x3024':
      return decodeBase64(JPEG_4032x3024_B64);
    case 'jpeg-24':
      return decodeBase64(JPEG_24_B64);
    case 'webp-640x480':
      return decodeBase64(WEBP_640x480_B64);
    case 'gif-animated':
      return decodeBase64(GIF_ANIMATED_B64);
    case 'pdf':
      return decodeBase64(PDF_B64);
    case 'png-truncated':
      // The real screenshot, cut off after its signature and the start of its IHDR: a file
      // that claims to be a PNG and is not one.
      return decodeBase64(PNG_1440x900_B64).slice(0, 24);
    case 'svg':
      return new TextEncoder().encode(SVG_WITH_SCRIPT);
    case 'jpeg-at-limit':
      return jpegOfExactSize(IMAGE_MAX_BYTES);
    case 'jpeg-over-limit':
      return jpegOfExactSize(IMAGE_MAX_BYTES + 1);
    default:
      throw new Error(`unknown image fixture: ${name}`);
  }
}

/** A File as a browser would hand it to a drop or a picker. */
export function imageFile(name: string, fileName = name, type = ''): File {
  const bytes = imageBytes(name);
  return new File([bytes.slice().buffer as ArrayBuffer], fileName, type ? { type } : undefined);
}

export function imageBlob(name: string, type: string): Blob {
  const bytes = imageBytes(name);
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

/**
 * A real JPEG of exactly `bytes` total, built by inserting JPEG comment segments (0xFFFE,
 * which every decoder skips) after the start-of-image marker.
 *
 * The size limit is tested against a file that *is* an image and *is* exactly at the limit,
 * because "over 10 MB" is a byte comparison and a fake file of the right length would prove
 * nothing about the order the checks run in.
 */
export function jpegOfExactSize(bytes: number): Uint8Array {
  const jpeg = imageBytes('jpeg-24');
  const head = jpeg.subarray(0, 2); // 0xFFD8, start of image
  const rest = jpeg.subarray(2);
  const SEGMENT = 2 + 65533; // marker + length field + the largest legal payload
  const needed = bytes - jpeg.length;
  if (needed < 0) throw new Error(`a real JPEG is already ${jpeg.length} bytes`);
  const parts: Uint8Array[] = [head];
  let left = needed;
  while (left > 0) {
    const payload = Math.min(SEGMENT - 2, left - 2 > 0 ? left - 2 : 0);
    const segment = new Uint8Array(2 + payload);
    segment[0] = 0xff;
    segment[1] = 0xfe; // comment
    segment[2] = (payload + 2) >> 8;
    segment[3] = (payload + 2) & 0xff;
    for (let i = 4; i < segment.length; i++) segment[i] = 0x20; // padding text
    parts.push(segment);
    left -= segment.length;
  }
  parts.push(rest);
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  if (at !== bytes) throw new Error(`built ${at} bytes, wanted ${bytes}`);
  return out;
}

export function jpegFileAtLimit(bytes: number, fileName = 'photo.jpg'): File {
  const data = jpegOfExactSize(bytes);
  return new File([data.slice().buffer as ArrayBuffer], fileName, { type: 'image/jpeg' });
}

/**
 * A real JPEG of exactly `bytes` bytes, as a File: the size limit tested against a file that
 * is an image and is exactly at, or one over, the line.
 */
export function oversizedImageFile(bytes: number, fileName = 'photo.jpg'): File {
  return jpegFileAtLimit(bytes, fileName);
}
