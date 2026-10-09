/**
 * Unit tests for client-side file validation (story 12, TC-08, TC-09).
 *
 * TC-08: an image file exactly IMAGE_MAX_BYTES is accepted (the limit is
 *        inclusive); one byte over is rejected.
 * TC-09: 25 files are trimmed to the first IMAGE_MAX_FILES_PER_ADD in file
 *        order, and every rejection category appears at most once.
 */
import { describe, expect, it } from 'vitest';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

const file = (name: string, type: string, size: number): File => {
  // A zero-copy File: File.size comes from the (empty) part; override size
  // via a subclass-free trick is not possible, so build a real buffer only
  // for the size-boundary cases (a 10 MB buffer is fine in Node).
  const part = new Uint8Array(Math.max(0, size));
  return new File([part], name, { type });
};

describe('validateFiles', () => {
  it('accepts files of every accepted type', () => {
    for (const type of IMAGE_ACCEPTED_TYPES) {
      const { accepted, rejections } = validateFiles([file('a', type, 1024)]);
      expect(accepted).toHaveLength(1);
      expect(rejections).toEqual([]);
    }
  });

  it('rejects unaccepted types with the type category', () => {
    const { accepted, rejections } = validateFiles([
      file('a.pdf', 'application/pdf', 100),
      file('b.svg', 'image/svg+xml', 100),
      file('c.txt', 'text/plain', 100),
      file('d.bin', '', 100),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejections).toEqual(['type']);
  });

  it('TC-08: accepts an image of exactly IMAGE_MAX_BYTES and rejects one byte over', () => {
    const atLimit = file('limit.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    const { accepted: ok, rejections: okR } = validateFiles([atLimit]);
    expect(ok).toHaveLength(1);
    expect(okR).toEqual([]);

    const over = file('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    const { accepted: bad, rejections: badR } = validateFiles([over]);
    expect(bad).toHaveLength(0);
    expect(badR).toEqual(['size']);
  });

  it('TC-09: 25 files are trimmed to the first IMAGE_MAX_FILES_PER_ADD in file order', () => {
    const files = Array.from({ length: 25 }, (_, i) =>
      file(`img-${String(i).padStart(2, '0')}.png`, 'image/png', 100),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted.map((f) => f.name)).toEqual(
      files.slice(0, IMAGE_MAX_FILES_PER_ADD).map((f) => f.name),
    );
    expect(rejections).toEqual(['count']);
  });

  it('records each rejection category at most once, in first-seen order', () => {
    const { rejections } = validateFiles([
      file('a.pdf', 'application/pdf', 100),
      file('b.png', 'image/png', 100),
      file('c.pdf', 'application/pdf', 100),
      file('d.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1),
      file('e.png', 'image/png', 100),
      file('f.txt', 'text/plain', 100),
      file('g.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 2),
    ]);
    expect(rejections).toEqual(['type', 'size']);
  });
});

describe('rejection toast copy (PRD strings)', () => {
  it('uses the exact PRD sentences', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });
});
