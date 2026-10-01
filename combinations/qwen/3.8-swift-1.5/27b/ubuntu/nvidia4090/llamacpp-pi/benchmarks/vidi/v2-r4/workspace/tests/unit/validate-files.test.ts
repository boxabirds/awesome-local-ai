/**
 * Unit tests — client-side file validation (story 12, TC-08, TC-09).
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(type: string, size: number, name = 'file'): File {
  // Fill exactly `size` bytes so File.size is exact (boundary tests).
  const chunk = 64 * 1024;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let remaining = size;
  while (remaining > 0) {
    const n = Math.min(chunk, remaining);
    parts.push(new Uint8Array(n));
    remaining -= n;
  }
  return new File(parts, name, { type });
}

describe('validateFiles', () => {
  it('TC-08: a file of exactly IMAGE_MAX_BYTES is accepted; one byte more is rejected with "size" (boundary)', () => {
    const atLimit = makeFile('image/png', IMAGE_MAX_BYTES, 'at-limit.png');
    const over = makeFile('image/png', IMAGE_MAX_BYTES + 1, 'over.png');

    const atLimitResult = validateFiles([atLimit]);
    expect(atLimitResult.accepted).toEqual([atLimit]);
    expect(atLimitResult.rejections.size).toBe(0);

    const overResult = validateFiles([over]);
    expect(overResult.accepted).toEqual([]);
    expect(overResult.rejections.has('size')).toBe(true);
  });

  it('TC-09: 21 valid files → first IMAGE_MAX_FILES_PER_ADD accepted + "count" rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile('image/png', 100, `f${i}.png`),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections.has('count')).toBe(true);
  });

  it('TC-09: a mix of PDF and PNG → the PNG is accepted and "type" is rejected', () => {
    const pdf = makeFile('application/pdf', 500, 'doc.pdf');
    const png = makeFile('image/png', 100, 'pic.png');
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toEqual([png]);
    expect(rejections.has('type')).toBe(true);
    expect(rejections.has('size')).toBe(false);
  });

  it('REJECTION_MESSAGES match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
