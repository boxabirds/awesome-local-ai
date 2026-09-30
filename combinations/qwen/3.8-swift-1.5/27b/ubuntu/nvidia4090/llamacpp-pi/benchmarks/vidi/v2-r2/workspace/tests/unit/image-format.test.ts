import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const head = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new TextEncoder().encode('GIF87a\\x01\\x00\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new TextEncoder().encode('GIF89a\\x01\\x00\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // RIFF....WEBP
    const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const head = new TextEncoder().encode('<svg xmlns');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    const head = new TextEncoder().encode('%PDF-1.4\\n');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22>', () => {
    const key = 'a'.repeat(22) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22))).toBe(false);
  });

  it('rejects ../', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('assetKeyFor constructs the key', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'b'.repeat(22);
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });
});
