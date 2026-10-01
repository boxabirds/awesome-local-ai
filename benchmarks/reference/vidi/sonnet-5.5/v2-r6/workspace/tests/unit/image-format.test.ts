import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { gif87, gif89, pngBytes, webpBytes } from '../fixtures/image-bytes';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`));
const id22 = 'A'.repeat(22);

describe('sniffImageType', () => {
  it('TC-01: recognises PNG, JPEG, GIF87a, GIF89a and WebP by content', () => {
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(gif87())).toBe('image/gif');
    expect(sniffImageType(gif89())).toBe('image/gif');
    expect(sniffImageType(fixture('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
    expect(sniffImageType(fixture('sample.webp'))).toBe('image/webp');
  });

  it('TC-01: refuses SVG text, a PDF renamed .png and tiny random input', () => {
    expect(sniffImageType(fixture('script.svg'))).toBeNull();
    expect(sniffImageType(fixture('not-an-image.png'))).toBeNull();
    expect(sniffImageType(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('a RIFF container that is not WebP is refused', () => {
    const wav = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0))));
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN', () => {
  it('TC-02: accepts <22>/<22> and rejects missing part, traversal and a 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test(`${id22}/${id22}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(id22)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22}/../x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id22}/${id22}A`)).toBe(false);
    expect(assetKeyFor('b', 'a')).toBe('b/a');
  });
});
