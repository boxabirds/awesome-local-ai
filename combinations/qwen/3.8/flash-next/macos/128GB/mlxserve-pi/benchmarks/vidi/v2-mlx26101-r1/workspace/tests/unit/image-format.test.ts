// assets.api unit tests (story 12, TC-01, TC-02).
//
// Two pure functions, both of which are a security answer rather than a convenience:
//
//   * What kind of image is this? (image.sniff). The filename is a claim; the bytes are the fact.
//     Everything the board does after this point — what it stores, what Content-Type it answers with,
//     what it tells the browser not to interpret (image.types) — is decided by the twelve bytes this
//     reads, so the test hands it the twelve bytes of each type, including the two files whose names
//     lie.
//   * Is this a key? (image.key_shape). The key is the only thing standing between a stranger and
//     somebody else's holiday photographs, and it doubles as a filesystem path. So the shape is
//     checked as text here, before a bucket is ever asked, and `../` is in the test list for the
//     reason you would expect.
//
// Real fixtures are used alongside hand-written headers: the headers say what the code believes a PNG
// starts with, the fixtures say that a PNG made by a real encoder agrees.

import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  boardIdOfAssetKey,
  isAssetKey,
  sniffImageType,
} from '../../src/shared/image-format';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { headerOf, imageFixture, pdfBytes, svgBytes } from '../fixtures/image-files';

/** The leading bytes of a file, as the Worker would read them off the request body. */
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('sniffImageType (TC-01)', () => {
  it('reads a PNG by its eight-byte signature', () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)),
    ).toBe('image/png');
  });

  it('reads a JPEG by its three-byte start of image marker', () => {
    expect(
      sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01)),
    ).toBe('image/jpeg');
  });

  it('reads both GIF versions', () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00))).toBe('image/gif');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00))).toBe('image/gif');
  });

  it('reads a WebP as RIFF … WEBP, ignoring the size in between', () => {
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 0x38, 0x01, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe('image/webp');
  });

  it('agrees with the fixtures a real encoder produced', () => {
    const sniffed = (name: Parameters<typeof headerOf>[0]) => sniffImageType(headerOf(name));
    expect(sniffed('screenshot-1440x900.png')).toBe('image/png');
    expect(sniffed('photo-4032x3024.jpg')).toBe('image/jpeg');
    expect(sniffed('animation.gif')).toBe('image/gif');
    expect(sniffed('picture.webp')).toBe('image/webp');
  });

  it('refuses an SVG, a PDF wearing a .png name, and three random bytes (image.types)', () => {
    expect(sniffImageType(svgBytes())).toBeNull();
    expect(sniffImageType(pdfBytes())).toBeNull();
    expect(sniffImageType(bytes(0x01, 0x02, 0x03))).toBeNull();
  });

  it('is not fooled by the name of the file it is handed', () => {
    // The fixture is a real PDF and its name ends in .png, which is the whole trick: nothing in this
    // module ever looks at a name.
    expect(headerOf('renamed-pdf.png').length).toBeGreaterThan(0);
    expect(String.fromCharCode(...pdfBytes().subarray(0, 4))).toBe('%PDF');
    expect(sniffImageType(imageFixture('renamed-pdf.png'))).toBeNull();
  });

  it('refuses a GIF that is not version 87a or 89a, and a short file of any kind', () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x62))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('only ever answers with a type the board says it accepts', () => {
    for (const name of [
      'screenshot-1440x900.png',
      'photo-4032x3024.jpg',
      'animation.gif',
      'picture.webp',
      'renamed-pdf.png',
      'truncated.png',
    ] as const) {
      const found = sniffImageType(headerOf(name, IMAGE_SNIFF_BYTES));
      if (found === null) continue;
      expect(IMAGE_ACCEPTED_TYPES).toContain(found);
    }
  });
});

describe('asset keys (TC-02)', () => {
  const boardId = newBoardId();
  const assetId = newBoardId();

  it('accepts a key built from two board-shaped ids', () => {
    const key = assetKeyFor(boardId, assetId);
    expect(key).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(isAssetKey(key)).toBe(true);
    expect(boardIdOfAssetKey(key)).toBe(boardId);
  });

  it('refuses a key that is missing a part', () => {
    expect(ASSET_KEY_PATTERN.test(assetId)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${assetId}`)).toBe(false);
  });

  it("refuses '../' and anything else that is not two ids with one slash between them", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/../${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`..%2f${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}//${assetId}`)).toBe(false);
  });

  it('refuses an id that is one character too long, or too short', () => {
    expect(ASSET_KEY_PATTERN.test(`${'x'.repeat(23)}/${'y'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'x'.repeat(21)}/${'y'.repeat(22)}`)).toBe(false);
  });

  it('never produces a key a browser would read as a path, for any two real ids', () => {
    for (let i = 0; i < 50; i += 1) {
      const key = assetKeyFor(newBoardId(), newBoardId());
      expect(isAssetKey(key)).toBe(true);
      expect(key).not.toContain('..');
    }
  });
});
