import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';

/** Builds a sniff head of IMAGE_SNIFF_BYTES from a prefix (zero-padded). */
function head(bytes: number[]): Uint8Array {
  const out = new Uint8Array(IMAGE_SNIFF_BYTES);
  for (let i = 0; i < bytes.length && i < IMAGE_SNIFF_BYTES; i++) out[i] = bytes[i];
  return out;
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]; // "RIFF$...WEBP"
const toBytes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const SVG_HEAD = toBytes('<svg xmlns=');
const PDF_HEAD = toBytes('%PDF-1.4');

describe('TC-01: sniffImageType recognises accepted types by content only', () => {
  it('PNG magic bytes → image/png', () => {
    expect(sniffImageType(head(PNG_HEAD))).toBe('image/png');
  });

  it('JPEG magic bytes → image/jpeg', () => {
    expect(sniffImageType(head(JPEG_HEAD))).toBe('image/jpeg');
  });

  it('GIF87a → image/gif', () => {
    expect(sniffImageType(head(GIF87A))).toBe('image/gif');
  });

  it('GIF89a → image/gif', () => {
    expect(sniffImageType(head(GIF89A))).toBe('image/gif');
  });

  it('WebP RIFF....WEBP → image/webp', () => {
    expect(sniffImageType(head(WEBP_HEAD))).toBe('image/webp');
  });

  it('SVG text → null (negative: scripts must never be accepted)', () => {
    expect(sniffImageType(head(SVG_HEAD))).toBeNull();
  });

  it('PDF renamed to .png → null (content, not name, decides)', () => {
    expect(sniffImageType(head(PDF_HEAD))).toBeNull();
  });

  it('3 random bytes → null', () => {
    expect(sniffImageType(head([0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN accepts only <22 base64url>/<22 base64url>', () => {
  const id22 = 'a'.repeat(22);

  it('valid <22>/<22> key → true', () => {
    expect(ASSET_KEY_PATTERN.test(`${id22}/${id22}`)).toBe(true);
  });

  it('missing part → false', () => {
    expect(ASSET_KEY_PATTERN.test(id22)).toBe(false);
  });

  it("'../' → false", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('23-char id → false', () => {
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${id22}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22}/${'a'.repeat(23)}`)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins board id and asset id with a slash', () => {
    const board = 'b'.repeat(22);
    const asset = 'c'.repeat(22);
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
  });
});
