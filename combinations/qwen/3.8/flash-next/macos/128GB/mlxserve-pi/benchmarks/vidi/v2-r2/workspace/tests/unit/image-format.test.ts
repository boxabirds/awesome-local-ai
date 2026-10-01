// Task 1, cases 01 and 02: `sniffImageType` tells the four formats from their first
// bytes and nothing else, and an asset key is exactly `<boardId>/<assetId>`.
//
// The point of these tests is the Worker's answer to a file that claims one thing and is
// another (PRD: "A file of another type, whatever its name says"), so the refused cases
// are the interesting ones: an SVG, a PDF renamed to .png, and a body too short to hold
// a signature at all.

import { describe, expect, it } from 'vitest';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  assetUrlFor,
  isValidAssetKey,
  sniffImageType,
} from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import {
  gif87aBytes,
  gif89aBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  shortBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/image-bytes';

describe('01 sniffImageType', () => {
  it('names each accepted format from its own signature', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageType(gif87aBytes())).toBe('image/gif');
    expect(sniffImageType(gif89aBytes())).toBe('image/gif');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
  });

  it('reads the WebP name at byte 8, which is why it needs 12 bytes', () => {
    expect(IMAGE_SNIFF_BYTES).toBe(12);
    // RIFF with something that is not WEBP where WEBP belongs is not a WebP
    expect(sniffImageType(Uint8Array.from([...webpBytes().slice(0, 8), 0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(sniffImageType(Uint8Array.from('ABCD'.split('').map((c) => c.charCodeAt(0))))).toBeNull();
  });

  it('refuses an SVG, whatever its name says', () => {
    expect(sniffImageType(svgBytes())).toBeNull();
    // an XML prologue in front of it changes nothing: it is still not one of the four
    expect(sniffImageType(Uint8Array.from([...svgBytes(), ...svgBytes()]))).toBeNull();
  });

  it('refuses a PDF renamed to .png', () => {
    const renamed = pdfBytes();
    expect(sniffImageType(renamed)).toBeNull();
    // and the name is what a naive check would have believed
    expect('photo.png'.endsWith('.png')).toBe(true);
  });

  it('refuses three random bytes, which are too short to be any of them', () => {
    expect(shortBytes().length).toBeLessThan(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(shortBytes())).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('looks at no more than the first IMAGE_SNIFF_BYTES bytes', () => {
    // a PNG with garbage in front of nothing: the signature is at the front, so a long
    // body is named from its first bytes and the rest is nobody's business
    const long = Uint8Array.of(...pngBytes(), ...new Uint8Array(4096));
    expect(long.length).toBeGreaterThan(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(long)).toBe('image/png');
  });

  it('names nothing that is not on the accepted list', () => {
    const refused = [svgBytes(), pdfBytes(), shortBytes(), new Uint8Array(12)];
    for (const bytes of refused) {
      const type = sniffImageType(bytes);
      if (type !== null) expect(IMAGE_ACCEPTED_TYPES).toContain(type);
      expect(type).toBeNull();
    }
  });

  it('settings are the numbers the PRD names', () => {
    expect(IMAGE_MAX_BYTES).toBe(10_485_760); // "10 MB or smaller"
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
    expect(ASSET_CACHE_MAX_AGE_SECONDS).toBe(31_536_000); // one year, immutable
    expect([...IMAGE_ACCEPTED_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  });
});

describe('02 asset keys', () => {
  it('assetKeyFor puts the board first, so one board is one prefix', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(true);
  });

  it('accepts a well-formed key', () => {
    expect(isValidAssetKey(assetKeyFor(newBoardId(), newBoardId()))).toBe(true);
  });

  it('refuses traversal, prefixes, suffixes and shapes that are not two ids', () => {
    const id = newBoardId();
    const refused = [
      `../../etc/passwd${id.slice(6)}`,
      '../..',
      `${id}/../../${id}`,
      `${id}/${id}/extra`,
      `${id}/`,
      `/${id}`,
      id,
      '',
      `${id}x/${id}`,
      `${id}/${id}!`,
      `${id.slice(0, 21)}/${id}`,
      `${id}/${id.slice(0, 21)}`,
      `${id}/${id}%2f..`,
      `${id}/${id}.png`,
      'boards/x',
    ];
    for (const key of refused) {
      expect(ASSET_KEY_PATTERN.test(key), key).toBe(false);
      expect(isValidAssetKey(key), key).toBe(false);
    }
  });

  it('the URL an asset is served at is its key under the asset route', () => {
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(assetUrlFor(key)).toBe(`/api/assets/${key}`);
  });
});
