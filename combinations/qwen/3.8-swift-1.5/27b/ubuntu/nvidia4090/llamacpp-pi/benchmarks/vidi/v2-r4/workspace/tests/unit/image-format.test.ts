/**
 * Unit tests — image format sniffing and asset keys (story 12, TC-01, TC-02).
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF87A_HEAD = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]); // "GIF87a"
const GIF89A_HEAD = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]); // "GIF89a"
const WEBP_HEAD = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]); // "RIFF$..WEBP"
const SVG_HEAD = new TextEncoder().encode('<?xml version="1.0"><svg');
const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n%%EOF');
const RANDOM_HEAD = Uint8Array.from([0x13, 0x37, 0x9f]);

describe('sniffImageType (TC-01)', () => {
  it('recognises PNG, JPEG, GIF87a, GIF89a and WebP magic bytes', () => {
    expect(sniffImageType(PNG_HEAD)).toBe('image/png');
    expect(sniffImageType(JPEG_HEAD)).toBe('image/jpeg');
    expect(sniffImageType(GIF87A_HEAD)).toBe('image/gif');
    expect(sniffImageType(GIF89A_HEAD)).toBe('image/gif');
    expect(sniffImageType(WEBP_HEAD)).toBe('image/webp');
  });

  it('returns null for SVG text, a renamed PDF and random bytes (negative)', () => {
    expect(sniffImageType(SVG_HEAD)).toBeNull();
    expect(sniffImageType(PDF_HEAD)).toBeNull();
    expect(sniffImageType(RANDOM_HEAD)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN and assetKeyFor (TC-02)', () => {
  // 22-char base64url ids (story 5)
  const id22 = 'a1b2c3d4e5f6g7h8i9j0k1';
  it('accepts a valid <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(`${id22}/${id22}`)).toBe(true);
  });

  it('rejects a missing part', () => {
    expect(ASSET_KEY_PATTERN.test(id22)).toBe(false);
  });

  it('rejects "../" path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../secret')).toBe(false);
  });

  it('rejects a 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test(`${id22}x/${id22}`)).toBe(false);
  });

  it('assetKeyFor joins board and asset ids', () => {
    expect(assetKeyFor('boardboardboard123', 'assetassetasset123')).toBe('boardboardboard123/assetassetasset123');
  });
});
