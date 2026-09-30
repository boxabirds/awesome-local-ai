// Deciding an image's type from its bytes, and the shape of a stored key
// (`assets.api`, TC-01, TC-02).
//
// Both are pure and the whole point of them is that they need nothing: no request, no
// board, no bucket. `sniffImageType` is the last line of defence against a file that
// is not what it claims (a PDF renamed `.png`, an SVG that carries a script), and it
// is pure *because* the same decision has to be reachable from a unit test, from the
// Worker, and — via the shared module — from nowhere that can touch the DOM.
// `ASSET_KEY_PATTERN` is the shape-check that lets a `../` be refused before the
// bucket is ever asked.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Asset upload and
// serving API" — Tests (unit).
import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  isAssetKey,
  sniffImageType,
} from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import {
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  randomBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/image-fixtures';

describe('sniffImageType (assets.api, TC-01)', () => {
  // TC-01: the four accepted types, from their signatures alone.
  it('recognises every accepted type by its magic bytes', () => {
    expect(sniffImageType(pngBytes(64).subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/png');
    expect(sniffImageType(jpegBytes(64).subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/jpeg');
    expect(sniffImageType(gifBytes(32, '89a'))).toBe('image/gif');
    expect(sniffImageType(gifBytes(32, '87a'))).toBe('image/gif');
    expect(sniffImageType(webpBytes(32))).toBe('image/webp');
  });

  // TC-01 (negative): a script-carrying SVG, a PDF, and bytes that are neither.
  it('refuses an SVG, a PDF and unrecognised bytes', () => {
    expect(sniffImageType(svgBytes())).toBeNull();
    // A PDF renamed `.png` is still a PDF to the bytes, which is the entire security
    // value of sniffing (the client would have been told `image/png`).
    expect(sniffImageType(pdfBytes(64))).toBeNull();
    expect(sniffImageType(randomBytes())).toBeNull();
  });

  // A signature that is only half present — the file cut off where the type lives —
  // is not that type; a short head is answered, not thrown on.
  it('does not invent a type from a partial signature', () => {
    // `RIFF` without the `WEBP` four bytes further in is not a WebP.
    const riffOnly = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(riffOnly)).toBeNull();
    // Two bytes too few to carry even the JPEG marker.
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    // The empty head is nothing at all, and does not crash.
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN / assetKeyFor (assets.api, TC-02)', () => {
  // TC-02: a real key is `<boardId>/<assetId>`, both halves a 22-char board id.
  it('accepts a well-shaped key', () => {
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(isAssetKey(key)).toBe(true);
  });

  // TC-02 (negative): everything that is not exactly that shape.
  it('refuses a key that is not exactly <22>/<22>', () => {
    const id = newBoardId();
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false); // a missing part
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false); // a traversal
    expect(ASSET_KEY_PATTERN.test(`${'x'.repeat(23)}/${id}`)).toBe(false); // 23-char id
    expect(ASSET_KEY_PATTERN.test(`${id}/${'x'.repeat(21)}`)).toBe(false); // 21-char id
    expect(ASSET_KEY_PATTERN.test(`${id}/${id}/extra`)).toBe(false); // a third part
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  // The key joins two ids with a single slash, so it is always what the pattern says.
  it('joins a board id and an asset id with one slash', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });
});
