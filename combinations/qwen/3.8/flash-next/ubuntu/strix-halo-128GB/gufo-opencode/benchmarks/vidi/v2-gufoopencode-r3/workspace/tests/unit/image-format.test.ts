import { describe, expect, test } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType
} from '../../src/shared/image-format';

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) bytes.push(...part);
  return new Uint8Array(bytes);
}

// TC-01: the accepted type is decided from magic bytes only.
describe('sniffImageType (TC-01)', () => {
  test('PNG signature → image/png', () => {
    expect(sniffImageType(concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0x0d]))).toBe(
      'image/png'
    );
  });

  test('JPEG SOI+APP marker → image/jpeg', () => {
    expect(sniffImageType(concat([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], ascii('JFIF')))).toBe(
      'image/jpeg'
    );
  });

  test('GIF87a and GIF89a → image/gif', () => {
    expect(sniffImageType(concat(ascii('GIF87a'), [1, 2, 3, 4, 5, 6]))).toBe('image/gif');
    expect(sniffImageType(concat(ascii('GIF89a'), [1, 2, 3, 4, 5, 6]))).toBe('image/gif');
  });

  test('RIFF....WEBP → image/webp', () => {
    expect(
      sniffImageType(concat(ascii('RIFF'), [0x24, 0x00, 0x00, 0x00], ascii('WEBP'), ascii('VP8 ')))
    ).toBe('image/webp');
  });

  test('SVG text, PDF renamed .png and random bytes → null', () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
  });

  test('a head shorter than any signature → null', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    // RIFF alone is not enough; WEBP must sit at offset 8.
    expect(sniffImageType(concat(ascii('RIFF'), [0, 0, 0, 0], ascii('ABCD')))).toBeNull();
  });
});

// TC-02: asset keys are exactly "<22-char id>/<22-char id>".
describe('ASSET_KEY_PATTERN (TC-02)', () => {
  const id22 = 'Zk3_-xQ9aB7cD2eF5gH8iJ';
  const id23 = id22 + 'x';

  test('valid board/asset key', () => {
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(id22, id22))).toBe(true);
  });

  test('missing part, traversal, oversized id', () => {
    expect(ASSET_KEY_PATTERN.test(id22)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22}/../${id22}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(id23, id22))).toBe(false);
  });

  test('assetKeyFor joins with a single slash', () => {
    expect(assetKeyFor(id22, id22)).toBe(`${id22}/${id22}`);
  });
});
