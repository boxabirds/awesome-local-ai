/**
 * TC-01: the sniff accepts all four image formats by magic bytes.
 * TC-02: non-image bytes are rejected.
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, assetKeyFor, ASSET_KEY_PATTERN } from '../../src/shared/image-format';

// --- Test fixtures (real magic bytes) -----------------------------------------

/** JPEG: FF D8 FF */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** PNG: 89 50 4E 47 0D 0A 1A 0A */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** GIF: "GIF87a" or "GIF89a" */
const GIF87A_BYTES = new TextEncoder().encode('GIF87a1234567890');
const GIF89A_BYTES = new TextEncoder().encode('GIF89a1234567890');

/** WebP: "RIFF" + size + "WEBP" */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x00, 0x00, 0x00, // size (little-endian)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
]);

/** Plain text: "Hello, this is not an image" */
const TEXT_BYTES = new TextEncoder().encode('Hello, this is not an image file at all.');

/** HTML: "<!DOCTYPE html>..." */
const HTML_BYTES = new TextEncoder().encode('<!DOCTYPE html><html><head></head><body></body></html>');

/** Empty array */
const EMPTY_BYTES = new Uint8Array(0);

/** Short array (less than 4 bytes) */
const SHORT_BYTES = new Uint8Array([0x89, 0x50]);

// --- Tests --------------------------------------------------------------------

describe('TC-01: sniffImageType accepts all four formats by magic bytes', () => {
  it('recognises JPEG', () => {
    expect(sniffImageType(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('recognises PNG', () => {
    expect(sniffImageType(PNG_BYTES)).toBe('image/png');
  });

  it('recognises GIF87a', () => {
    expect(sniffImageType(GIF87A_BYTES)).toBe('image/gif');
  });

  it('recognises GIF89a', () => {
    expect(sniffImageType(GIF89A_BYTES)).toBe('image/gif');
  });

  it('recognises WebP', () => {
    expect(sniffImageType(WEBP_BYTES)).toBe('image/webp');
  });
});

describe('TC-02: non-image bytes are rejected', () => {
  it('rejects plain text', () => {
    expect(sniffImageType(TEXT_BYTES)).toBeNull();
  });

  it('rejects HTML', () => {
    expect(sniffImageType(HTML_BYTES)).toBeNull();
  });

  it('rejects empty bytes', () => {
    expect(sniffImageType(EMPTY_BYTES)).toBeNull();
  });

  it('rejects short bytes (< 4)', () => {
    expect(sniffImageType(SHORT_BYTES)).toBeNull();
  });

  it('rejects random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03, 0x04]))).toBeNull();
  });
});

describe('assetKeyFor', () => {
  it('returns boardId/assetId format', () => {
    const key = assetKeyFor('abcdefghij1234567890ab', 'qrstuvwxyz1234567890cd');
    expect(key).toBe('abcdefghij1234567890ab/qrstuvwxyz1234567890cd');
  });

  it('key matches ASSET_KEY_PATTERN for valid inputs', () => {
    const key = assetKeyFor('abcdefghij1234567890ab', 'qrstuvwxyz1234567890cd');
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('invalid keys do not match ASSET_KEY_PATTERN', () => {
    expect(ASSET_KEY_PATTERN.test('short/short')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('no-slash-here')).toBe(false);
  });
});
