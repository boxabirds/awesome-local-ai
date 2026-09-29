// Story 12, task 1: unit tests for the shared image-format helpers
// (TC-01, TC-02) — pure magic-byte sniffing and asset-key validation.

import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';

// --- Magic-byte heads (leading bytes of each format) -------------------------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x3b]);
const GIF89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
// "RIFF" <4-byte size> "WEBP"
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
// "<svg" — a vector that must be refused (it can carry scripts).
const SVG = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20]);
// "%PDF-1." — a PDF renamed to .png.
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const RANDOM = new Uint8Array([0x00, 0x01, 0x02]);

describe('sniffImageType (TC-01)', () => {
  it('recognises the accepted raster signatures', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF87a)).toBe('image/gif');
    expect(sniffImageType(GIF89a)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects SVG, a renamed PDF and random bytes (negative)', () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(PDF)).toBeNull();
    expect(sniffImageType(RANDOM)).toBeNull();
  });

  it('rejects an empty / too-short head (error path)', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89]))).toBeNull(); // partial PNG
  });
});

// --- Asset key pattern --------------------------------------------------------

const id22 = (n: number): string => newBoardId().slice(0, n); // 22 chars

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('accepts a valid <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(newBoardId(), newBoardId()))).toBe(true);
  });

  it('rejects a missing part, a ../ path and a 23-char id (negative)', () => {
    expect(ASSET_KEY_PATTERN.test('abc')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abc/def')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(newBoardId())).toBe(false); // missing second part
    expect(ASSET_KEY_PATTERN.test(`../${newBoardId()}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`a${id22(22)}/${newBoardId()}`)).toBe(false); // 23-char first
    expect(ASSET_KEY_PATTERN.test(`${newBoardId()}/a${id22(22)}`)).toBe(false); // 23-char second
  });
});
