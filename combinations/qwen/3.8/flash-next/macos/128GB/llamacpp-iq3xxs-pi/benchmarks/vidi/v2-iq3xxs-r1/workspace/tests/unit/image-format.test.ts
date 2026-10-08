import { describe, expect, it } from 'vitest';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import { fixtureHead, paddedJpeg, fixtureBytes } from '../fixtures/images';

/**
 * Story 12 — what an uploaded file *is*, decided from its bytes (assets.api).
 *
 * The server never trusts a file name or a `Content-Type`, so these pure functions
 * are the whole security story: a PDF wearing a `.png` name and an SVG carrying a
 * script must both come back as `null`, and a key that is not exactly two unguessable
 * ids must never be readable.
 */

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

describe('sniffImageType (image.types)', () => {
  // TC-01: the four accepted formats, recognised from their headers alone.
  it('TC-01 names PNG, JPEG, GIF87a, GIF89a and WebP from their magic bytes', async () => {
    expect(await sniffFixture('photo.png')).toBe('image/png');
    expect(await sniffFixture('photo.jpg')).toBe('image/jpeg');
    expect(await sniffFixture('photo.webp')).toBe('image/webp');
    expect(await sniffFixture('animated.gif')).toBe('image/gif');
    // GIF87a is the older header; the encoder that wrote our fixture wrote GIF89a.
    const gif87a = new Uint8Array(ascii('GIF87a'));
    expect(sniffImageType(withRoom(gif87a))).toBe('image/gif');
    // and a header that arrives inside a longer body
    expect(sniffImageType(withRoom(new Uint8Array(ascii('RIFF'))))).toBe(null); // RIFF, but not a WebP
  });

  // TC-01 (negative): text, a disguised document, and nonsense are not images.
  it('TC-01 refuses SVG, a PDF, and three random bytes', async () => {
    expect(await sniffFixture('script.svg')).toBe(null);
    expect(await sniffFixture('document.pdf')).toBe(null);
    expect(await sniffFixture('fake.png')).toBe(null); // a real PDF, named like a PNG
    expect(sniffImageType(withRoom(new Uint8Array([0x00, 0x01, 0x02])))).toBe(null);
    // A file whose *name* promises a PNG but whose first line is XML is still text.
    expect(sniffImageType(withRoom(ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">')))).toBe(null);
  });

  it('only looks at the first IMAGE_SNIFF_BYTES, and asks for nothing more', async () => {
    const png = await fixtureHead('photo.png', IMAGE_SNIFF_BYTES);
    expect(png).toHaveLength(IMAGE_SNIFF_BYTES);
    expect(sniffImageType(png)).toBe('image/png');
    // A WebP header needs byte 12 to be readable, so a short head is not a WebP.
    expect(sniffImageType(new Uint8Array(ascii('WEBP')))).toBe(null);
    expect(sniffImageType(new Uint8Array(0))).toBe(null);
    expect(sniffImageType(new Uint8Array(ascii('GIF89a')))).toBe('image/gif'); // exactly 6 bytes
  });

  it('returns only types listed in IMAGE_ACCEPTED_TYPES', async () => {
    for (const name of ['photo.png', 'photo.jpg', 'photo.webp', 'animated.gif'] as const) {
      const found = await sniffFixture(name);
      expect(IMAGE_ACCEPTED_TYPES).toContain(found);
    }
  });
});

describe('asset keys (share.unguessable)', () => {
  // TC-02: the only shape a served key may have.
  it('TC-02 accepts <22>/<22> and refuses everything shaped like a walk', () => {
    const id = newBoardId();
    const key = `${id}/${newBoardId()}`;
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false); // missing the asset half
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}x/${newBoardId()}`)).toBe(false); // 23-character id
    expect(ASSET_KEY_PATTERN.test(`${id}/${newBoardId()}/extra`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/../../etc/passwd`)).toBe(false);
  });

  it('joins a board id and an asset id into exactly such a key', () => {
    const boardId = newBoardId();
    const key = assetKeyFor(boardId, newBoardId());
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(key.startsWith(`${boardId}/`)).toBe(true);
  });

  it('refuses to build a key from an id that is not a board id', () => {
    expect(() => assetKeyFor('../boards', newBoardId())).toThrow();
    expect(() => assetKeyFor(newBoardId(), 'nope')).toThrow();
  });
});

/** The first IMAGE_SNIFF_BYTES of a fixture, padded so length never changes the answer. */
async function sniffFixture(name: Parameters<typeof fixtureHead>[0]) {
  return sniffImageType(withRoom(await fixtureHead(name, IMAGE_SNIFF_BYTES)));
}

/** Grow a head to a full sniff window, the way a short upload body would arrive. */
function withRoom(head: Uint8Array): Uint8Array {
  const out = new Uint8Array(IMAGE_SNIFF_BYTES);
  out.set(head.subarray(0, IMAGE_SNIFF_BYTES));
  return out;
}

describe('fixtures are what they claim to be', () => {
  it('pads a JPEG to an exact length without breaking its header', async () => {
    const base = await fixtureBytes('photo.jpg');
    const exact = paddedJpeg(base, IMAGE_MAX_BYTES);
    expect(exact).toHaveLength(IMAGE_MAX_BYTES);
    expect(sniffImageType(exact.subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/jpeg');
    expect([...exact.subarray(exact.length - 2)]).toEqual([0xff, 0xd9]);
    // The padding is a legal segment, so it survives a smaller request too.
    expect(paddedJpeg(base, base.length + 100)).toHaveLength(base.length + 100);
  });
});
