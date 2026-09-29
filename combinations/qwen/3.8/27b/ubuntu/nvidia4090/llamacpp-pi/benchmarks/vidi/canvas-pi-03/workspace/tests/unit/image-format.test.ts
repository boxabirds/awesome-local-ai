import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@/shared/image-format';

/**
 * Story 12 — assets.api unit tests (TC-01, TC-02): the pure magic-byte type
 * sniffing and the asset key pattern.
 */

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}
function text(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

describe('sniffImageType (TC-01)', () => {
  it('recognises PNG from its 8-byte signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    // The first 4 bytes are enough.
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
  });

  it('recognises JPEG from FF D8 FF', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
  });

  it('recognises GIF87a and GIF89a', () => {
    expect(sniffImageType(text('GIF87a'))).toBe('image/gif');
    expect(sniffImageType(text('GIF89a'))).toBe('image/gif');
  });

  it('recognises WebP (RIFF....WEBP)', () => {
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp',
    );
  });

  it('rejects SVG text (even with a .png name) with null', () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>'))).toBeNull();
  });

  it('rejects a renamed PDF with null', () => {
    expect(sniffImageType(text('%PDF-1.4\n1 0 obj'))).toBeNull();
  });

  it('rejects 3 random bytes with null', () => {
    expect(sniffImageType(bytes(0x01, 0x02, 0x03))).toBeNull();
    // Also an empty head is safe.
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN / assetKeyFor (TC-02)', () => {
  const id = (c: string, n: number) => c.repeat(n);

  it('accepts a valid <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(`${id('a', 22)}/${id('b', 22)}`)).toBe(true);
    // base64url characters
    expect(ASSET_KEY_PATTERN.test(`${id('-', 22)}/${id('_', 22)}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test('A0bC1d2E3f4G5h6I7j8K9l/' + id('z', 22))).toBe(true);
  });

  it('rejects a key missing one part', () => {
    expect(ASSET_KEY_PATTERN.test(id('a', 22))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a', 22)}/`)).toBe(false);
  });

  it('rejects path traversal (../)', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a', 22)}/../${id('b', 22)}`)).toBe(false);
  });

  it('rejects a 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test(`${id('a', 23)}/${id('b', 22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a', 22)}/${id('b', 23)}`)).toBe(false);
  });

  it('assetKeyFor joins boardId and assetId with a slash', () => {
    expect(assetKeyFor(id('a', 22), id('b', 22))).toBe(`${id('a', 22)}/${id('b', 22)}`);
  });
});
