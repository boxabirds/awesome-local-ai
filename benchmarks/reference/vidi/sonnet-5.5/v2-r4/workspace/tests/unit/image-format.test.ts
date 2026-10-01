import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`../fixtures/images/${n}`, import.meta.url)));
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffImageType', () => {
  it('TC-01: accepts PNG, JPEG, GIF87a, GIF89a and WebP by content', () => {
    expect(sniffImageType(fixture('screenshot.png').subarray(0, 12))).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg').subarray(0, 12))).toBe('image/jpeg');
    expect(sniffImageType(text('GIF87a......'))).toBe('image/gif');
    expect(sniffImageType(fixture('animated.gif').subarray(0, 12))).toBe('image/gif');
    expect(sniffImageType(fixture('picture.webp').subarray(0, 12))).toBe('image/webp');
  });

  it('TC-01: refuses SVG text, a renamed PDF and a few random bytes', () => {
    expect(sniffImageType(fixture('script.svg').subarray(0, 12))).toBeNull();
    expect(sniffImageType(fixture('renamed-pdf.png').subarray(0, 12))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  it('a RIFF container that is not WebP is refused', () => {
    expect(sniffImageType(text('RIFF....WAVE'))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN', () => {
  const id = 'A'.repeat(22);
  it('TC-02: matches <22>/<22> only', () => {
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(id, 'b'.repeat(22)))).toBe(true);
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/${'b'.repeat(23)}`)).toBe(false);
  });
});
