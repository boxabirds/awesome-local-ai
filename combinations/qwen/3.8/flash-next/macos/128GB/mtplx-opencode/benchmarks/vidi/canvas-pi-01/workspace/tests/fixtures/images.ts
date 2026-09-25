/**
 * Story 12 · the image fixtures (design "Fixtures", "Mock vs real boundaries").
 *
 * Real image bytes — a decodable PNG screenshot, a WebP, an animated GIF89a, a
 * small JPEG, an SVG carrying a `<script>`, a PDF renamed to `.png`, a truncated
 * PNG, three random bytes, and two exactly-sized JPEGs at the 10 MB limit and
 * one byte past it. Type is decided from content in this app, so the fixtures
 * are chosen to span the whole content dimension the PRD calls out (valid,
 * disguised, corrupt, oversized) rather than a single "a png" file.
 *
 * The bytes live next to this module as real files so integration tests can hand
 * them to the Worker verbatim. They are read with `fs` here (every test scope
 * that needs real bytes runs in Node: the unit and integration workers, and
 * Playwright's Node side); the pure magic-byte checks in
 * `tests/unit/image-format.test.ts` build their own buffers and never touch the
 * file system.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./images/', import.meta.url));

/** Read one fixture as raw bytes. */
export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(here + name));
}

/** Read one fixture as a base64 string (for embedding in a page under test). */
export function fixtureBase64(name: string): string {
  return Buffer.from(fixtureBytes(name)).toString('base64');
}

/** The names, so a suite can list them without hard-coding the strings. */
export const IMAGE_FIXTURES = {
  pngScreenshot: 'screenshot-1440x900.png',
  jpegPhoto: 'photo-tiny.jpg',
  gifAnimated: 'gif-animated.gif',
  webp: 'webp-image.webp',
  svgScript: 'svg-script.svg',
  pdfRenamed: 'pdf-renamed.png',
  pngCorrupt: 'png-corrupt.png',
  randomBytes: 'random-bytes.bin',
  jpegAtLimit: 'jpeg-at-limit.bin',
  jpegOverLimit: 'jpeg-over-limit.bin',
} as const;

// Ready-to-use byte views, so a test reads `PNG` rather than a name lookup.
// Read once at module load; every scope that imports this runs in Node (the unit
// project, the integration workerd pool where `node:fs` is shimmed, and
// Playwright's Node side). Component tests never import it — jsdom cannot decode
// any of these anyway.
export const PNG = fixtureBytes(IMAGE_FIXTURES.pngScreenshot);
export const JPEG = fixtureBytes(IMAGE_FIXTURES.jpegPhoto);
export const GIF = fixtureBytes(IMAGE_FIXTURES.gifAnimated);
export const WEBP = fixtureBytes(IMAGE_FIXTURES.webp);
export const SVG_SCRIPT = fixtureBytes(IMAGE_FIXTURES.svgScript);
export const PDF = fixtureBytes(IMAGE_FIXTURES.pdfRenamed);
export const CORRUPT = fixtureBytes(IMAGE_FIXTURES.pngCorrupt);
export const RANDOM = fixtureBytes(IMAGE_FIXTURES.randomBytes);
export const JPEG_AT_LIMIT = fixtureBytes(IMAGE_FIXTURES.jpegAtLimit);
export const JPEG_OVER_LIMIT = fixtureBytes(IMAGE_FIXTURES.jpegOverLimit);
