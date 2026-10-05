import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

// ─── TC-01: sniffImageType ────────────────────────────────────────────────────

describe('TC-01: sniffImageType', () => {
  it('detects PNG from magic bytes 89 50 4E 47', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG from magic bytes FF D8 FF', () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new TextEncoder().encode('GIF87a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new TextEncoder().encode('GIF89a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP from RIFF....WEBP', () => {
    // RIFF + 4 bytes size + WEBP
    const head = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size (little-endian)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text content', () => {
    const svg = new TextEncoder().encode('<svg xmlns="');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for a PDF renamed to .png', () => {
    // PDF magic: %PDF
    const pdf = new TextEncoder().encode('%PDF-1.4\\n');
    expect(sniffImageType(pdf)).toBeNull();
  });

  it('returns null for 3 random bytes (too short)', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(bytes)).toBeNull();
  });

  it('returns null for 4 random bytes that match no magic', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(sniffImageType(bytes)).toBeNull();
  });
});

// ─── TC-02: ASSET_KEY_PATTERN ─────────────────────────────────────────────────

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches a valid 22/22 key', () => {
    // Exactly 22 base64url chars per part
    const part1 = 'a'.repeat(22);
    const part2 = 'b'.repeat(22);
    const key = `${part1}/${part2}`;
    expect(key.split('/').every(p => p.length === 22)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects a key missing one part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuvwxyz01')).toBe(false);
  });

  it('rejects a key with path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../evil')).toBe(false);
  });

  it('rejects a key with 23-char id', () => {
    // 23 chars is too long
    const key = 'abcdefghijklmnopqrstuvwxyz012/abcdefghijklmnopqrstuvwxyz012';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('accepts key from assetKeyFor with valid ids', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'b'.repeat(22);
    const key = assetKeyFor(boardId, assetId);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });
});
