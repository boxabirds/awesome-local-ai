/**
 * Unit tests for image format sniffing and asset key pattern (TC-01, TC-02).
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('sniffImageType (TC-01)', () => {
  it('detects PNG', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const head = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // RIFF....WEBP
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (any)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const head = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for renamed PDF', () => {
    // PDF header: %PDF-1.4
    const head = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes (too short)', () => {
    const head = new Uint8Array([0xDE, 0xAD, 0xBE]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches valid key (22/22)', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv/abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuvw/abcdefghijklmnopqrstuv')).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins boardId and assetId with /', () => {
    expect(assetKeyFor('abc', 'def')).toBe('abc/def');
  });
});
