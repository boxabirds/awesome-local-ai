/**
 * Unit tests for image magic-byte sniffing and asset keys (story 12,
 * assets.api). TC-01, TC-02.
 */
import { describe, it, expect } from 'vitest';
import {
  sniffImageType,
  ASSET_KEY_PATTERN,
  assetKeyFor,
} from '../../src/shared/image-format';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';

/** Build a Uint8Array from a hex string (no spaces). */
function hex(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** ASCII to bytes. */
function asc(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** Concatenate byte arrays into one. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('assets.api: sniffImageType (TC-01)', () => {
  it('TC-01: PNG, JPEG, GIF87a, GIF89a, WebP → accepted types', () => {
    // PNG signature
    expect(sniffImageType(hex('89504e470d0a1a0a0000000d'))).toBe('image/png');
    // JPEG
    expect(sniffImageType(hex('ffd8ffe000104a464946'))).toBe('image/jpeg');
    // GIF87a
    expect(sniffImageType(asc('GIF87a' + '????'))).toBe('image/gif');
    // GIF89a
    expect(sniffImageType(asc('GIF89a' + '????'))).toBe('image/gif');
    // WebP: RIFF + 4 size bytes + WEBP
    expect(sniffImageType(concat(asc('RIFF'), asc('????'), asc('WEBP'), asc('??')))).toBe('image/webp');
  });

  it('TC-01 (negative): SVG text, renamed PDF, 3 random bytes → null', () => {
    // SVG (text)
    expect(sniffImageType(asc('<svg xmlns="http'))).toBeNull();
    // PDF magic (renamed .png)
    expect(sniffImageType(asc('%PDF-1.7'))).toBeNull();
    // 3 random bytes
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
    // Empty
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe('assets.api: ASSET_KEY_PATTERN (TC-02)', () => {
  it('TC-02: valid <22>/<22> → true', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(true);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${assetId}`)).toBe(true);
  });

  it('TC-02 (negative): missing part, ../, 23-char id → false', () => {
    const boardId = 'a'.repeat(22);
    // missing part
    expect(ASSET_KEY_PATTERN.test(boardId)).toBe(false);
    // traversal
    expect(ASSET_KEY_PATTERN.test(`${boardId}/../${'b'.repeat(22)}`)).toBe(false);
    // 23-char id
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/${'b'.repeat(23)}`)).toBe(false);
  });

  it('assetKeyFor joins boardId and assetId with a slash', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'b'.repeat(22);
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
    // Both parts are valid board ids (128-bit, 22 base64url chars).
    expect(BOARD_ID_PATTERN.test(boardId)).toBe(true);
  });
});
