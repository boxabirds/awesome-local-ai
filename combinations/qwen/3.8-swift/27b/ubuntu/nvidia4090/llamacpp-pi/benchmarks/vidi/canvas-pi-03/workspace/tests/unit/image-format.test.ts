/**
 * Story 12: magic-byte image sniffing and asset key rules (assets.api unit,
 * TC-01, TC-02). Pure functions — no Worker, no storage.
 */
import { describe, it, expect } from 'vitest';
import {
  sniffImageType,
  ASSET_KEY_PATTERN,
  assetKeyFor,
} from 'src/shared/image-format';
import {
  makePng,
  JPEG_BYTES,
  makeGif,
  WEBP_BYTES,
  makePdf,
} from '../fixtures/images';
import { IMAGE_SNIFF_BYTES } from 'src/shared/config';

const head = (bytes: Uint8Array): Uint8Array => bytes.subarray(0, IMAGE_SNIFF_BYTES);

describe('TC-01: sniffImageType (magic bytes only, never the client header)', () => {
  it('accepts PNG', () => {
    expect(sniffImageType(head(makePng(8, 8)))).toBe('image/png');
  });

  it('accepts JPEG', () => {
    expect(sniffImageType(head(JPEG_BYTES))).toBe('image/jpeg');
  });

  it('accepts GIF87a', () => {
    const g = makeGif();
    g[3] = 0x38;
    g[4] = 0x37; // GIF87a
    expect(sniffImageType(head(g))).toBe('image/gif');
  });

  it('accepts GIF89a', () => {
    expect(sniffImageType(head(makeGif()))).toBe('image/gif');
  });

  it('accepts WebP (RIFF....WEBP)', () => {
    expect(sniffImageType(head(WEBP_BYTES))).toBe('image/webp');
  });

  it('rejects an SVG (script-carrying, text-based)', () => {
    expect(
      sniffImageType(
        head(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')),
      ),
    ).toBeNull();
  });

  it('rejects a PDF renamed to .png (content wins over the name)', () => {
    expect(sniffImageType(head(makePdf()))).toBeNull();
  });

  it('rejects 3 random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN (unguessable boardId/assetId keys)', () => {
  const id = 'aB3-_x'.padEnd(22, 'k'); // 22 base64url chars
  it('accepts a valid <22>/<22> key', () => {
    expect(ASSET_KEY_PATTERN.test(`${id}/${id}`)).toBe(true);
  });

  it('rejects a missing part', () => {
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false);
  });

  it('rejects "../" traversal', () => {
    expect(ASSET_KEY_PATTERN.test(`../${id}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../..`)).toBe(false);
  });

  it('rejects a 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test(`${id}z/${id}`)).toBe(false);
  });

  it('assetKeyFor joins boardId and assetId with a slash', () => {
    expect(assetKeyFor(id, id)).toBe(`${id}/${id}`);
  });
});
