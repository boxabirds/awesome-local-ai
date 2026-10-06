/**
 * What a file is, and what a board may be asked for (story 12, TC-01, TC-02).
 *
 * Two pure things, both of which are decisions rather than computations, and both of which are made once,
 * here, on both sides of the network:
 *
 * - **The format is read out of the bytes.** Everything else about a file is a claim: its name is an
 *   opinion somebody typed, its `Content-Type` is an opinion a browser formed from that name, and the two
 *   test files that exercise this function are those claims being deliberately false. So the test for a
 *   sniffer is not a test of a lookup table, it is a test of which of the two accounts of a file this
 *   function believes — which is why the fixtures below are read from disk as well as written out as bytes:
 *   a signature copied into a test proves the test agrees with itself, and a signature taken from a file
 *   that a camera made proves it agrees with the world.
 * - **The key is a shape, not a string.** An asset's address is the only thing standing between one
 *   person's pictures and everybody else's, because there is no sign-in on this board. The shape is what
 *   makes it enough: two ids of the kind story 5 generates, joined by one slash, with nothing in the
 *   pattern that can hold a dot, a second slash or a directory. `../x` is not escaped by this function,
 *   it is *not a key*, and the difference is that nothing downstream has to remember to be careful.
 *
 * The suite is deliberately unromantic about the negative cases: an SVG is refused, a PDF renamed `.png` is
 * refused, three random bytes are refused. Every one of them is a file somebody will drop onto a board.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import {
  ASSET_KEY_PATTERN,
  ACCEPTED_IMAGE_TYPES,
  assetKeyFor,
  isAcceptedImageType,
  SNIFF_BYTES,
  sniffImageType,
  splitAssetKey,
} from '../../src/shared/image-format';

/** A fixture's first bytes, which is all a sniffer is ever given. */
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url)));

/** These bytes, as the bytes a file of that type really starts with. */
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('sniffImageType names a format by its bytes (TC-01)', () => {
  it('recognises each of the four in the real file it came from', () => {
    // Not a signature typed into a test: a screenshot, a photograph, an animation and a WebP, as made by
    // the tools that make them. If a sniffer only ever met the signatures its author remembered, this half
    // of the suite would be the half that caught nothing.
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(fixture('animation.gif'))).toBe('image/gif');
    expect(sniffImageType(fixture('picture.webp'))).toBe('image/webp');
  });

  it('recognises a PNG, a JPEG and a WebP from their signatures alone', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0xd))).toBe('image/png');
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0x01))).toBe('image/jpeg');
    // `RIFF`, then the chunk's own length, then `WEBP`: the four bytes in the middle are nobody's business.
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
  });

  it('takes either version of GIF, because both of them are GIF', () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0))).toBe('image/gif');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0))).toBe('image/gif');
  });

  it('answers with one of the four accepted types, whatever it was asked about', () => {
    for (const name of ['screenshot.png', 'photo.jpg', 'animation.gif', 'picture.webp']) {
      const found = sniffImageType(fixture(name));
      expect(found).not.toBeNull();
      expect(IMAGE_ACCEPTED_TYPES).toContain(found);
    }
  });

  it('refuses an SVG, which is a document that can carry a script', () => {
    // The one format that is an image in every sense of the word and is still refused: an `<img>` would draw
    // it, and a board that served it back with no idea what was in it would be serving somebody's script
    // alongside it. PRD `image.types` says raster only, and this is that sentence.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(fixture('diagram.svg'))).toBeNull();
  });

  it('refuses a PDF wearing a PNG name, whatever its name says', () => {
    // `fake-image.png` is this file's whole purpose: named as a picture, served by a browser as
    // `image/png`, and the bytes still say `%PDF`.
    expect(fixture('fake-image.png').subarray(0, 4)).toEqual(bytes(0x25, 0x50, 0x44, 0x46));
    expect(sniffImageType(fixture('fake-image.png'))).toBeNull();
  });

  it('refuses bytes that are nothing, and bytes that are almost a format', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes(0x01, 0x02, 0x03))).toBeNull();
    // `FF D8` without the third byte is the start of a JPEG and not a JPEG; the marker that follows the
    // start of image is what separates a picture from two bytes that happened to be there.
    expect(sniffImageType(bytes(0xff, 0xd8, 0x00))).toBeNull();
    // `RIFF` is a container, and half the formats in the world are one: WAV and AVI among them.
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    // A PNG whose last signature byte was rewritten in transit is exactly what the eight-byte check is for.
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00, 0, 0, 0, 0))).toBeNull();
    // A file shorter than the shortest signature is refused rather than indexed past its end.
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });

  it('reads no more of the file than it has to', () => {
    // The window is a setting because a sniffer that read a whole file to name its format would be reading
    // ten megabytes to answer a question that twelve bytes answer.
    expect(SNIFF_BYTES).toBe(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    // The same answer when it is handed the whole file and when it is handed only the window.
    expect(sniffImageType(fixture('screenshot.png').subarray(0, SNIFF_BYTES))).toBe('image/png');
  });
});

describe('a key is a shape (TC-02)', () => {
  /** A key of the kind this board hands out. */
  const key = (): string => assetKeyFor(newBoardId(), newBoardId());

  it('accepts a key made of two board-shaped ids', () => {
    expect(ASSET_KEY_PATTERN.test(key())).toBe(true);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor('a'.repeat(22), 'b'.repeat(22)))).toBe(true);
  });

  it('refuses a key with a part missing', () => {
    expect(ASSET_KEY_PATTERN.test(newBoardId())).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${newBoardId()}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${newBoardId()}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  it('refuses a key that climbs out of the bucket', () => {
    // The three ways a person asks for something other than what they were given. None of them is a key,
    // so none of them reaches the bucket at all — which is a stronger guarantee than escaping them,
    // because it does not depend on whoever reads the key remembering to.
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${newBoardId()}/../${newBoardId()}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${newBoardId()}/..%2Fx`)).toBe(false);
  });

  it('refuses an id of the wrong length, and an id of the wrong kind', () => {
    // 22 characters is what 128 bits of randomness looks like in base64url. An id of another length did not
    // come from this board's generator, whatever it thinks it is.
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(21)}/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/${'b'.repeat(23)}`)).toBe(false);
    // Characters base64url does not use: a `+` is padding's cousin, a `.` is a directory's own letter.
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(21)}+/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/${'b'.repeat(19)}.png`)).toBe(false);
    // Three parts is not a key with a spare; it is a path.
    expect(ASSET_KEY_PATTERN.test(`${newBoardId()}/${newBoardId()}/${newBoardId()}`)).toBe(false);
  });

  it('builds a key from a board and a splits it back into the same two ids', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    const built = assetKeyFor(boardId, assetId);
    expect(built).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(built)).toBe(true);
    expect(splitAssetKey(built)).toEqual({ boardId, assetId });
    expect(splitAssetKey('../x')).toBeNull();
  });

  it('ids from the board generator are the ids the pattern wants', () => {
    // The one assumption in this file that could rot quietly: the pattern is written in terms of 22
    // characters and the generator is written in terms of 16 random bytes. If either changed, every key
    // already stored would stop matching, and the picture on every board would become "Image unavailable".
    for (let i = 0; i < 20; i += 1) expect(ASSET_KEY_PATTERN.test(assetKeyFor(newBoardId(), newBoardId()))).toBe(true);
  });

  it('knows which types it is talking about', () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(IMAGE_ACCEPTED_TYPES);
    expect(isAcceptedImageType('image/webp')).toBe(true);
    expect(isAcceptedImageType('image/svg+xml')).toBe(false);
    expect(isAcceptedImageType(undefined)).toBe(false);
    expect(isAcceptedImageType('IMAGE/PNG')).toBe(false);
  });
});
