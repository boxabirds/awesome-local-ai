/**
 * Unit tests for image format sniffing and asset key validation.
 * TC-01, TC-02
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('sniffImageType (TC-01)', () => {
  it('detects PNG', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const head = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x14, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const head = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(head.slice(0, 12))).toBeNull();
  });

  it('returns null for PDF renamed to .png', () => {
    const head = new TextEncoder().encode('%PDF-1.4 fake pdf content');
    expect(sniffImageType(head.slice(0, 12))).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0xAB, 0xCD, 0xEF]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches valid <22>/<22>', () => {
    const key = 'abcdefghijklmnopqrstuv/ABCDEFGHIJKLMNOPQRSTUV';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part (no slash)', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuvwx')).toBe(false);
  });

  it('rejects ../', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('builds correct key', () => {
    expect(assetKeyFor('board123', 'asset456')).toBe('board123/asset456');
  });
});
