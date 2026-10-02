// tests/unit/image-format.test.ts
// TC-01: sniffImageType
// TC-02: ASSET_KEY_PATTERN

import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('TC-01: sniffImageType', () => {
  it('detects PNG from magic bytes', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a from magic bytes', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a from magic bytes', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text content', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">');
    const head = new Uint8Array(svg.buffer, svg.byteOffset, Math.min(12, svg.byteLength));
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for PDF renamed to .png', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const head = new Uint8Array(pdf.buffer, pdf.byteOffset, Math.min(12, pdf.byteLength));
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22> key', () => {
    const key = 'a1b2c3d4e5f6g7h8i9j0k1/a1b2c3d4e5f6g7h8i9j0k1';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('a1b2c3d4e5f6g7h8i9j0k1')).toBe(false);
  });

  it("rejects '../' in key", () => {
    expect(ASSET_KEY_PATTERN.test('a1b2c3d4e5f6g7h8i9j0k1/../evil')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a1b2c3d4e5f6g7h8i9j0k1l/a1b2c3d4e5f6g7h8i9j0k1';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('builds a key from board and asset ids', () => {
    expect(assetKeyFor('board123', 'asset456')).toBe('board123/asset456');
  });
});
