// TC-01: sniffImageType
// TC-02: ASSET_KEY_PATTERN

import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('TC-01: sniffImageType', () => {
  it('detects PNG from magic bytes', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a from magic bytes', () => {
    const head = new TextEncoder().encode('GIF87a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a from magic bytes', () => {
    const head = new TextEncoder().encode('GIF89a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    // RIFF....WEBP
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG content', () => {
    const head = new TextEncoder().encode('<svg xmlns=');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for a renamed PDF', () => {
    // PDF starts with %PDF
    const head = new TextEncoder().encode('%PDF-1.4\\n');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches a valid key <22>/<22>', () => {
    const key = 'a'.repeat(22) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects a key missing the second part', () => {
    const key = 'a'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('rejects a key with ../', () => {
    const key = '..' + '/x'.repeat(10) + '/' + 'a'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('rejects a 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('assetKeyFor builds the correct key', () => {
    const boardId = 'x'.repeat(22);
    const assetId = 'y'.repeat(22);
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });
});
