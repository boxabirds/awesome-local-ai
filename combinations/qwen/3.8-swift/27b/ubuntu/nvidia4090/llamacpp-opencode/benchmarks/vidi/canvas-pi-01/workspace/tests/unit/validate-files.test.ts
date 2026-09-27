// image.insert validation (spec: image.insert, TC-08, TC-09).
//
// Pure pre-upload rules: count first (keep the first 20), then type and size
// per file. REJECTION_MESSAGES must match the PRD wording exactly.

import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { jpegBytes, pdfBytes } from '../fixtures/images';

function file(size: number, type = 'image/png'): File {
  return new File([new Uint8Array(new ArrayBuffer(size))], 'f', { type });
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const big = file(IMAGE_MAX_BYTES);
    const result = validateFiles([big]);
    expect(result.accepted).toEqual([big]);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with the size message (boundary)', () => {
    const big = file(IMAGE_MAX_BYTES + 1, 'image/jpeg');
    const result = validateFiles([big]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(new Set(['size']));
  });
});

describe('validateFiles count and type (TC-09)', () => {
  it('accepts the first 20 of 21 valid files and reports the count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, () =>
      file(100, 'image/png'),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections).toEqual(new Set(['count']));
  });

  it('accepts the PNG in a PDF + PNG mix and reports the type rejection', () => {
    const pdf = new File([pdfBytes(64)], 'doc.png', { type: 'application/pdf' });
    const png = file(100, 'image/png');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toEqual([png]);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('mixes all rejection kinds in one action', () => {
    const pdf = new File([pdfBytes(64)], 'a.pdf', { type: 'application/pdf' });
    const big = file(IMAGE_MAX_BYTES + 1, 'image/jpeg');
    const ok = file(100, 'image/png');
    const result = validateFiles([pdf, big, ok]);
    expect(result.accepted).toEqual([ok]);
    expect([...result.rejections].sort()).toEqual(['size', 'type']);
  });

  it('jpegBytes fixture helpers produce the right leading bytes', () => {
    expect(jpegBytes(16).subarray(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(pdfBytes(16)[0]).toBe(0x25); // '%'
  });
});

describe('REJECTION_MESSAGES (exact PRD wording)', () => {
  it('matches the PRD strings verbatim', () => {
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
