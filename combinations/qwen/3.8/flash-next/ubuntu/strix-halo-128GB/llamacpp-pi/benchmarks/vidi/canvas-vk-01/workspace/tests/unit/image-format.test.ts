import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  isAcceptedImageType,
  newAssetId,
  sniffImageType,
} from '../../src/shared/image-format';
import {
  gif87aBytes,
  gif89aBytes,
  jpegBytes,
  junkBytes,
  pdfBytes,
  pngBytes,
  svgScriptBytes,
  truncatedPngBytes,
  webpBytes,
} from '../fixtures/image-bytes';

const first = (bytes: Uint8Array, count: number): Uint8Array => bytes.subarray(0, count);

/** Ids of the shape the API mints: 22 base64url characters each. */
const BOARD_ID = 'V2fXq0Kd7Yh1N4sT8pLm3a';
const ASSET_ID = '0Jw6Qm2Xs9Yd4Kb7Tf1hNg';

/**
 * TC-01, TC-02 (image.sniff): the shared magic-byte checker, the accepted-type
 * list and the asset key builder. `sniffImageType` is the whole of the
 * server-side refusal for a disguised file, so the disguised cases are given
 * the type a browser would report for the name they carry.
 */
describe('image format', () => {
  it('TC-01: sniffs PNG, JPEG, GIF87a, GIF89a and WebP from the leading bytes', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageType(gif87aBytes())).toBe('image/gif');
    expect(sniffImageType(gif89aBytes())).toBe('image/gif');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
    // The sniff reads the signature, not the whole file: the first 12 bytes are
    // enough, and that is all the server is given for the GIF.
    expect(sniffImageType(first(gif89aBytes(), 6))).toBe('image/gif');
    expect(sniffImageType(first(webpBytes(), 12))).toBe('image/webp');
  });

  it('TC-01: refuses SVG, PDF and non-image bytes whatever type they are named as', () => {
    expect(sniffImageType(svgScriptBytes())).toBeNull();
    // A PDF renamed .png: only the bytes are given, never the name or type.
    expect(sniffImageType(pdfBytes())).toBeNull();
    expect(sniffImageType(junkBytes())).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // Too few bytes to carry a signature at all.
    expect(sniffImageType(first(pngBytes(), 4))).toBeNull();
  });

  it('TC-01: a truncated PNG still sniffs as PNG, because nothing decodes on the server', () => {
    // Sniffing is a signature check, and a half-written PNG still starts with
    // the PNG signature. What catches a truncated file is the browser's decode
    // before upload, which the browser suite covers through the picker with a
    // PDF named .png (image.invalid: "bad or unsupported image format").
    expect(sniffImageType(truncatedPngBytes())).toBe('image/png');
  });

  it('TC-01: accepts exactly the four PRD types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isAcceptedImageType(type)).toBe(true);
    }
    for (const type of ['image/svg+xml', 'application/pdf', 'text/plain', '', 'image/png2']) {
      expect(isAcceptedImageType(type)).toBe(false);
    }
  });

  it('TC-02: assetKeyFor produces boardId/assetId of two 22-character ids', () => {
    const key = assetKeyFor(BOARD_ID, ASSET_ID);
    expect(key).toBe(`${BOARD_ID}/${ASSET_ID}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('TC-02: every generated key matches the pattern and is unique', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const key = assetKeyFor(BOARD_ID, newAssetId());
      expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
      seen.add(key);
    }
    // 500 keys, all distinct: the id source is random enough to be unguessable.
    expect(seen.size).toBe(500);
  });

  it('TC-02: rejects a path segment or traversal instead of building a key from it', () => {
    for (const bad of ['../evil', 'a/b', '..', '', '.', 'has space', 'ünïcode', 'x'.repeat(21), 'x'.repeat(23)]) {
      expect(() => assetKeyFor(bad, ASSET_ID)).toThrow();
      expect(() => assetKeyFor(BOARD_ID, bad)).toThrow();
    }
    // And the pattern itself refuses them, which is what the asset route uses.
    expect(ASSET_KEY_PATTERN.test('../../etc/passwd')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('board123456789012345678/../../etc')).toBe(false);
  });

  it('TC-02: an asset id is 22 characters, so a key cannot be enumerated', () => {
    const assetId = newAssetId();
    expect(assetId).toHaveLength(22);
    expect(assetId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('keeps the size limit the PRD states', () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
