/**
 * Story 12 — what a dropped file actually is (TC-01, TC-02).
 *
 * Two pure pieces of the server's side of images, both small enough to be tested without a server:
 *
 *   - `sniffImageType` reads the first few bytes of an upload and says which of the four image types it is,
 *     or says nothing at all. It is the reason a board cannot be served a PDF, an executable, or an SVG with
 *     a script in it under a `Content-Type` that promised otherwise: the answer comes from the bytes, and the
 *     bytes are the only thing the board has ever been able to trust. The client's validation is a courtesy
 *     to the person dropping the file; this is the rule.
 *   - `assetKeyFor`/`ASSET_KEY_PATTERN` are the shape of a storage key — `<22 char board id>/<22 char asset
 *     id>`, both from the same generator story 5 uses for board ids, which is what lets the serving route
 *     accept a key on sight: 128 bits of randomness per segment means a key that is not written down cannot
 *     be found, and a key with anything else in it — a `..`, a `%2F`, an empty segment, a segment one
 *     character short — is not a key and gets the same answer as one that was never uploaded.
 */
import { describe, expect, it } from 'vitest';

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';

/** The bytes a real file of each type starts with, taken from actual files. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF87A = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00]);
const GIF89A = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

describe('image format sniffing', () => {
  it.each([
    ['PNG', PNG],
    ['JPEG', JPEG],
    ['GIF87a', GIF87A],
    ['GIF89a', GIF89A],
    ['WebP', WEBP],
  ])('TC-01: sniffs a real %s from its magic bytes', (_name, bytes) => {
    expect(sniffImageType(new Uint8Array(bytes))).not.toBeNull();
    // …and the type it names is one of the four the board accepts, as a MIME type.
    expect(IMAGE_ACCEPTED_TYPES).toContain(sniffImageType(new Uint8Array(bytes)));
  });

  it('TC-01: names the type exactly, not just "some image"', () => {
    expect(sniffImageType(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImageType(new Uint8Array(JPEG))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array(GIF87A))).toBe('image/gif');
    expect(sniffImageType(new Uint8Array(GIF89A))).toBe('image/gif');
    expect(sniffImageType(new Uint8Array(WEBP))).toBe('image/webp');
  });

  it.each([
    ['a PDF', Buffer.from('%PDF-1.7\n%\xc7\xec\x8f\xa2\n', 'binary')],
    ['a ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
    ['an ELF executable', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])],
    ['a GIF that stops after GIF', Buffer.from([0x47, 0x49, 0x46])],
    ['a WebP with the wrong bytes where WEBP goes', Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x51])],
    ['a PNG whose first byte has been changed', Buffer.from([0x8a, ...PNG.subarray(1)])],
    ['three random bytes', Buffer.from([0x00, 0x11, 0x22])],
    ['no bytes at all', Buffer.alloc(0)],
    ['an SVG, which is a document and not a picture', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8')],
  ])('TC-01: says nothing about %s', (_name, bytes) => {
    expect(sniffImageType(new Uint8Array(bytes))).toBeNull();
  });

  it('TC-01: reads at most the first IMAGE_SNIFF_BYTES bytes', () => {
    // A JPEG that only becomes a JPEG further in is not a JPEG: the board stops looking after twelve bytes,
    // so an upload is decided by a header and never by whatever is deeper in the file.
    const buried = Buffer.concat([Buffer.alloc(IMAGE_SNIFF_BYTES, 0x00), JPEG]);
    expect(sniffImageType(new Uint8Array(buried))).toBeNull();

    // Twelve bytes is enough for every signature, including WebP's, which is split by a length field.
    const exactly = WEBP.subarray(0, IMAGE_SNIFF_BYTES);
    expect(exactly.length).toBe(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(new Uint8Array(exactly))).toBe('image/webp');
  });
});

describe('asset keys', () => {
  it('TC-02: accepts a key built from two ids the board issues', () => {
    const key = assetKeyFor('vKd3xQ2mZ8rT7wL1nB4sY6', 'qW9tR2yU5iO8pA3sD6fG01');
    expect(key).toBe('vKd3xQ2mZ8rT7wL1nB4sY6/qW9tR2yU5iO8pA3sD6fG01');
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each([
    ['one segment short', 'vKd3xQ2mZ8rT7wL1nB4sY6'],
    ['a traversal in the second segment', 'vKd3xQ2mZ8rT7wL1nB4sY6/../secret'],
    ['a traversal in the first segment', '../qW9tR2yU5iO8pA3sD6fG01'],
    ['an empty first segment', '/qW9tR2yU5iO8pA3sD6fG01'],
    ['an empty second segment', 'vKd3xQ2mZ8rT7wL1nB4sY6/'],
    ['no separator at all', 'vKd3xQ2mZ8rT7wL1nB4sY6qW9tR2yU5iO8pA3sD6fG01'],
    ['three segments', 'vKd3xQ2mZ8rT7wL1nB4sY6/qW9tR2yU5iO8pA3sD6fG01/extra'],
    ['a segment one character short', 'vKd3xQ2mZ8rT7wL1nB4sY/qW9tR2yU5iO8pA3sD6fG01'],
    ['a segment one character long', 'vKd3xQ2mZ8rT7wL1nB4sY67/qW9tR2yU5iO8pA3sD6fG01'],
    ['a segment with a character the generator never emits', 'vKd3xQ2mZ8rT7wL1nB4sY!/qW9tR2yU5iO8pA3sD6fG01'],
    ['an escaped slash kept as text', 'vKd3xQ2mZ8rT7wL1nB4sY6%2FqW9tR2yU5iO8pA3sD6fG01'],
    ['an empty key', ''],
  ])('TC-02: rejects %s', (_name, key) => {
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('TC-02: refuses to build a key from an id that is not one of the board’s', () => {
    // The pattern is only worth having if nothing can get past it on the way in either.
    expect(() => assetKeyFor('../etc', 'qW9tR2yU5iO8pA3sD6fG01')).toThrow();
    expect(() => assetKeyFor('vKd3xQ2mZ8rT7wL1nB4sY6', 'nope')).toThrow();
  });
});
