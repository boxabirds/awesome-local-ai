// Story 12 — assets.api pure parts: TC-01 (sniffImageType), TC-02 (ASSET_KEY_PATTERN, assetKeyFor).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { GIF87A_HEAD, GIF89A_HEAD, JPEG_8x6, PNG_300x200, SVG_WITH_SCRIPT, WEBP_HEAD } from '../fixtures/images/bytes';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url)));

describe('sniffImageType (TC-01)', () => {
  it.each([
    ['PNG', PNG_300x200, 'image/png'],
    ['PNG screenshot fixture', fixture('screenshot.png'), 'image/png'],
    ['JPEG', JPEG_8x6, 'image/jpeg'],
    ['JPEG photo fixture', fixture('photo.jpg'), 'image/jpeg'],
    ['GIF87a', GIF87A_HEAD, 'image/gif'],
    ['GIF89a', GIF89A_HEAD, 'image/gif'],
    ['animated GIF fixture', fixture('animated.gif'), 'image/gif'],
    ['WebP', WEBP_HEAD, 'image/webp'],
    ['WebP fixture', fixture('image.webp'), 'image/webp'],
  ])('%s → accepted type', (_name, bytes, expected) => {
    expect(sniffImageType(bytes)).toBe(expected);
  });

  it.each([
    ['SVG text', SVG_WITH_SCRIPT],
    ['SVG fixture', fixture('script.svg')],
    ['PDF renamed .png', fixture('document-renamed.png')],
    ['3 random bytes', Uint8Array.from([0x12, 0xab, 0x7f])],
    ['empty', new Uint8Array(0)],
    ['RIFF that is not WebP', Uint8Array.from([...'RIFF\0\0\0\0WAVE'].map((c) => c.charCodeAt(0)))],
  ])('%s → null', (_name, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  const board = newBoardId();
  const asset = newBoardId();

  it('accepts <22>/<22> keys built by assetKeyFor', () => {
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
  });

  it.each([
    ['missing part', `${board}/`],
    ['only one id', board],
    ['../', `../${asset}`],
    ['.. in a valid-length id', `${board}/../${asset.slice(3)}`],
    ['23-char id', `${board}/${asset}x`],
    ['extra segment', `${board}/${asset}/x`],
  ])('rejects %s', (_name, key) => {
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});
