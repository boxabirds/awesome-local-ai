// Story 12 — client validation before upload (TC-08, TC-09).
import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { PDF_BYTES, SMALL_PNG } from '../fixtures/image-bytes';

/** A File of `size` bytes without allocating them (only `size` and `type` are read). */
function sizedFile(name: string, type: string, size: number): File {
  const f = new File([], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateFiles', () => {
  it('TC-08: exactly IMAGE_MAX_BYTES → accepted; one byte more → rejected with size', () => {
    const atLimit = sizedFile('at-limit.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const over = sizedFile('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    const r = validateFiles([over]);
    expect(r.accepted).toEqual([]);
    expect([...r.rejections]).toEqual(['size']);
  });

  it('TC-09: 21 valid files → the first IMAGE_MAX_FILES_PER_ADD accepted + count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => new File([SMALL_PNG], `s${i}.png`, { type: 'image/png' }));
    const r = validateFiles(files);
    expect(r.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);
    expect(validateFiles(files.slice(0, IMAGE_MAX_FILES_PER_ADD)).rejections.size).toBe(0);
  });

  it('TC-09: PDF + PNG → PNG accepted + type; SVG, HEIC and video are refused too', () => {
    const pdf = new File([PDF_BYTES], 'doc.pdf', { type: 'application/pdf' });
    const png = new File([SMALL_PNG], 'shot.png', { type: 'image/png' });
    const r = validateFiles([pdf, png]);
    expect(r.accepted).toEqual([png]);
    expect([...r.rejections]).toEqual(['type']);
    for (const type of ['image/svg+xml', 'image/heic', 'video/mp4', '']) {
      expect([...validateFiles([new File(['x'], 'f', { type })]).rejections]).toEqual(['type']);
    }
  });

  it('refused files do not count towards the limit', () => {
    const pngs = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => new File([SMALL_PNG], `s${i}.png`, { type: 'image/png' }));
    const r = validateFiles([new File(['x'], 'a.pdf', { type: 'application/pdf' }), ...pngs]);
    expect(r.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('REJECTION_MESSAGES match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
