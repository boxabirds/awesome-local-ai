import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../../src/shared/config';
import {
  ACCEPTED_CONTENT_TYPES,
  ASSET_KEY_PATTERN,
  assetKeyFor,
  assetKeyOfPath,
  cacheControlForAsset,
  contentTypeOf,
  isAcceptedImageType,
  sniffImageType,
} from '../../src/shared/image-format';

/**
 * Unit tests for the asset format rules (anchor `assets.api`).
 *
 * TC-01 types by sniffing, TC-02 asset keys. Everything here is pure: real
 * fixture bytes in, a decision out. The fixtures are real files written by
 * `npm run fixtures:image` - a genuine PNG, JPEG, WebP, animated GIF, an SVG with
 * a script (refused: no vector formats, they can carry scripts), a PDF renamed
 * `.png` and a PNG cut in half.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/images/', import.meta.url));

const fixture = (name: string): Buffer => readFileSync(`${FIXTURES}${name}`);

/** The bytes a sniffer is handed: the front of the file, at most `length` of them. */
const headOf = (bytes: Uint8Array, length = IMAGE_SNIFF_BYTES): Uint8Array =>
  new Uint8Array(bytes.subarray(0, Math.min(bytes.length, length)));

/** A board address of the shape `src/shared/board-id.ts` actually issues. */
const BOARD = 'brd1AAAAAAAAAAAAAAAAAA';
const ASSET = 'asset1234567890abcdefghij';

describe('assets.api - types come from sniffing (TC-01)', () => {
  // TC-01
  it('TC-01 sniffs the four accepted formats from real fixture bytes', () => {
    expect(sniffImageType(headOf(fixture('photo.png')))).toBe('png');
    expect(sniffImageType(headOf(fixture('photo-large.jpg')))).toBe('jpeg');
    expect(sniffImageType(headOf(fixture('animated.gif')))).toBe('gif');
    expect(sniffImageType(headOf(fixture('photo.webp')))).toBe('webp');
  });

  // TC-01: SVG is refused outright (`image.types`, PRD security) - a vector file
  // is a document, and this board serves stored bytes inline.
  it('TC-01 an SVG is refused even though it is text a sniffer could read', () => {
    expect(sniffImageType(headOf(fixture('drawing.svg'), 256))).toBeNull();
    const svg = (body: string) =>
      headOf(new TextEncoder().encode(`${body}<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`), 256);
    expect(sniffImageType(svg(''))).toBeNull();
    expect(sniffImageType(svg('<?xml version="1.0"?>'))).toBeNull();
    expect(sniffImageType(svg('<!-- how nice --><svg'))).toBeNull();
    expect(sniffImageType(headOf(new TextEncoder().encode('<svgfoo></svgfoo>'), 256))).toBeNull();
    // ...and nothing maps it to a content type either.
    expect(contentTypeOf('svg')).toBeNull();
    expect(isAcceptedImageType('svg')).toBe(false);
  });

  // TC-01: what the client claimed about the file is not what the bytes say.
  it('TC-01 a PDF named .png is rejected whatever its name or claimed type', () => {
    expect(sniffImageType(headOf(fixture('not-an-image.png')))).toBeNull();
  });

  // TC-01 boundary: a real PNG cut in half is still a real PNG up front.
  it('TC-01 a truncated PNG still sniffs as a PNG from its header', () => {
    expect(sniffImageType(headOf(fixture('truncated.png')))).toBe('png');
  });

  // TC-01 boundary: shorter than the sniff window is not enough to decide.
  it('TC-01 the sniff window is the longest magic number of the accepted set', () => {
    expect(IMAGE_SNIFF_BYTES).toBe(12);
    expect(sniffImageType(headOf(fixture('photo.webp')))).toBe('webp');
  });

  it('TC-01 fewer bytes than IMAGE_SNIFF_BYTES answer null instead of guessing', () => {
    const png = fixture('photo.png');
    for (let length = 0; length < IMAGE_SNIFF_BYTES; length += 1) {
      expect(sniffImageType(headOf(png, length))).toBeNull();
    }
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('TC-01 every accepted format maps to one MIME type, and a served asset is immutable', () => {
    expect(ACCEPTED_CONTENT_TYPES).toEqual({
      png: 'image/png',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    });
    // The sniff's formats and the picker's `accept` list are the same set.
    expect(Object.values(ACCEPTED_CONTENT_TYPES).sort()).toEqual([...IMAGE_ACCEPTED_TYPES].sort());
    expect(contentTypeOf('png')).toBe('image/png');
    expect(contentTypeOf('svg')).toBeNull();
    expect(contentTypeOf('nope')).toBeNull();
    expect(isAcceptedImageType('webp')).toBe(true);
    expect(cacheControlForAsset()).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(ASSET_CACHE_MAX_AGE_SECONDS).toBe(31_536_000);
  });
});

describe('assets.api - asset keys (TC-02)', () => {
  // TC-02
  it('TC-02 assetKeyFor is <boardId>/<assetId> with a random 22-character asset half', () => {
    const key = assetKeyFor(BOARD, ASSET);
    expect(key).toBe(`${BOARD}/${ASSET}`);
    const generated = assetKeyFor(BOARD);
    if (!generated) {
      throw new Error('a valid board id must produce a key');
    }
    expect(generated.startsWith(`${BOARD}/`)).toBe(true);
    expect(generated.split('/')[1]).toHaveLength(22);
    expect(ASSET_KEY_PATTERN.test(generated)).toBe(true);
  });

  // TC-02: the same random half twice is treated as corrupt storage.
  it('TC-02 keys are random per call, so two calls never produce the same key', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const key = assetKeyFor(BOARD);
      if (!key) {
        throw new Error('a valid board id must produce a key');
      }
      keys.add(key);
    }
    expect(keys.size).toBe(200);
  });

  // TC-02
  it('TC-02 the key pattern accepts only the two-segment shape at the right lengths', () => {
    const asset = 'a'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/${asset}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(`brd1AAAAAAAAAAAAAAAAAB/${asset}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/short`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/..`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/..%2f..`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/a/b`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${BOARD}/a`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('/a')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/${'a'.repeat(65)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('a'.repeat(100))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/${asset}\n`)).toBe(false);
  });

  // TC-02: a malformed id never becomes a key at all.
  it('TC-02 malformed ids and keys are rejected', () => {
    expect(assetKeyFor('brd')).toBeNull(); // board ids are 22 base64url characters
    expect(assetKeyFor('')).toBeNull();
    expect(assetKeyFor('brd!')).toBeNull();
    expect(assetKeyFor('has space')).toBeNull();
    expect(assetKeyFor('a'.repeat(65))).toBeNull();
    expect(assetKeyFor(`${BOARD}/extra`)).toBeNull();
    expect(assetKeyFor(BOARD, 'short')).toBeNull();
    expect(assetKeyFor(BOARD, '')).toBeNull();
    expect(assetKeyFor(BOARD, 'a'.repeat(65))).toBeNull();
    expect(assetKeyFor(BOARD, 'has space')).toBeNull();
    expect(assetKeyFor(BOARD, '..')).toBeNull();
  });

  it('TC-02 a request path yields its key only when the key itself is well-formed', () => {
    const asset = 'a'.repeat(22);
    expect(assetKeyOfPath(`/api/assets/${BOARD}/${asset}`)).toBe(`${BOARD}/${asset}`);
    expect(assetKeyOfPath(`${BOARD}/${asset}`)).toBe(`${BOARD}/${asset}`);
    expect(assetKeyOfPath(`/api/assets/${BOARD}/short`)).toBeNull();
    expect(assetKeyOfPath(`/api/assets/${BOARD}`)).toBeNull();
    expect(assetKeyOfPath('/api/assets/')).toBeNull();
    expect(assetKeyOfPath('/api/boards/brd/assets')).toBeNull();
  });

  it('TC-02 the size limit is the named setting, in bytes', () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
