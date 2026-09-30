/**
 * Unit tests for image format sniffing and file validation (story 12).
 * TC-01, TC-02, TC-08, TC-09.
 */

import { describe, it, expect } from 'vitest';

import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

// --- Magic byte fixtures ---

function pngHeader(): Uint8Array {
  // Minimal PNG signature: 89 50 4E 47 0D 0A 1A 0A
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

function jpegHeader(): Uint8Array {
  // JPEG SOI marker: FF D8 FF
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function gif87aHeader(): Uint8Array {
  // GIF87a
  const bytes = new Uint8Array(12);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
  return bytes;
}

function gif89aHeader(): Uint8Array {
  // GIF89a
  const bytes = new Uint8Array(12);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  return bytes;
}

function webpHeader(): Uint8Array {
  // RIFF....WEBP
  const bytes = new Uint8Array(12);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

function svgText(): Uint8Array {
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  return new TextEncoder().encode(text);
}

function pdfRenamedPng(): Uint8Array {
  // PDF header: %PDF
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
}

function randomBytes(): Uint8Array {
  return new Uint8Array([0x01, 0x02, 0x03]);
}

describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(pngHeader())).toBe('image/png');
  });

  it('detects JPEG', () => {
    expect(sniffImageType(jpegHeader())).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    expect(sniffImageType(gif87aHeader())).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    expect(sniffImageType(gif89aHeader())).toBe('image/gif');
  });

  it('detects WebP', () => {
    expect(sniffImageType(webpHeader())).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    expect(sniffImageType(svgText())).toBeNull();
  });

  it('returns null for renamed PDF', () => {
    expect(sniffImageType(pdfRenamedPng())).toBeNull();
  });

  it('returns null for random 3 bytes', () => {
    expect(sniffImageType(randomBytes())).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  const validBoard = 'abcdefghij_klmnopqrst0';  // 22 chars
  const validAsset = 'ABCDEFGHIJ1234567890x_'; // 22 chars

  it('accepts valid boardId/assetId key', () => {
    const key = `${validBoard}/${validAsset}`;
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing slash (just boardId)', () => {
    expect(ASSET_KEY_PATTERN.test(validBoard)).toBe(false);
  });

  it('rejects path traversal ../x', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char board id', () => {
    const long = validBoard + 'X';
    expect(ASSET_KEY_PATTERN.test(`${long}/${validAsset}`)).toBe(false);
  });

  it('assetKeyFor produces matching key', () => {
    const key = assetKeyFor(validBoard, validAsset);
    expect(key).toBe(`${validBoard}/${validAsset}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });
});

describe('TC-08: validateFiles — size boundary', () => {
  it('file exactly IMAGE_MAX_BYTES is accepted', () => {
    const file = new File([new ArrayBuffer(IMAGE_MAX_BYTES)], 'test.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(rejections.size).toBe(0);
  });

  it('file IMAGE_MAX_BYTES + 1 is rejected with size', () => {
    const file = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('TC-09: validateFiles — count and type', () => {
  it('21 valid files: first 20 accepted, count rejection set', () => {
    const files: File[] = [];
    for (let i = 0; i < 21; i++) {
      files.push(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], `img${i}.png`, { type: 'image/png' }));
    }
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('PDF + PNG mix: PNG accepted, type rejection set', () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', { type: 'application/pdf' });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'img.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.name).toBe('img.png');
    expect(rejections.has('type')).toBe(true);
  });

  it('REJECTION_MESSAGES match PRD wording', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
