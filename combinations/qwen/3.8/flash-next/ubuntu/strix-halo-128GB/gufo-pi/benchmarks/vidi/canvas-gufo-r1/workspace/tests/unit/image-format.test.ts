/**
 * Story 12: Image format sniffing and asset key pattern.
 * TC-01, TC-02
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

// ─── TC-01: sniffImageType ──────────────────────────────────────────────────

describe('TC-01: sniffImageType', () => {
  it('detects PNG from magic bytes', () => {
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    expect(sniffImageType(png)).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    // JPEG magic: FF D8 FF E0
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0x01]);
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
  });

  it('detects GIF87a from magic bytes', () => {
    // GIF87a: 47 49 46 38 37 61
    const gif87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0, 0x01, 0, 0, 0]);
    expect(sniffImageType(gif87)).toBe('image/gif');
  });

  it('detects GIF89a from magic bytes', () => {
    // GIF89a: 47 49 46 38 39 61
    const gif89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0, 0x01, 0, 0, 0]);
    expect(sniffImageType(gif89)).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    // RIFF....WEBP
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('returns null for SVG text (starts with <)', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    // PDF magic: %PDF (25 50 44 46)
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0, 0, 0]);
    expect(sniffImageType(pdf)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const random = new Uint8Array([0xab, 0xcd, 0xef]);
    expect(sniffImageType(random)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

// ─── TC-02: ASSET_KEY_PATTERN ───────────────────────────────────────────────

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('accepts valid <22>/<22> key', () => {
    const key = 'abcdefghij_kl-mnopqrst/abcdefghij_kl-mnopqrst';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part (no slash)', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghij_kl-mnopqrst')).toBe(false);
  });

  it('rejects path traversal "../"', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('rejects empty part', () => {
    expect(ASSET_KEY_PATTERN.test('/abcdefghij_kl-mnopqrstuv')).toBe(false);
  });

  it('assetKeyFor produces a valid key', () => {
    const boardId = 'abcdefghij_kl-mnopqrst';
    const assetId = 'uvwxyz0123456789_ABCDE';
    const key = assetKeyFor(boardId, assetId);
    expect(key).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });
});
