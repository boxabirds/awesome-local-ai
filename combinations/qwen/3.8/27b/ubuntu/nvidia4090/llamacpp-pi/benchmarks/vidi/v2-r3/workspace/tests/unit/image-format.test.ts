/**
 * Unit tests for the shared image-format helpers (story 12, TC-01, TC-02).
 *
 * TC-01: sniffImageType recognizes all four accepted formats from their
 *        magic bytes alone — the client Content-Type is never trusted — and
 *        rejects PDFs, SVGs and arbitrary binary even with image headers.
 * TC-02: ASSET_KEY_PATTERN enforces <22>/<22> with no path traversal.
 */
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

describe('sniffImageType (TC-01)', () => {
  it('recognizes a PNG from its 4-byte signature', () => {
    expect(sniffImageType(bytes('89504e470d0a1a0a0000000d'))).toBe('image/png');
    // Exactly the sniff window is enough.
    expect(sniffImageType(bytes('89504e47'))).toBe('image/png');
  });

  it('recognizes a JPEG from FF D8 FF (any marker follows)', () => {
    expect(sniffImageType(bytes('ffd8ffe000104a4649460001'))).toBe('image/jpeg');
    expect(sniffImageType(bytes('ffd8ff'))).toBe('image/jpeg');
  });

  it('recognizes GIF87a and GIF89a', () => {
    expect(sniffImageType(bytes('47494638396101000100'))).toBe('image/gif');
    expect(sniffImageType(bytes('47494638376101000100'))).toBe('image/gif');
  });

  it('recognizes WebP from RIFF…WEBP', () => {
    expect(sniffImageType(bytes('5249464624000000574542505650384c'))).toBe('image/webp');
    // Exactly the 12-byte sniff window is enough.
    expect(sniffImageType(bytes('524946462400000057454250'))).toBe('image/webp');
  });

  it('rejects a PDF renamed to .png (the header says image/png, the bytes say PDF)', () => {
    expect(sniffImageType(bytes('255044462d312e340a25e2e3cfd30a'))).toBeNull();
  });

  it('rejects an SVG (XML, even with an image Content-Type header)', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>…').subarray(0, 12))).toBeNull();
  });

  it('rejects arbitrary binary and truncated heads', () => {
    expect(sniffImageType(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    // A 3-byte head cannot be a PNG/WebP/GIF, but FF D8 FF is a full JPEG head.
    expect(sniffImageType(bytes('ffd8'))).toBeNull();
  });
});

describe('asset keys (TC-02)', () => {
  const id22 = (c: string): string => c.repeat(Math.ceil(22 / c.length)).slice(0, 22);

  it('accepts <22>/<22> keys', () => {
    expect(ASSET_KEY_PATTERN.test(`${id22('a')}/${id22('B')}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(`${id22('a_-')}/${id22('0123456789abcdef')}`)).toBe(true);
  });

  it('rejects missing parts, extra parts and wrong lengths', () => {
    expect(ASSET_KEY_PATTERN.test(id22('a'))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22('a')}/${id22('b')}/${id22('c')}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(21)}/${id22('b')}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22('a')}/${'b'.repeat(23)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../${id22('b')}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22('a')}/..`)).toBe(false);
  });

  it('assetKeyFor composes board id and asset id', () => {
    expect(assetKeyFor(id22('a'), id22('b'))).toBe(`${id22('a')}/${id22('b')}`);
  });
});
