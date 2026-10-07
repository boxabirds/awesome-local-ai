/**
 * Story 12 — Unit tests for image format sniffing and asset key helpers (TC-01, TC-02).
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@/shared/image-format';

describe('sniffImageType (TC-01)', () => {
  it('returns "image/png" for a PNG magic header', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageType(pngHeader)).toBe('image/png');
  });

  it('returns "image/jpeg" for a JPEG magic header', () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageType(jpegHeader)).toBe('image/jpeg');
  });

  it('returns "image/gif" for GIF87a', () => {
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    expect(sniffImageType(gif87a)).toBe('image/gif');
  });

  it('returns "image/gif" for GIF89a', () => {
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffImageType(gif89a)).toBe('image/gif');
  });

  it('returns "image/webp" for a WebP magic header', () => {
    // RIFF....WEBP pattern at offset 0-3 and 8-11
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // size placeholder
      0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);
    expect(sniffImageType(webpHeader)).toBe('image/webp');
  });

  it('returns null for SVG text content', () => {
    const svgHeader = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svgHeader)).toBeNull();
  });

  it('returns null for a PDF renamed to .png', () => {
    // PDF starts with "%PDF-"
    const pdfHeader = new TextEncoder().encode('%PDF-1.4 %????\n1 0 obj\n');
    expect(sniffImageType(pdfHeader)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const random = new Uint8Array([0xde, 0xad, 0xbe]);
    expect(sniffImageType(random)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches valid boardId/assetId pairs (22 chars each)', () => {
    // Exactly 22 base64url characters per part
    const valid1 = 'ABCDEFGHIJKLmnopqrstuV/ABCDEFGHIJKLmnopqrstuW';
    const valid2 = 'abcdefghijklmnOpqrstuv/ABCDEFGHIJKLmnopqrstUv';
    expect(ASSET_KEY_PATTERN.test(valid1)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(valid2)).toBe(true);
  });

  it('rejects keys with missing parts', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefg')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abcdefg/')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('/hijklmnopqrstuvwxyzab')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  it('rejects keys with directory traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abc/../def')).toBe(false);
  });

  it('rejects keys with IDs of wrong length (23 chars)', () => {
    const tooLong = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcde/ABCDEFGHIJKLMNOPQRSTUVwxy';
    expect(ASSET_KEY_PATTERN.test(tooLong)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins boardId and assetId with "/" separator', () => {
    expect(assetKeyFor('board123', 'asset456')).toBe('board123/asset456');
  });
});
