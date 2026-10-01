import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

// TC-01: sniffImageType
describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(png)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(gif)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(gif)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // RIFF....WEBP
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x0a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    // "<svg xmlns="
    const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22]);
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    // "%PDF-1.4"
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
    expect(sniffImageType(pdf)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const random = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(random)).toBeNull();
  });
});

// TC-02: ASSET_KEY_PATTERN
describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22>', () => {
    const key = 'abcDEF1234567890123456/xyzGHI1234567890123456';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcDEF1234567890123456')).toBe(false);
  });

  it("rejects '../'", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    // 23 chars in first part
    expect(ASSET_KEY_PATTERN.test('abcDEF12345678901234567/xyzGHI1234567890123456')).toBe(false);
  });
});

// assetKeyFor
describe('assetKeyFor', () => {
  it('builds a key from boardId and assetId', () => {
    expect(assetKeyFor('boardId1234567890123', 'assetId1234567890123')).toBe(
      'boardId1234567890123/assetId1234567890123',
    );
  });
});
