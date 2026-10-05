/**
 * TC-01: sniffImageType on various file types.
 * TC-02: ASSET_KEY_PATTERN validation.
 */
import { describe, expect, it } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';


describe('sniffImageType (TC-01)', () => {
  it('detects PNG', () => {
    // 89 50 4E 47 0D 0A 1A 0A ...
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    // FF D8 FF E0 ...
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    // "GIF87a"
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 0, 1, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    // "GIF89a"
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // "RIFF" + 4 bytes size + "WEBP"
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    // %PDF-1.4 ...
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x20, 0x66, 0x61, 0x6b]);
    expect(sniffImageType(pdf)).toBeNull();
  });

  it('returns null for 3 random bytes (too short)', () => {
    const head = new Uint8Array([0xde, 0xad, 0xbe]);
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches a valid key (22/22)', () => {
    const key = 'abcdefghijklmnopqrstuv/12345678901234567890ab';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects a key with missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'abcdefghijklmnopqrstuvw/12345678901234567890ab';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('builds the correct key', () => {
    expect(assetKeyFor('board12345678901234567a', 'asset12345678901234567b')).toBe(
      'board12345678901234567a/asset12345678901234567b',
    );
  });
});
