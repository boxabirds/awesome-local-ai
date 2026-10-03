/**
 * Unit tests for client-side image file validation (story 12, image.insert).
 * TC-08, TC-09.
 */
import { describe, it, expect } from 'vitest';
import {
  validateFiles,
  REJECTION_MESSAGES,
} from '../../src/client/images/validateFiles';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';

/** A File with a given type and byte size. */
function makeFile(type: string, size: number, name = 'f'): File {
  const buf = new Uint8Array(size);
  try {
    return new File([buf], name, { type });
  } catch {
    return { name, type, size } as unknown as File;
  }
}

describe('image.insert: validateFiles (TC-08, TC-09)', () => {
  // TC-08: exactly IMAGE_MAX_BYTES → accepted; +1 → rejected with 'size'.
  it('TC-08: size at the limit is accepted; over the limit is rejected', () => {
    const atLimit = makeFile('image/png', IMAGE_MAX_BYTES);
    const over = makeFile('image/png', IMAGE_MAX_BYTES + 1);

    const r1 = validateFiles([atLimit]);
    expect(r1.accepted).toHaveLength(1);
    expect(r1.rejections.has('size')).toBe(false);

    const r2 = validateFiles([over]);
    expect(r2.accepted).toHaveLength(0);
    expect(r2.rejections.has('size')).toBe(true);
  });

  // TC-09: 21 valid files → first 20 accepted + 'count'.
  it('TC-09: more than the count limit → first 20 accepted + count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile('image/png', 100, `f${i}`),
    );
    const r = validateFiles(files);
    expect(r.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(r.rejections.has('count')).toBe(true);
    // The first 20 (in order) are the accepted ones.
    expect(r.accepted[0]).toBe(files[0]);
    expect(r.accepted[IMAGE_MAX_FILES_PER_ADD - 1]).toBe(files[IMAGE_MAX_FILES_PER_ADD - 1]);
  });

  // TC-09: a mix of PDF and PNG → PNG accepted + 'type' rejection.
  it('TC-09: a non-image file is rejected with a type message, valid ones kept', () => {
    const pdf = makeFile('application/pdf', 100, 'doc.pdf');
    const png = makeFile('image/png', 100, 'img.png');
    const r = validateFiles([pdf, png]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toBe(png);
    expect(r.rejections.has('type')).toBe(true);
    expect(r.rejections.has('size')).toBe(false);
    expect(r.rejections.has('count')).toBe(false);
  });

  it('REJECTION_MESSAGES match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });
});
