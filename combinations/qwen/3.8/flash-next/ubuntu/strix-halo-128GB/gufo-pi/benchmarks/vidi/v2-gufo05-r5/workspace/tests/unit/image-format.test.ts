/**
 * Asset format unit tests (TC-01, TC-02).
 *
 * Two pure decisions belong to `shared/image-format`: what a file *is* (from its bytes, never its
 * name) and what a stored image's address looks like. Both are security-relevant - an SVG can carry
 * a script, and a key that is not matched as a whole string could reach outside a board - so they
 * are tested here as functions before the Worker routes are asked to enforce them.
 */
import { describe, expect, test } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';

/** Bytes from a hex-ish list, so a signature in these tests reads like the signature. */
function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** The leading bytes of a real fixture file, as a plain array. */
function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

describe('image.types: sniffImageType reads a file’s magic bytes', () => {
  test('TC-01 a PNG opens with 89 50 4E 47', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });

  test('TC-01 a JPEG opens with FF D8 FF', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
  });

  test('TC-01 GIF87a and GIF89a are both the GIF format', () => {
    expect(sniffImageType(Uint8Array.from([...ascii('GIF87a'), 0x01, 0x00]))).toBe('image/gif');
    expect(sniffImageType(Uint8Array.from([...ascii('GIF89a'), 0x02, 0x00]))).toBe('image/gif');
  });

  test('TC-01 a WebP is RIFF, four size bytes, then WEBP', () => {
    const head = Uint8Array.from([...ascii('RIFF'), 0x2c, 0x01, 0x00, 0x00, ...ascii('WEBP'), 0x56, 0x50]);
    expect(head.length).toBe(IMAGE_SNIFF_BYTES + 2);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  test('TC-01 negative: SVG text is refused even though browsers call it an image', () => {
    const svg = Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(sniffImageType(svg)).toBeNull();
    // and the same file with an XML declaration, which is how export tools write it
    expect(sniffImageType(Uint8Array.from(ascii('<?xml version="1.0"?><svg')))).toBeNull();
  });

  test('TC-01 negative: a PDF renamed .png is still a PDF', () => {
    const pdf = Uint8Array.from(ascii('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj'));
    expect(sniffImageType(pdf)).toBeNull();
  });

  test('TC-01 negative: three random bytes decide nothing', () => {
    expect(sniffImageType(bytes(0x00, 0x01, 0x02))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull(); // a PNG signature cut short
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // a RIFF container that is not a WebP (a WAV) is not an image
    expect(sniffImageType(Uint8Array.from([...ascii('RIFF'), 0x04, 0x00, 0x00, 0x00, ...ascii('WAVE')]))).toBeNull();
  });
});

describe('assets.api: an asset key is two board-style addresses and nothing else', () => {
  const id = 'AbC-_0123456789abcdefg'; // 22 characters of base64url
  const other = 'zzz_zzzzzzzzzzzzzzzzzz';

  test('TC-02 a valid key matches', () => {
    expect(id).toHaveLength(22);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(id, other))).toBe(true);
  });

  test('TC-02 negative: a key missing either half does not match', () => {
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${other}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  test('TC-02 negative: path traversal does not match', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/../../secrets`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/${other}/extra`)).toBe(false);
  });

  test('TC-02 negative: an id of the wrong length, or outside the alphabet, does not match', () => {
    expect(ASSET_KEY_PATTERN.test(`${id}x/${other}`)).toBe(false); // 23 characters
    expect(ASSET_KEY_PATTERN.test(`${id.slice(0, 21)}/${other}`)).toBe(false); // 21
    expect(ASSET_KEY_PATTERN.test(`${id.replace(/-/, '+')}/${other}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/${other}!`)).toBe(false);
  });
});
