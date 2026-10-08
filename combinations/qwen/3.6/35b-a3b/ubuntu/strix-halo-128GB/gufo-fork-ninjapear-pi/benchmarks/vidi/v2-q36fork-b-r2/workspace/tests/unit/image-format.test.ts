import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor, AcceptedImageType } from '../../src/shared/image-format';
import { generatePng, generateJpeg, generateGif87a, generateGif89a, generateWebp, generateSvgWithScript, generatePdf, generateRandomBytes } from '../fixtures/images/generate';

describe('sniffImageType (TC-01)', () => {
  it('detects PNG', () => {
    const data = generatePng();
    expect(sniffImageType(data)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const data = generateJpeg();
    expect(sniffImageType(data)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const data = generateGif87a();
    expect(sniffImageType(data)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const data = generateGif89a();
    expect(sniffImageType(data)).toBe('image/gif');
  });

  it('detects WebP', () => {
    const data = generateWebp();
    expect(sniffImageType(data)).toBe('image/webp');
  });

  it('rejects SVG text', () => {
    const data = generateSvgWithScript();
    expect(sniffImageType(data)).toBeNull();
  });

  it('rejects PDF', () => {
    const data = generatePdf();
    expect(sniffImageType(data)).toBeNull();
  });

  it('rejects random bytes', () => {
    const data = generateRandomBytes(3);
    expect(sniffImageType(data)).toBeNull();
  });

  it('returns null for too-short input', () => {
    expect(sniffImageType(new Uint8Array([0x89]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches valid key: 22-char / 22-char base64url', () => {
    const validId1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'.slice(0, 22);
    const validId2 = 'ghijklmnopqrstuvwxyz012345'.slice(0, 22);
    expect(ASSET_KEY_PATTERN.test(`${validId1}/${validId2}`)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abc')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abc/def')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('/def')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('abc/')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('a../b..')).toBe(false);
  });

  it('rejects 23-char id segments', () => {
    const id23 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg'.slice(0, 23);
    expect(ASSET_KEY_PATTERN.test(`${id23}/` + 'A'.repeat(22))).toBe(false);
  });

  it('accepts base64url characters (-_ and alphanumeric)', () => {
    expect(ASSET_KEY_PATTERN.test('abc_def/ghi-jkl')).toBe(false); // wrong length but chars ok
    const pad22 = (s: string) => s.slice(0, 22);
    const part1 = pad22('abcdefghijklmnopqrstuvwx');
    const part2 = pad22('ABCDEFGHIJKLMNOPQRSTUV-_01');
    expect(ASSET_KEY_PATTERN.test(`${part1}/${part2}`)).toBe(true);
  });
});

describe('assetKeyFor', () => {
  it('joins boardId and assetId with slash', () => {
    expect(assetKeyFor('board123', 'asset456')).toBe('board123/asset456');
  });
});
