/**
 * What an image is, decided from bytes alone (`assets.api`, pure half).
 *
 * TC-01 and TC-02 are the two decisions the Worker makes without asking anybody: what a
 * body *is*, and whether a string is an address of a stored object. Both are security
 * decisions — a file type taken from a name would let an SVG carrying script onto a board,
 * and a key with `..` in it would let a request read something beside its own board — so
 * they are tested against real fixture bytes rather than against descriptions of them.
 */
import { describe, expect, it } from 'vitest';

import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { fixtureBytes, fixtureMime } from '../fixtures/image-files';

/** The first bytes of a file, which is all a sniffer is given. */
function head(name: string, length = 12): Uint8Array {
  return fixtureBytes(name).subarray(0, length);
}

/** A GIF87a header: the older signature, which is the same format for our purposes. */
function gif87aHead(): Uint8Array {
  const bytes = head('animation.gif', 12);
  const copy = Uint8Array.from(bytes);
  copy[4] = 0x37; // the '9' of "GIF89a" becomes a '7'
  return copy;
}

describe('sniffImageType (TC-01)', () => {
  it('recognises a PNG by its signature', () => {
    expect(sniffImageType(head('screenshot.png'))).toBe('image/png');
  });

  it('recognises a JPEG', () => {
    expect(sniffImageType(head('photo-small.jpg'))).toBe('image/jpeg');
  });

  it('recognises both GIF signatures', () => {
    expect(sniffImageType(head('animation.gif'))).toBe('image/gif');
    expect(sniffImageType(gif87aHead())).toBe('image/gif');
  });

  it('recognises a WebP, whose signature is split across the RIFF header', () => {
    const bytes = head('picture.webp');
    expect(fixtureMime('picture.webp')).toBe('image/webp');
    // "RIFF", four ignored length bytes, "WEBP".
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(sniffImageType(bytes)).toBe('image/webp');
  });

  it('refuses an SVG, which is markup and could carry script', () => {
    expect(sniffImageType(head('script.svg'))).toBeNull();
  });

  it('refuses a PDF wearing a .png name', () => {
    expect(sniffImageType(head('renamed-pdf.png'))).toBeNull();
  });

  it('refuses three random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x13, 0x84, 0xf7]))).toBeNull();
  });

  it('refuses a head too short to hold a signature', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('refuses nothing on the strength of a truncated WebP container', () => {
    // "RIFF" alone is a container, not a WebP image.
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageType(bytes)).toBeNull();
  });
});

describe('asset keys (TC-02)', () => {
  const BOARD = 'yGfR3zQm1nB4xKp7Ld2WsA';
  const ASSET = 'qW1eR4tY7uI0oP3aS6dF9g';

  it('accepts exactly a board id and an asset id', () => {
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/${ASSET}`)).toBe(true);
  });

  it('rejects a key missing either part', () => {
    expect(ASSET_KEY_PATTERN.test(BOARD)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${ASSET}`)).toBe(false);
  });

  it('rejects a path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/../${ASSET}`)).toBe(false);
  });

  it('rejects an id that is one character too long', () => {
    expect(ASSET_KEY_PATTERN.test(`${BOARD}x/${ASSET}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${BOARD}/${ASSET}x`)).toBe(false);
  });

  it('joins a board id and an asset id into a key that is an address', () => {
    const key = assetKeyFor(BOARD, ASSET);
    expect(key).toBe(`${BOARD}/${ASSET}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });
});
