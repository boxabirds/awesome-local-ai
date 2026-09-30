/**
 * Story 12: image format sniffing and asset key tests (TC-01, TC-02).
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@shared/image-format';
import { newBoardId } from '@shared/board-id';
import { fixtureBytes } from '../fixtures/images';

describe('TC-01: sniffImageType decides type from content', () => {
  it('PNG magic → image/png', () => {
    expect(sniffImageType(fixtureBytes('screenshot.png'))).toBe('image/png');
    expect(sniffImageType(fixtureBytes('small.png'))).toBe('image/png');
  });

  it('JPEG magic → image/jpeg', () => {
    expect(sniffImageType(fixtureBytes('photo.jpg'))).toBe('image/jpeg');
  });

  it('GIF87a magic → image/gif', () => {
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(gif87a)).toBe('image/gif');
  });

  it('GIF89a magic → image/gif', () => {
    expect(sniffImageType(fixtureBytes('animated.gif'))).toBe('image/gif');
  });

  it('RIFF....WEBP magic → image/webp', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(fixtureBytes('image.webp'))).toBe('image/webp');
  });

  it('SVG text → null (negative)', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(fixtureBytes('script.svg'))).toBeNull();
  });

  it('PDF renamed to .png → null (negative)', () => {
    expect(sniffImageType(fixtureBytes('fake.png'))).toBeNull();
  });

  it('3 random bytes → null (negative)', () => {
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('valid <22>/<22> → true', () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(assetKeyFor('a'.repeat(22), 'b'.repeat(22))).toBe('a'.repeat(22) + '/' + 'b'.repeat(22));
  });

  it('missing part → false', () => {
    expect(ASSET_KEY_PATTERN.test(newBoardId())).toBe(false);
  });

  it("'../' → false (negative)", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('23-char id → false (negative)', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(23) + '/' + 'a'.repeat(22))).toBe(false);
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22) + '/' + 'a'.repeat(23))).toBe(false);
  });
});
