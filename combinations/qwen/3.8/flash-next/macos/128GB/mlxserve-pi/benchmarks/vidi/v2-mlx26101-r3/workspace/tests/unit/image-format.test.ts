/**
 * Story 12, task 1 (TC-01, TC-02): the two pure questions the asset API asks - what are these bytes, and
 * is this key one of ours.
 *
 * Both are worth testing apart from any request, because both are the kind of thing that is either right
 * or quietly wrong. A sniffer that recognizes three of the four formats accepts a file nobody asked for
 * and refuses one somebody drew; a key pattern anchored at one end only accepts `../x` alongside the real
 * thing. Neither shows up while the code is being written, and both show up later as somebody's file
 * being readable by somebody who should not have been able to ask for it.
 *
 * The bytes are the real fixtures, not arrays that imitate them - see `fixtures/node/imageFiles`.
 */
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { fixtureBytes, fixtureHead } from '../fixtures/node/imageFiles';
import { pseudorandomBytes, truncatedPngBytes } from '../fixtures/imageBytes';

/* ------------------------------------------------------------------------------- TC-01 */

describe('sniffImageType', () => {
  it('names a PNG by its eight-byte signature', () => {
    expect(sniffImageType(fixtureHead('screenshot.png', IMAGE_SNIFF_BYTES))).toBe('image/png');
  });

  it('names a JPEG by its three-byte signature', () => {
    expect(sniffImageType(fixtureHead('photo.jpg', IMAGE_SNIFF_BYTES))).toBe('image/jpeg');
  });

  it('names GIF89a', () => {
    expect(sniffImageType(fixtureHead('animation.gif', IMAGE_SNIFF_BYTES))).toBe('image/gif');
  });

  it('names GIF87a, which is a different six bytes', () => {
    // The two versions differ in one character of the header, and both are in the wild. A sniffer that
    // matched only 'GIF8' would pass the case above and fail this one.
    const head = fixtureHead('static.gif', IMAGE_SNIFF_BYTES);
    expect(String.fromCharCode(head[3]!, head[4]!, head[5]!)).toBe('87a');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('names a WebP, whose signature is split by a length nobody cares about', () => {
    // 'RIFF' at zero and 'WEBP' at eight: the reason IMAGE_SNIFF_BYTES is twelve and not four.
    const head = fixtureHead('picture.webp', IMAGE_SNIFF_BYTES);
    expect(String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!)).toBe('RIFF');
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('refuses an SVG, which is a text file a browser runs', () => {
    expect(sniffImageType(fixtureBytes('script.svg'))).toBeNull();
  });

  it('refuses a PDF that has been given a .png name', () => {
    // The whole point of reading bytes. The file is named .png, a browser calls it image/png, and the only
    // thing that can tell it is not a PNG is the file.
    expect(fixtureHead('renamed-pdf.png', 4).length).toBe(4);
    expect(sniffImageType(fixtureHead('renamed-pdf.png', IMAGE_SNIFF_BYTES))).toBeNull();
  });

  it('refuses three random bytes', () => {
    expect(sniffImageType(pseudorandomBytes(3))).toBeNull();
  });

  it('refuses an empty file', () => {
    // Nothing about an empty file says image, and it must not be stored on the chance that it does.
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('refuses a signature that is there but cut short', () => {
    // Five bytes of a PNG, which is enough for a prefix check that stopped early to say yes to.
    expect(sniffImageType(fixtureHead('screenshot.png', 5))).toBeNull();
  });

  it('refuses a RIFF file that is not a WEBP', () => {
    // 'RIFF' with something else in the second slot - a WAV, say. Both halves have to agree.
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  it('needs the whole of a signature, not the part of it that fits', () => {
    // Twelve good bytes of a WebP is a WebP. Eight of them is a file whose second half was never looked
    // at, which is a different answer and the only safe one to give.
    const webp = fixtureHead('picture.webp', IMAGE_SNIFF_BYTES);
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(webp.subarray(0, 8))).toBeNull();
  });

  it('accepts a truncated PNG, which is a PNG as far as anything but a decoder can tell', async () => {
    // The honest limit of what this function can promise. A file that stops in the middle of its pixel
    // data has a PNG's first twelve bytes and will not decode: the worker stores it, and the browser that
    // asked for it says "unavailable" - which is image.unavailable, not image.types. The client, which
    // decodes before it uploads, is TC-29's business.
    const truncated = await truncatedPngBytes(64);
    expect(sniffImageType(truncated.subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/png');
  });

  it('reads the head it is given and no further', () => {
    // IMAGE_SNIFF_BYTES is the longest signature plus the gap in the WebP's, and every one of the four
    // formats is settled inside it. A longer head is allowed and must not change the answer.
    const png = fixtureBytes('screenshot-3.png');
    expect(sniffImageType(png.subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/png');
    expect(sniffImageType(png)).toBe('image/png');
  });
});

/* ------------------------------------------------------------------------------- TC-02 */

describe('ASSET_KEY_PATTERN', () => {
  it('accepts a board id, a slash and an asset id, each 22 base64url characters', () => {
    expect(`${newBoardId()}/${newBoardId()}`).toMatch(ASSET_KEY_PATTERN);
  });

  it('accepts the whole base64url alphabet', () => {
    // Including '-' and '_', which are why the pattern spells out a class rather than using \w: base64url
    // is the alphabet story 5's board ids are made of, and an asset id is made the same way. One character
    // at a time, because an id is 22 characters and the alphabet is 64 of them.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    expect(alphabet).toHaveLength(64);
    for (const character of alphabet) {
      const id = character.repeat(22);
      expect(`${id}/${id}`).toMatch(ASSET_KEY_PATTERN);
    }
  });

  it('refuses a key with the asset half missing', () => {
    expect(newBoardId()).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses a key with the board half missing', () => {
    expect(`/${newBoardId()}`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses a path that walks out of the bucket', () => {
    expect('../x').not.toMatch(ASSET_KEY_PATTERN);
    expect(`${newBoardId()}/../${newBoardId()}`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`${newBoardId()}/..`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses an id that is one character too long', () => {
    expect(`${newBoardId()}x/${newBoardId()}`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`${newBoardId()}/${newBoardId()}x`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses an id that is one character too short', () => {
    expect(`${newBoardId().slice(1)}/${newBoardId()}`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`${newBoardId()}/${newBoardId().slice(1)}`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('is anchored at both ends, so nothing may be added before or after', () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    expect(`${key}/extra`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`/${key}`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`${key}%00`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`x${key}`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses a space, a backslash, a dot and a percent sign', () => {
    // The characters a path is made of that this pattern must not have in it, listed rather than trusted.
    const id = newBoardId();
    for (const bad of ['a b'.padEnd(22, '.'), 'a\\b'.padEnd(22, '.'), '..'.padEnd(22, '.'), '%2e'.padEnd(22, '.')]) {
      expect(`${id}/${bad}`).not.toMatch(ASSET_KEY_PATTERN);
    }
  });

  it('is the pattern the contract says it is', () => {
    // Written out rather than inferred, because this string is the difference between a route that serves
    // a board's images and a route that serves anything.
    expect(ASSET_KEY_PATTERN.source).toBe('^[A-Za-z0-9_-]{22}\\/[A-Za-z0-9_-]{22}$');
  });
});

describe('assetKeyFor', () => {
  it('joins a board id and an asset id with one slash', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });

  it('produces a key the pattern accepts, which is what makes the asset servable', () => {
    expect(assetKeyFor(newBoardId(), newBoardId())).toMatch(ASSET_KEY_PATTERN);
  });

  it('refuses a board id that is not a board id', () => {
    // A key made from a bad board id stores bytes nobody can ever ask for, silently: the route that
    // serves it would refuse the key. That is why the check is here as well as at the route.
    expect(() => assetKeyFor('../../etc', newBoardId())).toThrow();
    expect(() => assetKeyFor('', newBoardId())).toThrow();
    expect(() => assetKeyFor('a board name with spaces', newBoardId())).toThrow();
  });

  it('refuses an asset id that is not one either', () => {
    expect(() => assetKeyFor(newBoardId(), 'short')).toThrow();
    expect(() => assetKeyFor(newBoardId(), newBoardId() + newBoardId())).toThrow();
    expect(() => assetKeyFor(newBoardId(), '')).toThrow();
  });

  it('gives two uploads of the same file two different keys', () => {
    // Immutable caching depends on it: one key is one cached copy forever, so a second upload that reused
    // a key would be a file that could never be replaced and never be re-read.
    const boardId = newBoardId();
    expect(new Set([assetKeyFor(boardId, newBoardId()), assetKeyFor(boardId, newBoardId())]).size).toBe(2);
  });

  it('gives the same asset id on two boards two different keys', () => {
    // The bucket is shared by every board; the prefix is what keeps one board's assets in a pile of their
    // own, and what lets the serving route check that the board in the path is the board the key was made
    // for without asking the document anything.
    const assetId = newBoardId();
    expect(assetKeyFor(newBoardId(), assetId)).not.toBe(assetKeyFor(newBoardId(), assetId));
  });
});

/* -------------------------------------------------------------------- the fixtures themselves */

/**
 * The fixtures are load-bearing, so their properties are asserted rather than remembered: a test that
 * scales a 4032-pixel photograph means nothing the day the photograph is 800 pixels wide, and "animated
 * GIFs play" is a claim about a file that has more than one frame in it.
 */
describe('the image fixtures', () => {
  it('are the pixel sizes the story talks about', () => {
    expect(pngDimensions(fixtureBytes('screenshot.png'))).toBe('1440x900');
    expect(jpegDimensions(fixtureBytes('photo.jpg'))).toBe('4032x3024');
    expect(pngDimensions(fixtureBytes('screenshot-2.png'))).toBe('800x600');
  });

  it('has a GIF with more than one frame, and one with none', () => {
    // A GIF's frames are its graphic control extensions, which is a thing you can count in the bytes.
    expect(gifFrames(fixtureBytes('animation.gif'))).toBe(2);
    expect(gifFrames(fixtureBytes('static.gif'))).toBe(0);
  });

  it('has a PNG that will not decode', () => {
    // 400 bytes of a much larger file: the signature is a PNG's, the header is a PNG's, and the pixel
    // data stops in the middle - there is no IEND, so no decoder can be told the file is finished. This is
    // what TC-29 hands to `createImageBitmap`, and what the worker's sniffer waves through.
    const broken = fixtureBytes('broken.png');
    expect([...broken.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(broken.length).toBeLessThan(1000);
    expect(pngDimensions(broken)).toBe('1440x900');
    expect(hasChunk(broken, 'IEND')).toBe(false);
  });

  it('has an SVG with a script in it', () => {
    // The reason SVG is not accepted, present in the fixture that proves it is not accepted.
    expect(new TextDecoder().decode(fixtureBytes('script.svg'))).toContain('<script>');
  });

  it('has a PDF wearing a PNG name, and the PDF it was copied from', () => {
    expect(fixtureBytes('renamed-pdf.png')).toEqual(fixtureBytes('document.pdf'));
  });
});

/** The size a PNG declares in its IHDR chunk. Throws when the file is too short to have one. */
function pngDimensions(bytes: Uint8Array): string {
  const view = viewOf(bytes);
  if (bytes.length < 24 || view.getUint32(12) !== 0x49484452) {
    throw new Error('not a PNG with an IHDR');
  }
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

/** The size a JPEG declares in its start-of-frame marker, walking past the segments before it. */
function jpegDimensions(bytes: Uint8Array): string {
  const view = viewOf(bytes);
  for (let offset = 2; offset + 4 < bytes.length; ) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1]!;
    // A start-of-frame marker: 0xC0-0xCF, except the three that are tables or a restart.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return `${view.getUint16(offset + 7)}x${view.getUint16(offset + 5)}`;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  throw new Error('not a JPEG with a start-of-frame marker');
}

/** How many graphic control extensions - frames - a GIF holds. */
function gifFrames(gif: Uint8Array): number {
  let frames = 0;
  for (let offset = 0; offset + 3 < gif.length; offset += 1) {
    if (gif[offset] === 0x21 && gif[offset + 1] === 0xf9 && gif[offset + 2] === 0x04) {
      frames += 1;
    }
  }
  return frames;
}

/** Whether a PNG holds the named chunk - `IEND` being the one that says the pixel data has finished. */
function hasChunk(bytes: Uint8Array, chunk: 'IHDR' | 'IDAT' | 'IEND'): boolean {
  const wanted = [...chunk].map((character) => character.charCodeAt(0));
  for (let offset = 8; offset + 8 <= bytes.length; offset += 1) {
    if (bytes[offset] === wanted[0] && bytes[offset + 1] === wanted[1] && bytes[offset + 2] === wanted[2] && bytes[offset + 3] === wanted[3]) {
      return true;
    }
  }
  return false;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
