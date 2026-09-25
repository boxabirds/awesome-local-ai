import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IMAGE_SNIFF_BYTES, IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`));
const ascii = (s: string) => new TextEncoder().encode(s);

describe('assets.api: sniffImageType', () => {
  it('TC-01 recognises PNG, JPEG, GIF87a, GIF89a and WebP by content; refuses SVG, a renamed PDF and 3 random bytes', () => {
    expect(sniffImageType(fixture('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixture('photo.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(ascii('GIF87a\x01\x00\x01\x00\x00\x00'))).toBe('image/gif');
    expect(sniffImageType(fixture('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(fixture('picture.webp'))).toBe('image/webp');
    expect(sniffImageType(fixture('script.svg'))).toBeNull();
    expect(sniffImageType(fixture('document-renamed.png'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x12, 0x9a, 0x44]))).toBeNull();
  });

  it('decides from the first IMAGE_SNIFF_BYTES only (a RIFF file that is not WebP is refused)', () => {
    expect(sniffImageType(fixture('picture.webp').subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/webp');
    expect(sniffImageType(ascii('RIFF\x00\x00\x00\x00WAVEfmt '))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('assets.api: asset keys', () => {
  it('TC-02 ASSET_KEY_PATTERN accepts <22>/<22> only', () => {
    const board = newBoardId();
    const asset = newBoardId();
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
    expect(ASSET_KEY_PATTERN.test(board)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/../${asset}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../${asset}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/${asset}x`)).toBe(false);
  });

  it('the wrangler upload rate limiter matches the named settings', () => {
    const src = readFileSync('wrangler.jsonc', 'utf8');
    const m = /"name":\s*"ASSET_UPLOAD_LIMITER"[^}]*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(IMAGE_UPLOAD_LIMIT);
    expect(Number(m![2])).toBe(IMAGE_UPLOAD_PERIOD_SECONDS);
  });
});
