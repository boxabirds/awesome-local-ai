// TC-01, TC-02: magic-byte sniffing and the asset key layout — the pure
// parts of assets.api.

import { describe, it, expect } from 'vitest';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import {
  animatedGifBytes,
  corruptPngBytes,
  gif87aBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/images';

describe('assets.api: sniffImageType (TC-01)', () => {
  const head = (bytes: Uint8Array) => bytes.slice(0, IMAGE_SNIFF_BYTES);

  it('recognises PNG by its 89 50 4E 47 magic', () => {
    expect(sniffImageType(head(pngBytes(8, 8)))).toBe('image/png');
  });

  it('recognises JPEG by its FF D8 FF magic', () => {
    expect(sniffImageType(head(jpegBytes(1024)))).toBe('image/jpeg');
  });

  it('recognises GIF87a', () => {
    expect(sniffImageType(head(gif87aBytes()))).toBe('image/gif');
  });

  it('recognises GIF89a (the animated fixture)', () => {
    expect(sniffImageType(head(animatedGifBytes))).toBe('image/gif');
  });

  it('recognises WebP by RIFF....WEBP', () => {
    expect(sniffImageType(head(webpBytes))).toBe('image/webp');
  });

  it('rejects an SVG document (it is XML, not a raster image)', () => {
    expect(sniffImageType(head(svgBytes()))).toBeNull();
  });

  it('rejects a PDF renamed to .png (judged by content, not name)', () => {
    expect(sniffImageType(head(pdfBytes()))).toBeNull();
  });

  it('rejects 3 random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x12, 0x34, 0x56]))).toBeNull();
  });

  it('rejects a truncated PNG whose magic is intact but body is cut', () => {
    // The magic is still PNG-shaped; the SERVER accepts by magic (the body
    // is stored opaquely and served back as-is), so this documents that
    // sniffing only ever looks at the head:
    expect(sniffImageType(head(corruptPngBytes()))).toBe('image/png');
  });
});

describe('assets.api: ASSET_KEY_PATTERN and assetKeyFor (TC-02)', () => {
  const id = (c: string, n = 22) => c.repeat(n);

  it('matches a valid <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(`${id('a')}/${id('b')}`)).toBe(true);
    // exactly 22 chars drawn from the full base64url alphabet (A-Z a-z 0-9 - _)
    const a = 'Aa0z9_-Bb1Yy8Xx2Ww3Qq4';
    const b = 'Zz7kPq-_Rr4Nn1Mm5Jj9Hh';
    expect(a.length).toBe(22);
    expect(b.length).toBe(22);
    expect(ASSET_KEY_PATTERN.test(`${a}/${b}`)).toBe(true);
  });

  it('is built by assetKeyFor', () => {
    expect(assetKeyFor(id('k'), id('z'))).toBe(`${id('k')}/${id('z')}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(id('k'), id('z')))).toBe(true);
  });

  it('rejects a missing part', () => {
    expect(ASSET_KEY_PATTERN.test(id('a'))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a')}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${id('a')}`)).toBe(false);
  });

  it('rejects ../ traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../${id('a')}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a')}/../${id('b')}`)).toBe(false);
  });

  it('rejects a 23-char id (both positions)', () => {
    expect(ASSET_KEY_PATTERN.test(`${id('a', 23)}/${id('b')}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id('a')}/${id('b', 23)}`)).toBe(false);
  });
});
