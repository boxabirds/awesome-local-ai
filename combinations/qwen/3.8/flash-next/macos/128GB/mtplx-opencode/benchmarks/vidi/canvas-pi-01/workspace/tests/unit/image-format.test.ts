/**
 * Story 12 · task 1 — image format sniffing + asset key tests (TC-01, TC-02).
 *
 * Pure functions, no request and no bucket: the whole point of `assets.api`'s
 * sniffing is that a file's *content* decides its type, so the negative cases
 * (a PDF wearing a `.png` name, an SVG with a script, three random bytes) are
 * as important as the positive ones and are asserted here before anything
 * reaches the network. A "valid" fixture here only needs the correct magic
 * bytes to be recognised — decoding is the browser's business, tested in e2e.
 */
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';

function bytes(...parts: number[]): Uint8Array {
  return Uint8Array.from(parts);
}

describe('sniffImageType (TC-01)', () => {
  it('recognises each supported format from its magic bytes', () => {
    // A full PNG signature plus IHDR.
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d))).toBe(
      'image/png',
    );
    // JPEG SOI + the start of an APPn marker.
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
    // GIF87a and GIF89a are both accepted.
    expect(sniffImageType(Buffer.from('GIF87a', 'ascii'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif');
    // WebP: `RIFF` + a four-byte length + `WEBP`.
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 0xec, 0x0e, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('refuses an SVG, a disguised PDF and three random bytes', () => {
    // SVG begins with `<svg` — even with a script inside, it is not an image.
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'ascii'))).toBeNull();
    // A PDF renamed `.png`: the bytes still say `%PDF`.
    expect(sniffImageType(Buffer.from('%PDF-1.7\n%\xc2\xc2\xc2\n', 'binary'))).toBeNull();
    // Three random bytes carry no recognisable header.
    expect(sniffImageType(bytes(0x00, 0x11, 0x22))).toBeNull();
  });

  it('is fed only the first IMAGE_SNIFF_BYTES and still sees a WebP tag', () => {
    // The WebP signature needs twelve bytes; a shorter head is a miss.
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
    expect(webp.length).toBe(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(webp)).toBe('image/webp');
    // RIFF alone, with no WEBP tag inside the window, is not a WebP.
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN and assetKeyFor (TC-02)', () => {
  const boardId = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 URL-safe chars
  const assetId = 'bbbbbbbbbbbbbbbbbbbbbb'; // 22 URL-safe chars

  it('accepts a valid `<22>/<22>` key', () => {
    const key = assetKeyFor(boardId, assetId);
    expect(key).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects a missing part, a traversal, and a 23-character id', () => {
    // Missing part: no separator, or an empty side.
    expect(ASSET_KEY_PATTERN.test(boardId)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${assetId}`)).toBe(false);
    // Traversal: the whole point of the pattern is to stop `../`.
    expect(ASSET_KEY_PATTERN.test('../../etc/passwd')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/../${assetId}`)).toBe(false);
    // A 23-character id is the wrong length.
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${assetId}x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}x/${assetId}`)).toBe(false);
  });
});