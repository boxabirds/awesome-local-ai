// assets.api pure parts (TC-01, TC-02): magic-byte sniffing and asset keys.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url)));
const ascii = (s: string) => new TextEncoder().encode(s);

describe('assets.api sniffImageType', () => {
  it('TC-01 accepted types by content; SVG, renamed PDF and short input are refused', () => {
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(ascii('GIF87a\x01\x00\x01\x00\x00\x00'))).toBe('image/gif');
    expect(sniffImageType(fixture('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(fixture('image.webp'))).toBe('image/webp');
    // Negative: text formats and disguised files.
    expect(sniffImageType(fixture('script.svg'))).toBeNull();
    expect(sniffImageType(fixture('document-renamed.png'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    // RIFF but not WebP (e.g. a WAV file).
    expect(sniffImageType(ascii('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
  });
});

describe('assets.api ASSET_KEY_PATTERN', () => {
  it('TC-02 valid <22>/<22> only', () => {
    const board = newBoardId();
    const asset = newBoardId();
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(board)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../${asset}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/../x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/${asset}A`)).toBe(false);
  });
});
