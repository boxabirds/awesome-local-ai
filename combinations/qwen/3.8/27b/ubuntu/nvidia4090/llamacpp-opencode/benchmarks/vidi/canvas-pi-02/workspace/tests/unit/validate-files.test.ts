/**
 * TC-08: type, size, and count limits are enforced with the exact PRD messages.
 * TC-09: an empty drop is a no-op (no objects, no toast).
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

// --- Test file helpers ---------------------------------------------------------

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

// --- TC-08: type, size, and count limits ---------------------------------------

describe('TC-08: type, size, and count limits are enforced', () => {
  it('accepts a valid image', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a non-image type', () => {
    const file = makeFile('document.pdf', 'application/pdf', 1024);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('rejects a file over 10 MB', () => {
    const file = makeFile('big.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('accepts a file exactly at the size limit', () => {
    const file = makeFile('exact.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects files beyond the count limit', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 1024),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts exactly the max number of files', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 1024),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it('accepts all four image types', () => {
    const types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const type of types) {
      const file = makeFile('test.img', type, 1024);
      const result = validateFiles([file]);
      expect(result.accepted).toHaveLength(1);
    }
  });

  it('rejects mixed files: one valid, one invalid type, one too big', () => {
    const valid = makeFile('good.jpg', 'image/jpeg', 1024);
    const badType = makeFile('bad.pdf', 'application/pdf', 1024);
    const tooBig = makeFile('big.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([valid, badType, tooBig]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(valid);
    expect(result.rejections.has('type')).toBe(true);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('deduplicates rejection reasons in the set', () => {
    const bad1 = makeFile('a.pdf', 'application/pdf', 1024);
    const bad2 = makeFile('b.doc', 'application/msword', 1024);
    const result = validateFiles([bad1, bad2]);
    expect(result.rejections.size).toBe(1);
    expect(result.rejections.has('type')).toBe(true);
  });
});

// --- TC-09: empty drop is a no-op ----------------------------------------------

describe('TC-09: an empty drop is a no-op', () => {
  it('returns no accepted files and no rejections for an empty list', () => {
    const result = validateFiles([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.size).toBe(0);
  });
});

// --- Rejection messages are exact PRD text -------------------------------------

describe('REJECTION_MESSAGES', () => {
  it('has the exact PRD message for type', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('has the exact PRD message for size', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('has the exact PRD message for count', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('has the exact PRD message for rate', () => {
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });

  it('has the exact PRD message for offline', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
