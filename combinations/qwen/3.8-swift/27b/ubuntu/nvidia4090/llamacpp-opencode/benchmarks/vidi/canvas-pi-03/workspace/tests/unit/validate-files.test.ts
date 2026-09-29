/**
 * Story 12: client-side file validation (image.insert unit, TC-08, TC-09).
 * Pure rules: count first, then type, then size; REJECTION_MESSAGES carry
 * the exact PRD wording.
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from 'src/client/images/validateFiles';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from 'src/shared/config';

function file(name: string, type: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('TC-08: size limit (boundary IMAGE_MAX_BYTES / +1)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const f = file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([f]);
    expect(accepted).toEqual([f]);
    expect(rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with the size message', () => {
    const f = file('b.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([f]);
    expect(accepted).toEqual([]);
    expect(rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('TC-09: count limit and type rejection', () => {
  it('accepts the first 20 of 21 valid files and reports the count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      file(`f${i}.png`, 'image/png', 10),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('adds the PNG of a PDF+PNG mix and reports the type rejection', () => {
    const pdf = file('doc.pdf', 'application/pdf', 10);
    const png = file('ok.png', 'image/png', 10);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toEqual([png]);
    expect(rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
  });

  it('accepts all four raster types', () => {
    const files = [
      file('a.png', 'image/png', 1),
      file('b.jpg', 'image/jpeg', 1),
      file('c.gif', 'image/gif', 1),
      file('d.webp', 'image/webp', 1),
    ];
    expect(validateFiles(files).accepted).toHaveLength(4);
  });

  it('rejects SVG and other non-raster types', () => {
    for (const type of ['image/svg+xml', 'video/mp4', 'application/heic', '']) {
      const { accepted, rejections } = validateFiles([file('x', type, 1)]);
      expect(accepted).toHaveLength(0);
      expect(rejections.has('type')).toBe(true);
    }
  });
});
