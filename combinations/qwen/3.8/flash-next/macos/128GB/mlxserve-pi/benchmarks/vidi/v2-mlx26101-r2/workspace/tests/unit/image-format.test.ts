/**
 * What an image is, judged by its bytes (`tests/unit/image-format.test.ts`).
 *
 * TC-01 and TC-02 of story 12: the two pure decisions behind `assets.api` - which
 * of the four accepted types these bytes are, and which strings are legal asset
 * keys. Both are unit-tested rather than only tested through the Worker because
 * they are the *security* answer of the upload route: everything the HTTP contract
 * promises about a PDF renamed `.png` and an SVG rests on these two functions being
 * right about a byte sequence, and an integration test can only show that one
 * particular disguised file was refused.
 *
 * The fixtures are real where it matters: {@link pngBytes} writes a PNG a browser
 * can actually decode, and the rest carry the signature they are named after.
 */

import { describe, expect, it } from 'vitest';

import {
  ASSET_KEY_PATTERN,
  ASSET_ROUTE_PREFIX,
  assetKeyFor,
  assetPathFor,
  assetUploadPathFor,
  isAssetKey,
  sniffImageType,
} from '../../src/shared/image-format.js';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config.js';
import {
  bytes,
  bytesOfLength,
  gifBytes,
  jpegBytes,
  junkBytes,
  pdfBytes,
  pngBytes,
  svgWithScriptBytes,
  webpBytes,
} from '../fixtures/image-fixtures.js';

/** The first bytes of a file are what the Worker gets to see. */
const head = (source: Uint8Array): Uint8Array => source.slice(0, IMAGE_SNIFF_BYTES);

describe('sniffImageType (TC-01)', () => {
  it('calls a PNG a PNG, by its signature', () => {
    expect(sniffImageType(head(pngBytes(8, 8)))).toBe('image/png');
  });

  it('calls a JPEG a JPEG', () => {
    expect(sniffImageType(head(jpegBytes(4096)))).toBe('image/jpeg');
  });

  it('calls both GIF versions a GIF', () => {
    expect(sniffImageType(head(gifBytes('87a')))).toBe('image/gif');
    expect(sniffImageType(head(gifBytes('89a')))).toBe('image/gif');
  });

  it('calls a WebP a WebP, which is the only signature that needs all twelve bytes', () => {
    const webp = head(webpBytes());
    expect(webp.length).toBe(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(webp)).toBe('image/webp');
    // The signature is RIFF *and* WEBP at byte 8: the four bytes between them are the
    // container's length, and a file that says RIFF without saying WEBP is a WAV, an
    // AVI or a FLAC, none of which is an image.
    expect(sniffImageType(bytes([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, ...'WAVE']))).toBeNull();
  });

  it('refuses an SVG, whatever it is called', () => {
    // An SVG is XML text. It is the case that matters most: an SVG can carry a script,
    // and a file served from the board's own origin would be able to run it.
    expect(sniffImageType(head(svgWithScriptBytes()))).toBeNull();
    expect(sniffImageType(head(svgWithScriptBytes()))).not.toBe('image/png');
  });

  it('refuses a PDF renamed .png, because a name is not a signature', () => {
    const renamed = head(pdfBytes());
    expect(renamed[0]).toBe(0x25); // '%'
    expect(sniffImageType(renamed)).toBeNull();
  });

  it('refuses three random bytes, which is not a signature of anything', () => {
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(junkBytes(3).slice(0, 3))).toBeNull();
  });

  it('refuses an empty body and a body shorter than a signature', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });

  it('never answers with a type the board does not accept', () => {
    const samples = [
      pngBytes(4, 4),
      jpegBytes(64),
      gifBytes('87a'),
      gifBytes('89a'),
      webpBytes(),
      svgWithScriptBytes(),
      pdfBytes(),
      junkBytes(64),
    ];
    for (const sample of samples) {
      const sniffed = sniffImageType(head(sample));
      if (sniffed === null) continue;
      expect(IMAGE_ACCEPTED_TYPES).toContain(sniffed);
    }
  });

  it('is decided by the signature alone: the bytes after it are never read', () => {
    // A body that is a PNG signature followed by nothing else is still a PNG as far as
    // the sniff is concerned - which is exactly why the size check has to exist.
    expect(sniffImageType(bytesOfLength(4, [0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
  });
});

describe('asset keys (TC-02)', () => {
  const boardId = 'vN8d2mKx1pQ0tY7rZ4wL3A';
  const assetId = 'qT7s2LpQ9xK1mY4rZ8wB3c';

  it('accepts a board id, a slash and an asset id', () => {
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(true);
    expect(isAssetKey(`${boardId}/${assetId}`)).toBe(true);
  });

  it('refuses a key with a part missing', () => {
    expect(ASSET_KEY_PATTERN.test(boardId)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  it('refuses a path that climbs out of the bucket', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/../${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${assetId}/../../etc/passwd`)).toBe(false);
  });

  it('refuses an id of the wrong length, because 128 bits is the promise', () => {
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${assetId}x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}x/${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${assetId}x`)).toBe(false);
  });

  it('puts the board first, so one board can never name another board’s file', () => {
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
    expect(assetKeyFor(boardId, assetId).split('/')[0]).toBe(boardId);
  });

  it('builds the two addresses the client and the Worker agree on', () => {
    expect(assetPathFor(`${boardId}/${assetId}`)).toBe(
      `${ASSET_ROUTE_PREFIX}${boardId}/${assetId}`,
    );
    expect(assetUploadPathFor(boardId)).toBe(`/api/boards/${boardId}/assets`);
  });
});
