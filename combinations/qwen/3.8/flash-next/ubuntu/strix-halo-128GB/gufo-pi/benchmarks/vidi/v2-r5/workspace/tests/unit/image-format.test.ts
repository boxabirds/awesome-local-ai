/**
 * Unit tests for image-format: sniffImageType and ASSET_KEY_PATTERN (TC-01, TC-02).
 */

import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    // PNG magic: 89 50 4E 47
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    // JPEG magic: FF D8 FF
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    // "GIF87a"
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    // "GIF89a"
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // "RIFF" at 0-3, "WEBP" at 8-11
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // file size (don't care)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    // PDF magic: %PDF
    const head = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x0a, 0x0a, 0x0a]);
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches a valid key (22/22)', () => {
    const boardId = 'abcdefghijklmnopqrstuv';  // 22 chars
    const assetId = 'wxyzABCDEFGHIJKLMN0123';  // 22 chars
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${assetId}`)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv')).toBe(false);
  });

  it("rejects '../'", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const long = 'a'.repeat(23);
    const short = 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(`${long}/${short}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${short}/${long}`)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins with slash', () => {
    expect(assetKeyFor('aaa', 'bbb')).toBe('aaa/bbb');
  });
});
