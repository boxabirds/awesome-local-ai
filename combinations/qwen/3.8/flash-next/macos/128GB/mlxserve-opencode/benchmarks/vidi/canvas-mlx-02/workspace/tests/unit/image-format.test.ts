// The byte signature that decides which images the board accepts (TC-01 to TC-04).
// The whole security shape of images rests on this: the type is decided from the
// CONTENT, never the label, so a file renamed `.png` that is really a script is
// refused, and the accepted set is exactly PNG, JPEG, GIF and WebP - not "anything a
// browser calls an image".
//
// These fixtures are real magic bytes, built here as bytes rather than pasted as
// base64, so the test proves the same thing the server's guard is really keyed on:
// the first bytes of the file.
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, isAssetKey, sniffImageType } from '../../src/shared/image-format.ts';

/** The first `n` bytes of a buffer as the plain number array `sniffImageType` reads. */
function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const JPEG_EXIF = bytes(0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0); // EXIF, still JPEG
const GIF87 = bytes(...'GIF87a'.split('').map((c) => c.charCodeAt(0)), 1, 0, 1, 0, 0);
const GIF89 = bytes(...'GIF89a'.split('').map((c) => c.charCodeAt(0)), 1, 0, 1, 0, 0);
const WEBP = bytes(
  ...'RIFF'.split('').map((c) => c.charCodeAt(0)),
  40,
  0,
  0,
  0,
  ...'WEBP'.split('').map((c) => c.charCodeAt(0)),
  0,
);

describe('sniffImageType (TC-01 to TC-04)', () => {
  it('names the four accepted formats by their content (TC-01)', () => {
    // A file extension is a claim; these bytes are the proof.
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF87)).toBe('image/gif');
    expect(sniffImageType(GIF89)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('reads a JPEG by its SOI marker regardless of the following segment', () => {
    // JFIF, EXIF and a bare thumbnail all start FF D8 FF; the type is JPEG either way.
    expect(sniffImageType(JPEG_EXIF)).toBe('image/jpeg');
  });

  it('rejects an SVG made of nothing but text and tags (TC-02)', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('rejects a file that claims to be a PNG but carries other bytes (TC-03)', () => {
    // "photo.png" in name, an ELF executable in fact. The name is not consulted.
    const disguised = bytes(0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, 0, 0, 0, 0, 0);
    expect(sniffImageType(disguised)).toBeNull();
    // A PDF, plain text, and a file too short to hold a signature, likewise.
    expect(sniffImageType(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('hello, this is a note'))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    // Even an empty file is a refusal, not a crash.
    expect(sniffImageType(bytes())).toBeNull();
  });

  it('reads only the prefix it needs and ignores the tail (TC-04)', () => {
    // A PNG signature followed by 11 bytes of anything is still a PNG.
    const pngWithTail = Uint8Array.from([...PNG, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(sniffImageType(pngWithTail.slice(0, 12))).toBe('image/png');
    // A signature that is only ALMOST right on the twelfth byte (WebP without the
    // VP8 marker) is not a webp; the check is byte-exact.
    const almostWebp = bytes(...'RIFF'.split('').map((c) => c.charCodeAt(0)), 40, 0, 0, 0, ...'XXXX'.split('').map((c) => c.charCodeAt(0)), 0);
    expect(sniffImageType(almostWebp.slice(0, 12))).toBeNull();
  });
});

describe('asset keys (TC-01 to TC-04 serve side)', () => {
  it('builds a key from a board id and asset id under the accepted pattern', () => {
    const key = assetKeyFor('abcdefghij0123456789AB', 'ABCDEFGHIJ0123456789_-');
    expect(key).toBe('abcdefghij0123456789AB/ABCDEFGHIJ0123456789_-');
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('refuses keys that are malformed, traverse or have the wrong length', () => {
    const good = 'abcdefghij0123456789AB';
    expect(isAssetKey(`${good}/${good}`)).toBe(true);
    // a traversal probe
    expect(isAssetKey('../../etc/passwd')).toBe(false);
    expect(isAssetKey(`${good}/../${good}`)).toBe(false);
    // a missing half
    expect(isAssetKey(good)).toBe(false);
    expect(isAssetKey(`${good}/`)).toBe(false);
    expect(isAssetKey(`/${good}`)).toBe(false);
    // too short or too long a component
    expect(isAssetKey(`${good.slice(0, 21)}/${good}`)).toBe(false);
    expect(isAssetKey(`${good}x/${good}`)).toBe(false);
    // a character outside the unguessable-id alphabet
    expect(isAssetKey(`bad.id/${good}`)).toBe(false);
    expect(isAssetKey(`${good}/${good}.svg`)).toBe(false);
  });
});
