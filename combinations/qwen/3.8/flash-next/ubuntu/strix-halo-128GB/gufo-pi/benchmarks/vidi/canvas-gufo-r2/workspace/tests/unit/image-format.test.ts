/**
 * Unit tests for image type sniffing and asset keys (story 12, assets.api).
 * TC-01, TC-02.
 */
import { describe, it, expect } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  randomBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/imageBytes';

describe('sniffImageType (TC-01)', () => {
  it('identifies PNG', () => {
    expect(sniffImageType(pngBytes(8, 8).subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/png');
  });

  it('identifies JPEG', () => {
    expect(sniffImageType(jpegBytes().subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/jpeg');
  });

  it('identifies GIF87a and GIF89a', () => {
    expect(sniffImageType(gifBytes('GIF87a').subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/gif');
    expect(sniffImageType(gifBytes('GIF89a').subarray(0, IMAGE_SNIFF_BYTES))).toBe('image/gif');
  });

  it('identifies WebP (RIFF....WEBP)', () => {
    const head = webpBytes().subarray(0, IMAGE_SNIFF_BYTES);
    expect(head.length).toBe(12);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('rejects SVG text', () => {
    expect(sniffImageType(svgBytes().subarray(0, IMAGE_SNIFF_BYTES))).toBeNull();
  });

  it('rejects a PDF renamed to .png', () => {
    expect(sniffImageType(pdfBytes().subarray(0, IMAGE_SNIFF_BYTES))).toBeNull();
  });

  it('rejects 3 random bytes', () => {
    expect(sniffImageType(randomBytes(3))).toBeNull();
  });

  it('rejects an empty buffer without throwing', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('does not be fooled by a PNG magic byte inside another container', () => {
    const svg = svgBytes();
    const disguised = new Uint8Array(svg.length + 4);
    disguised.set([0x89, 0x50, 0x4e, 0x47], 1); // signature not at offset 0
    disguised.set(svg, 4);
    expect(sniffImageType(disguised.subarray(0, IMAGE_SNIFF_BYTES))).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN and assetKeyFor (TC-02)', () => {
  it('accepts <22 chars>/<22 chars>', () => {
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(key).toMatch(ASSET_KEY_PATTERN);
  });

  it('accepts the URL-safe alphabet', () => {
    expect(`${'A-_9'.padEnd(22, 'a')}/${'Z_9-'.padEnd(22, 'b')}`).toMatch(ASSET_KEY_PATTERN);
  });

  it('rejects a key missing its second part', () => {
    expect('aaaaaaaaaaaaaaaaaaaaaa').not.toMatch(ASSET_KEY_PATTERN);
    expect('aaaaaaaaaaaaaaaaaaaaaa/').not.toMatch(ASSET_KEY_PATTERN);
  });

  it('rejects path traversal', () => {
    expect('../x').not.toMatch(ASSET_KEY_PATTERN);
    expect(`${newBoardId()}/../x`).not.toMatch(ASSET_KEY_PATTERN);
    expect('../../etc/passwd').not.toMatch(ASSET_KEY_PATTERN);
  });

  it('rejects a 23-character id', () => {
    expect(`${'a'.repeat(23)}/${'b'.repeat(22)}`).not.toMatch(ASSET_KEY_PATTERN);
    expect(`${'a'.repeat(22)}/${'b'.repeat(23)}`).not.toMatch(ASSET_KEY_PATTERN);
  });

  it('assetKeyFor joins board and asset ids with a single slash', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });
});
