import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { GIF87, GIF89, JPEG_HEAD, PDF_BYTES, PNG_HEAD, SVG_BYTES, WEBP_HEAD, bytesOf } from '../fixtures/images';

describe('image format', () => {
  it('TC-01: sniffs by magic bytes and refuses everything else', () => {
    expect(sniffImageType(bytesOf(PNG_HEAD, 12))).toBe('image/png');
    expect(sniffImageType(bytesOf(JPEG_HEAD, 12))).toBe('image/jpeg');
    expect(sniffImageType(bytesOf(GIF87, 12))).toBe('image/gif');
    expect(sniffImageType(bytesOf(GIF89, 12))).toBe('image/gif');
    expect(sniffImageType(bytesOf(WEBP_HEAD, 12))).toBe('image/webp');
    expect(sniffImageType(SVG_BYTES.slice(0, 12))).toBeNull();
    expect(sniffImageType(PDF_BYTES.slice(0, 12))).toBeNull();
    expect(sniffImageType(Uint8Array.of(1, 2, 3))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('TC-02: asset key pattern', () => {
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(newBoardId())).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(22)}/../${'b'.repeat(22)}`)).toBe(false);
  });
});
