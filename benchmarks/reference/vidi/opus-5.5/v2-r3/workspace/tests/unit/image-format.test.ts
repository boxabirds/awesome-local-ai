// Story 12 — assets.api pure parts: magic-byte sniffing and asset keys (TC-01, TC-02).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { ANIMATED_GIF, GIF87A_HEAD, PDF_BYTES, SCRIPT_SVG, SMALL_JPEG, SMALL_PNG, SMALL_WEBP } from '../fixtures/image-bytes';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url)));

describe('sniffImageType (TC-01)', () => {
  it.each([
    ['PNG', SMALL_PNG, 'image/png'],
    ['JPEG', SMALL_JPEG, 'image/jpeg'],
    ['GIF87a', GIF87A_HEAD, 'image/gif'],
    ['GIF89a', ANIMATED_GIF, 'image/gif'],
    ['WebP', SMALL_WEBP, 'image/webp'],
  ])('%s → accepted type', (_name, bytes, type) => {
    expect(sniffImageType(bytes)).toBe(type);
    expect(sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES))).toBe(type);
  });

  it('real fixture files are recognised by content', () => {
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(fixture('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(fixture('sample.webp'))).toBe('image/webp');
  });

  it.each([
    ['SVG text', SCRIPT_SVG],
    ['PDF renamed .png', PDF_BYTES],
    ['PDF fixture renamed .png', fixture('document-renamed.png')],
    ['SVG fixture', fixture('script.svg')],
    ['3 random bytes', new Uint8Array([0x13, 0x37, 0x42])],
    ['empty', new Uint8Array(0)],
    ['RIFF without WEBP (e.g. WAV)', new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')],
  ])('%s → null', (_name, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  const board = newBoardId();
  const asset = newBoardId();

  it('valid <22>/<22> → true', () => {
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
  });

  it.each([
    ['missing part', `${board}/`],
    ['board only', board],
    ['../', `${board}/../${asset}`],
    ['../ in place of the board', `../${asset}`],
    ['23-char id', `${board}/${asset}x`],
    ['extra segment', `${board}/${asset}/x`],
  ])('%s → false', (_name, key) => {
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});
