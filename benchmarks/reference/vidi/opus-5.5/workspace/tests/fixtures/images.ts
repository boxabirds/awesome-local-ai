/**
 * Story 12 image fixtures (files in tests/fixtures/images/) and generators for the size-limit
 * boundary, read from Node (unit tests, Playwright). Integration tests run in workerd without
 * a file system and use the embedded copies in image-bytes.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

export const IMAGE_FIXTURE_DIR = fileURLToPath(new URL('./images/', import.meta.url));

/** Real files: name → natural size where it is an image. */
export const IMAGE_FIXTURES = {
  screenshot: { file: 'screenshot.png', type: 'image/png', width: 1440, height: 900 },
  photo: { file: 'photo.jpg', type: 'image/jpeg', width: 4032, height: 3024 },
  animated: { file: 'animated.gif', type: 'image/gif', width: 120, height: 80 },
  webp: { file: 'sample.webp', type: 'image/webp', width: 320, height: 240 },
  shotA: { file: 'shot-a.png', type: 'image/png', width: 640, height: 400 },
  shotB: { file: 'shot-b.png', type: 'image/png', width: 480, height: 360 },
  shotC: { file: 'shot-c.png', type: 'image/png', width: 400, height: 300 },
  /** An SVG with a script tag (never accepted). */
  svg: { file: 'script.svg', type: 'image/svg+xml', width: 0, height: 0 },
  /** A PDF named .png: a browser reports it as image/png. */
  renamedPdf: { file: 'document-renamed.png', type: 'image/png', width: 0, height: 0 },
  /** The first 200 bytes of a PNG: right signature, cannot be decoded. */
  truncated: { file: 'truncated.png', type: 'image/png', width: 0, height: 0 },
} as const;

export type ImageFixture = keyof typeof IMAGE_FIXTURES;

export function fixturePath(name: ImageFixture): string {
  return `${IMAGE_FIXTURE_DIR}${IMAGE_FIXTURES[name].file}`;
}

export function fixtureBytes(name: ImageFixture): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)));
}

const JPEG_START = [0xff, 0xd8, 0xff, 0xe0] as const;

/** `size` bytes that start like a JPEG (the server judges type by the first bytes only). */
export function jpegOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_START);
  return bytes;
}

/** Exactly IMAGE_MAX_BYTES: accepted (boundary). */
export function jpegAtLimit(): Uint8Array {
  return jpegOfSize(IMAGE_MAX_BYTES);
}

/** IMAGE_MAX_BYTES + 1: refused (boundary). */
export function jpegOverLimit(): Uint8Array {
  return jpegOfSize(IMAGE_MAX_BYTES + 1);
}
