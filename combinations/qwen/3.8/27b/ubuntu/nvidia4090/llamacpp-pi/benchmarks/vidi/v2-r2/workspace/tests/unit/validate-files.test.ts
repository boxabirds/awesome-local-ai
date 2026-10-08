/**
 * Unit tests for validateFiles.ts (story 12 TC-08, TC-09).
 *
 * TC-08: validateFiles size boundary: IMAGE_MAX_BYTES accepted, +1 rejected.
 * TC-09: validateFiles count: 21 valid files → first 20 accepted + 'count';
 *        PDF + PNG mix → PNG accepted + 'type'.
 */

import { describe, expect, it } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';

function makeFile(size: number, type: string): File {
  return new File([new ArrayBuffer(size)], 'test', { type });
}

describe('validateFiles size (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile(IMAGE_MAX_BYTES, 'image/png');
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1', () => {
    const file = makeFile(IMAGE_MAX_BYTES + 1, 'image/png');
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('validateFiles count and type (TC-09)', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD of 21 valid files + count rejection', () => {
    const files: File[] = [];
    for (let i = 0; i < IMAGE_MAX_FILES_PER_ADD + 1; i++) {
      files.push(makeFile(100, 'image/png'));
    }
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
    // First N files are the ones accepted
    for (let i = 0; i < IMAGE_MAX_FILES_PER_ADD; i++) {
      expect(accepted[i]).toBe(files[i]);
    }
  });

  it('accepts PNG, rejects PDF with type rejection', () => {
    const png = makeFile(100, 'image/png');
    const pdf = makeFile(100, 'application/pdf');
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(png);
    expect(rejections.has('type')).toBe(true);
  });

  it('rejects all unsupported types', () => {
    const pdf = makeFile(100, 'application/pdf');
    const svg = makeFile(100, 'image/svg+xml');
    const { accepted, rejections } = validateFiles([pdf, svg]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES', () => {
  it('has exact PRD wording for type', () => {
    expect(REJECTION_MESSAGES.type).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
  });

  it('has exact PRD wording for size', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('has exact PRD wording for count', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('has exact PRD wording for offline', () => {
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });
});
