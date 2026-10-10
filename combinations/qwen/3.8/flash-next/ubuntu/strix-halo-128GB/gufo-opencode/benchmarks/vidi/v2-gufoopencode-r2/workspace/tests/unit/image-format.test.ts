// TC-01, TC-02: magic-byte sniffing and asset key shape.

import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const GIF87 = new Uint8Array([...new TextEncoder().encode('GIF87a'), 1, 0, 1, 0, 0]);
const GIF89 = new Uint8Array([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0]);
const WEBP = new Uint8Array([
  ...new TextEncoder().encode('RIFF'),
  10,
  0,
  0,
  0,
  ...new TextEncoder().encode('WEBP'),
  ...new TextEncoder().encode('VP8 '),
]);
const SVG_TEXT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const PDF_RENAMED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3, 4]);
const RANDOM_3 = new Uint8Array([0x01, 0x9f, 0x7e]);

describe('image format sniffing (TC-01)', () => {
  it('accepts only PNG, JPEG, GIF87a, GIF89a and WebP magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF87)).toBe('image/gif');
    expect(sniffImageType(GIF89)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects SVG text, a renamed PDF and random bytes', () => {
    expect(sniffImageType(SVG_TEXT)).toBeNull();
    expect(sniffImageType(PDF_RENAMED)).toBeNull();
    expect(sniffImageType(RANDOM_3)).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('judges by content at the start of the buffer, not by later bytes', () => {
    const pdfBytes = new Uint8Array(PDF_RENAMED.length + PNG.length);
    pdfBytes.set(PNG, 1); // PNG magic shifted by one byte is not a PNG
    pdfBytes.set(PDF_RENAMED, 0);
    expect(sniffImageType(pdfBytes)).toBeNull();
  });
});

describe('asset keys (TC-02)', () => {
  it('accepts <22-char base64url>/<22-char base64url>', () => {
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/${'b'.repeat(22)}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor('a'.repeat(22), 'b'.repeat(22)))).toBe(true);
  });

  it('rejects a missing part, traversal and wrong-length ids', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22))).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
  });
});
