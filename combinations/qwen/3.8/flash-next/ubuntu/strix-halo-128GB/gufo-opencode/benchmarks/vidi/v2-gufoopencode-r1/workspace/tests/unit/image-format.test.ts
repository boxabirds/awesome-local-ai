import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';

function fixtureHead(name: string): Uint8Array {
  const bytes = readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url));
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('TC-01 sniffImageType (magic bytes only)', () => {
  test('recognizes accepted raster types by content', () => {
    expect(sniffImageType(fixtureHead('png-screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixtureHead('jpeg-photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(ascii('GIF87a\x01\x00\x00\x00\x00'))).toBe('image/gif');
    expect(sniffImageType(fixtureHead('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(fixtureHead('photo.webp'))).toBe('image/webp');
  });

  test('rejects SVG, disguised PDF and random bytes', () => {
    expect(sniffImageType(fixtureHead('injected.svg'))).toBeNull();
    expect(sniffImageType(fixtureHead('renamed-pdf.png'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x51, 0x2f, 0x3a]))).toBeNull();
  });

  test('truncated magic bytes do not match', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });
});

describe('TC-02 ASSET_KEY_PATTERN and assetKeyFor', () => {
  const a = 'A1_b-cdef0123456789xyz';
  const b = 'Z9_x-yvw6543210987abcd';

  test('valid <22>/<22> key passes', () => {
    expect(ASSET_KEY_PATTERN.test(`${a}/${b}`)).toBe(true);
  });

  test('missing part, traversal and wrong length fail', () => {
    expect(ASSET_KEY_PATTERN.test(a)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${a}x/${b}`)).toBe(false);
  });

  test('assetKeyFor joins board and asset ids with one slash', () => {
    expect(assetKeyFor(a, b)).toBe(`${a}/${b}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(a, b))).toBe(true);
  });
});
