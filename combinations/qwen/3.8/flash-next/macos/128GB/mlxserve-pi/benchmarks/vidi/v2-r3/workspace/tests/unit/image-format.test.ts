import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  boardIdOfKey,
  isImageFormat,
  sniffImageType,
} from '../../src/shared/image-format';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { assetPath, boardAssetsPath } from '../../src/shared/routes';

/**
 * Story 12, assets.api: what a file *is* is read from its bytes, and the key it is
 * kept under is made by the board. Both are pure functions of a handful of bytes,
 * which is what makes them testable without a request, a bucket or a browser — and
 * what makes the answer the same in all three places that ask it.
 */

/** Bytes from characters, for the signatures which are text. */
const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ascii('IHDR')]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF87 = new Uint8Array([...ascii('GIF87a'), 0x01, 0x02]);
const GIF89 = new Uint8Array([...ascii('GIF89a'), 0x01, 0x02]);
const WEBP = new Uint8Array([
  ...ascii('RIFF'),
  0x00,
  0x00,
  0x00,
  0x00,
  ...ascii('WEBP'),
  ...ascii('VP8 '),
]);

/** A `head` of `bytes` padded to the length the sniff is given. */
const head = (bytes: number[]): Uint8Array => new Uint8Array(bytes).subarray(0, IMAGE_SNIFF_BYTES);

describe('TC-01: sniffImageType names a format from its bytes and from nothing else', () => {
  it('PNG, JPEG, both GIFs and WebP are the four formats', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF87)).toBe('image/gif');
    expect(sniffImageType(GIF89)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('every format the sniff can name is a format the board accepts', () => {
    for (const bytes of [PNG, JPEG, GIF87, GIF89, WEBP]) {
      const type = sniffImageType(bytes);
      expect(IMAGE_ACCEPTED_TYPES).toContain(type);
      expect(isImageFormat(type)).toBe(true);
    }
  });

  it('an SVG is nothing, whatever it is called', () => {
    // The file a person would try twice: it is a picture, it opens in a browser,
    // and it is the one format that arrives as text and can carry a script.
    const withBom = head([0xef, 0xbb, 0xbf, ...ascii('<svg xmlns="http://www.w')]);
    expect(sniffImageType(withBom)).toBeNull();
    expect(sniffImageType(head(ascii('<svg xmlns="http://www.w')))).toBeNull();
  });

  it('a PDF renamed .png is a PDF', () => {
    // The name is on the way to the browser and never further; these four bytes
    // are the whole of the answer.
    const pdf = head([...ascii('%PDF-1.7\n%âãÏÓ\n1 0'), 0x20]);
    expect(sniffImageType(pdf)).toBeNull();
  });

  it('three bytes of nothing are nothing', () => {
    expect(sniffImageType(head([0x01, 0x02, 0x03]))).toBeNull();
  });

  it('a head shorter than a signature is not a signature', () => {
    // The four bytes of 'GIF8' say a GIF is coming and do not say it is one.
    expect(sniffImageType(head(ascii('GIF8')))).toBeNull();
    expect(sniffImageType(head([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('a PNG whose terminator is missing is still a PNG', () => {
    // Only the part of the signature which identifies the format is asked about:
    // `‰PNG` is the format, and the four bytes after it are a convenience.
    expect(sniffImageType(head([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBe('image/png');
  });

  it('a RIFF file which is not a WebP is not a WebP', () => {
    // RIFF is a container: a WAV and an AVI start the same way, and neither is a
    // picture. The word at byte 8 is the one that matters.
    const wav = new Uint8Array([...ascii('RIFF'), 0x00, 0x00, 0x00, 0x00, ...ascii('WAVEfmt ')]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('a JPEG whose third byte is not a marker is not a JPEG', () => {
    expect(sniffImageType(head([0xff, 0xd8, 0x00, 0xe0]))).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN accepts a key and refuses everything shaped like a way out', () => {
  const key = `${newBoardId()}/${newBoardId()}`;

  it('a real key matches', () => {
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('both parts are board ids, so a key is made of things the board issues', () => {
    const [boardPart, assetPart] = key.split('/');
    expect(BOARD_ID_PATTERN.test(boardPart!)).toBe(true);
    expect(BOARD_ID_PATTERN.test(assetPart!)).toBe(true);
  });

  it('a missing part does not match', () => {
    const [boardPart] = key.split('/');
    expect(ASSET_KEY_PATTERN.test(boardPart!)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardPart}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/abc`)).toBe(false);
  });

  it("'../' does not match", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../../etc/passwd')).toBe(false);
    const [boardPart] = key.split('/');
    expect(ASSET_KEY_PATTERN.test(`${boardPart}/../${boardPart}`)).toBe(false);
  });

  it('an id of the wrong length does not match, in either part', () => {
    expect(ASSET_KEY_PATTERN.test(`${key}x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`x${key}`)).toBe(false);
    const [boardPart, assetPart] = key.split('/');
    expect(ASSET_KEY_PATTERN.test(`${boardPart!.slice(1)}/${assetPart}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardPart}/${assetPart!.slice(1)}`)).toBe(false);
  });

  it('a third part does not match, however it is spelled', () => {
    expect(ASSET_KEY_PATTERN.test(`${key}/extra`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${key}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${key}%2f`)).toBe(false);
  });

  it('the empty string, and anything without a slash, are not keys', () => {
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abcdef')).toBe(false);
  });
});

describe('keys and addresses', () => {
  it('assetKeyFor puts the board first, and the result matches the pattern', () => {
    const boardId = newBoardId();
    const made = assetKeyFor(boardId, newBoardId());
    expect(made.startsWith(`${boardId}/`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(made)).toBe(true);
  });

  it('boardIdOfKey says whose bytes a key is, and nothing for a thing which is not one', () => {
    const boardId = newBoardId();
    const made = assetKeyFor(boardId, newBoardId());
    expect(boardIdOfKey(made)).toBe(boardId);
    expect(boardIdOfKey('../x')).toBeNull();
    expect(boardIdOfKey('')).toBeNull();
  });

  it('boardAssetsPath is the upload address of a board', () => {
    const boardId = newBoardId();
    expect(boardAssetsPath(boardId)).toBe(`/api/boards/${boardId}/assets`);
  });

  it('assetPath is the read address of a key, with its separator left alone', () => {
    const boardId = newBoardId();
    const made = assetKeyFor(boardId, newBoardId());
    expect(assetPath(made)).toBe(`/api/assets/${made}`);
  });
});
