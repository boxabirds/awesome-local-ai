/** Story 12 assets.api unit tests (TC-01, TC-02): content sniffing and asset keys. */
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { GIF87_HEAD, GIF_8x8, JPEG_64x48, PDF_RENAMED, PNG_400x300, SVG_WITH_SCRIPT, WEBP_640x480 } from '../fixtures/image-bytes';

const head = (bytes: Uint8Array) => bytes.subarray(0, IMAGE_SNIFF_BYTES);

describe('assets.api pure parts', () => {
  it('named settings', () => {
    expect(IMAGE_ACCEPTED_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
    expect(IMAGE_MAX_PLACE_SIZE_WORLD).toBe(800);
    expect(IMAGE_MIN_SIZE_WORLD).toBe(16);
    expect(IMAGE_LAYOUT_GAP_WORLD).toBe(24);
    expect(IMAGE_UPLOAD_STALE_MS).toBe(5 * 60 * 1000);
    expect(IMAGE_UPLOAD_LIMIT).toBe(60);
    expect(IMAGE_UPLOAD_PERIOD_SECONDS).toBe(60);
    expect(ASSET_CACHE_MAX_AGE_SECONDS).toBe(31_536_000);
    expect(IMAGE_SNIFF_BYTES).toBe(12);
  });

  it('TC-01 sniffImageType recognises PNG, JPEG, GIF87a, GIF89a and WebP by content', () => {
    expect(sniffImageType(head(PNG_400x300))).toBe('image/png');
    expect(sniffImageType(head(JPEG_64x48))).toBe('image/jpeg');
    expect(sniffImageType(head(GIF87_HEAD))).toBe('image/gif');
    expect(sniffImageType(head(GIF_8x8))).toBe('image/gif');
    expect(new TextDecoder().decode(GIF_8x8.subarray(0, 6))).toBe('GIF89a');
    expect(sniffImageType(head(WEBP_640x480))).toBe('image/webp');
  });

  it('TC-01 SVG text, a PDF renamed .png and 3 random bytes are not images (negative)', () => {
    expect(sniffImageType(head(SVG_WITH_SCRIPT))).toBeNull();
    expect(sniffImageType(head(PDF_RENAMED))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x12, 0x9a, 0x3c]))).toBeNull();
    // Truncated magic numbers are not enough.
    expect(sniffImageType(PNG_400x300.subarray(0, 3))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it('TC-02 ASSET_KEY_PATTERN accepts <22>/<22> only', () => {
    const board = newBoardId();
    const asset = newBoardId();
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(board, asset))).toBe(true);
    expect(assetKeyFor(board, asset)).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(board)).toBe(false); // missing part
    expect(ASSET_KEY_PATTERN.test(`${board}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../${asset}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/../${asset.slice(3)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/${asset}x`)).toBe(false); // 23-char id
    expect(ASSET_KEY_PATTERN.test(`${board}/${asset}/x`)).toBe(false);
  });
});
