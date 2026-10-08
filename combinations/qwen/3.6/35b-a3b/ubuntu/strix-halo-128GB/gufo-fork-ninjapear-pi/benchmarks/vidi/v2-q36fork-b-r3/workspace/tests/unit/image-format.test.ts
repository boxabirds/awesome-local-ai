/** TC-01, TC-02 — image format sniffing and asset key validation */

import { describe, it, expect } from 'vitest';
import {
  sniffImageType,
  ASSET_KEY_PATTERN,
  assetKeyFor,
} from '@shared/image-format';
import fs from 'fs';
import path from 'path';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/images');

describe('TC-01: sniffImageType magic bytes', () => {
  it('recognises PNG', () => {
    const data = fs.readFileSync(path.join(FIXTURES, 'screenshot.png'));
    expect(sniffImageType(new Uint8Array(data))).toBe('image/png');
  });

  it('recognises JPEG (FF D8 FF)', () => {
    const data = fs.readFileSync(path.join(FIXTURES, 'photo.jpg'));
    expect(sniffImageType(new Uint8Array(data))).toBe('image/jpeg');
  });

  it('recognises GIF89a', () => {
    const data = fs.readFileSync(path.join(FIXTURES, 'animated.gif'));
    expect(sniffImageType(new Uint8Array(data))).toBe('image/gif');
  });

  it('recognises WebP (RIFF....WEBP)', () => {
    const data = fs.readFileSync(path.join(FIXTURES, 'image.webp'));
    expect(sniffImageType(new Uint8Array(data))).toBe('image/webp');
  });

  it('rejects SVG text content as null', () => {
    const svg = Buffer.from('<svg><script>alert(1)</script></svg>');
    expect(sniffImageType(new Uint8Array(svg))).toBeNull();
  });

  it('rejects PDF content as null', () => {
    const pdf = Buffer.from('%PDF-1.4 fake content');
    expect(sniffImageType(new Uint8Array(pdf))).toBeNull();
  });

  it('rejects random bytes as null', () => {
    const rand = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(rand)).toBeNull();
  });

  it('rejects too-short input', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89]))).toBeNull();
  });

  it('rejects PNG-like but invalid signature', () => {
    // Wrong trailing bytes after 89 50 4E 47
    const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageType(bad)).toBeNull();
  });

  it('recognises GIF87a', () => {
    const gif87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x08, 0x00, 0x08, 0x00, 0xf0, 0x00]);
    expect(sniffImageType(gif87)).toBe('image/gif');
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22> keys', () => {
    expect(ASSET_KEY_PATTERN.test('abcDEFghijklmnopqrstuv/ABCDEFghijklmnopqrstuv')).toBe(true);
  });

  it('assetKeyFor produces a valid pattern match', () => {
    const boardId = new Array(22).fill('A').join('');
    const assetId = new Array(22).fill('B').join('');
    const key = assetKeyFor(boardId, assetId);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcDEFghijklmnopqrstuv')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../evil/png')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('foo/../bar')).toBe(false);
  });

  it('rejects 23-char id segment', () => {
    expect(ASSET_KEY_PATTERN.test('ABCDEFGHIJKLMNOPQRSTUVWXYZ/ABCDEFGHIJKLMNOPQRSTU')).toBe(false);
  });

  it('rejects with special characters outside base64url', () => {
    expect(ASSET_KEY_PATTERN.test('abc_def./ghi_jkl')).toBe(false);
  });
});
