// assets.api pure logic (spec: assets.api, TC-01, TC-02).
//
// sniffImageType decides from content bytes only (image.types); the asset
// key pattern guards the serve route (unguessable keys, no traversal).

import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import {
  ANIMATED_GIF,
  CORRUPT_PNG,
  RENAMED_PDF,
  SAMPLE_WEBP,
  SCREENSHOT_PNG,
  SCRIPT_SVG,
  TINY_JPEG,
  pdfBytes,
} from '../fixtures/images';

describe('sniffImageType (TC-01)', () => {
  it('accepts PNG from its magic bytes', () => {
    expect(sniffImageType(SCREENSHOT_PNG.bytes)).toBe('image/png');
  });

  it('accepts JPEG from its magic bytes', () => {
    expect(sniffImageType(TINY_JPEG.bytes)).toBe('image/jpeg');
  });

  it('accepts GIF87a and GIF89a', () => {
    expect(sniffImageType(ANIMATED_GIF.bytes)).toBe('image/gif');
    const gif89a = new Uint8Array(ANIMATED_GIF.bytes);
    gif89a[4] = 0x39; // '7' -> '9'
    expect(sniffImageType(gif89a)).toBe('image/gif');
  });

  it('accepts WebP (RIFF....WEBP)', () => {
    expect(sniffImageType(SAMPLE_WEBP.bytes)).toBe('image/webp');
  });

  it('rejects SVG text (security: no scripts on the board)', () => {
    expect(sniffImageType(SCRIPT_SVG.bytes)).toBeNull();
  });

  it('rejects a PDF renamed .png (content decides, not the name)', () => {
    expect(sniffImageType(RENAMED_PDF.bytes)).toBeNull();
    expect(sniffImageType(pdfBytes(128))).toBeNull();
  });

  it('rejects random bytes and a truncated image head', () => {
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
    // Truncated to 3 bytes: even a PNG head cannot be recognised.
    expect(sniffImageType(SCREENSHOT_PNG.bytes.subarray(0, 3))).toBeNull();
    // A truncated PNG (full header, cut body) still sniffs as PNG: the
    // header is intact; decoding (not sniffing) is what fails.
    expect(sniffImageType(CORRUPT_PNG.bytes)).toBe('image/png');
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('accepts a well-formed <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/${'b'.repeat(22)}`)).toBe(true);
    const board = 'AbCdEfGhIjKlMnOpQrStUv';
    const asset = '-0123456789zyxwvutsrq' + 'a';
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
  });

  it('rejects a missing part', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/`)).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/../../etc`)).toBe(false);
  });

  it('rejects a 23-char id (too long) and a 21-char id (too short)', () => {
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(21)}/${'b'.repeat(22)}`)).toBe(false);
  });
});
