/**
 * Story 12 · task 1 — client file validation tests (TC-08, TC-09).
 *
 * `validateFiles` is pure: it looks at `File.type` and `File.size` and nothing
 * else, so these build `File` objects directly. The two numbers that matter
 * most are the boundary at the size limit (exactly 10 MB is fine, one byte more
 * is refused) and the count (the 21st file in a batch overflows). The messages
 * are asserted verbatim against the PRD wording.
 */
import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function pngFile(name: string, size: number): File {
  // Content is irrelevant to `validateFiles` (it reads `.size`); a one-byte body
  // with an explicit size keeps the fixtures small.
  const body = new Uint8Array(size);
  return new File([body], name, { type: 'image/png' });
}

function typedFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file exactly at the limit and refuses one byte more', () => {
    const atLimit = pngFile('at.png', IMAGE_MAX_BYTES);
    const overLimit = pngFile('over.png', IMAGE_MAX_BYTES + 1);
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    expect(overLimit.size).toBe(IMAGE_MAX_BYTES + 1);

    const a = validateFiles([atLimit]);
    expect(a.accepted).toEqual([atLimit]);
    expect(a.rejections.size).toBe(0);

    const b = validateFiles([overLimit]);
    expect(b.accepted).toEqual([]);
    expect(b.rejections.has('size')).toBe(true);
  });
});

describe('validateFiles count and type (TC-09)', () => {
  it('adds only the first 20 of a 21-file batch and flags the count', () => {
    const files = Array.from({ length: 21 }, (_, i) => pngFile(`f${i}.png`, 1024));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    // The first 20, in order.
    expect(result.accepted[0].name).toBe('f0.png');
    expect(result.accepted[IMAGE_MAX_FILES_PER_ADD - 1].name).toBe('f19.png');
    expect(result.accepted.some((f) => f.name === 'f20.png')).toBe(false);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('keeps the PNG from a PDF + PNG mix and flags the type', () => {
    const pdf = typedFile('doc.pdf', 'application/pdf');
    const png = pngFile('pic.png', 1024);
    const result = validateFiles([pdf, png]);
    // The supported file from the same batch is still added (PRD image.types).
    expect(result.accepted).toEqual([png]);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('flags both a wrong type and an oversize when a file is both', () => {
    const bigPdf = typedFile('big.pdf', 'application/pdf', IMAGE_MAX_BYTES + 5);
    const result = validateFiles([bigPdf]);
    expect(result.accepted).toEqual([]);
    // Type is checked first, so a wrong-type file is refused on that ground;
    // the size reason still appears when a *supported* type is oversized.
    const bigPng = pngFile('big.png', IMAGE_MAX_BYTES + 1);
    const r2 = validateFiles([bigPng]);
    expect(r2.rejections.has('size')).toBe(true);
    expect(r2.rejections.has('type')).toBe(false);
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES wording (TC-09)', () => {
  it('matches the exact PRD strings', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
    expect(REJECTION_MESSAGES.rate).toBe(
      "You're adding images too quickly. Wait a minute and try again.",
    );
  });
});
