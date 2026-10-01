import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { imageBytes } from '../fixtures/images';

const text = (s: string) => new TextEncoder().encode(s);

describe('sniffImageType', () => {
  it('TC-01 recognises PNG, JPEG, GIF87a, GIF89a and WebP by content', () => {
    expect(sniffImageType(imageBytes('small.png').slice(0, 12))).toBe('image/png');
    expect(sniffImageType(imageBytes('photo.jpg').slice(0, 12))).toBe('image/jpeg');
    expect(sniffImageType(text('GIF87a......'))).toBe('image/gif');
    expect(sniffImageType(imageBytes('animated.gif').slice(0, 12))).toBe('image/gif');
    expect(sniffImageType(imageBytes('small.webp').slice(0, 12))).toBe('image/webp');
  });

  it('TC-01 refuses SVG text, a PDF renamed .png and three random bytes', () => {
    expect(sniffImageType(imageBytes('script.svg').slice(0, 12))).toBeNull();
    expect(sniffImageType(imageBytes('not-an-image.png').slice(0, 12))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(text('RIFF....WAVE'))).toBeNull();
  });
});

describe('asset keys', () => {
  it('TC-02 ASSET_KEY_PATTERN accepts <22>/<22> only', () => {
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(newBoardId())).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
  });
});
