/**
 * Unit tests for image-format: sniffImageType and ASSET_KEY_PATTERN (TC-01, TC-02).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

const FIXTURES = resolve(__dirname, '../fixtures/images');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

describe('sniffImageType', () => {
  // TC-01
  it('detects PNG from magic bytes', () => {
    expect(sniffImageType(fixture('tiny.png'))).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    expect(sniffImageType(fixture('tiny.jpg'))).toBe('image/jpeg');
  });

  it('detects GIF87a from magic bytes', () => {
    expect(sniffImageType(fixture('tiny.gif'))).toBe('image/gif');
  });

  it('detects GIF89a from magic bytes', () => {
    expect(sniffImageType(fixture('tiny89a.gif'))).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    expect(sniffImageType(fixture('tiny.webp'))).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    expect(sniffImageType(fixture('script.svg'))).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    expect(sniffImageType(fixture('fake.png'))).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    expect(sniffImageType(fixture('random3.bin'))).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN', () => {
  // TC-02
  it('matches valid key (22 chars / 22 chars)', () => {
    const valid = 'abcdefghijklmnopqrstuv/123456789012345678901a';
    expect(ASSET_KEY_PATTERN.test(valid)).toBe(true);
  });

  it('rejects missing part (no slash)', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv123456789012345678901a')).toBe(false);
  });

  it("rejects '../' traversal", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id segment', () => {
    const bad = 'abcdefghijklmnopqrstuvw/123456789012345678901a';
    expect(ASSET_KEY_PATTERN.test(bad)).toBe(false);
  });

  it('rejects 21-char id segment', () => {
    const bad = 'abcdefghijklmnopqrstu/123456789012345678901a';
    expect(ASSET_KEY_PATTERN.test(bad)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins boardId and assetId with a slash', () => {
    const board = 'abcdefghijklmnopqrstuv';
    const asset = '123456789012345678901a';
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
  });
});
