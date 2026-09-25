/** image.insert validation (story 12): TC-08 size boundary, TC-09 count and type. */
import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

/** A File-like object of `size` bytes without allocating them (validateFiles reads type and size). */
function fakeFile(name: string, type: string, size = 1): File {
  return { name, type, size } as File;
}

describe('TC-08 size limit', () => {
  it('accepts exactly IMAGE_MAX_BYTES and refuses one byte more with the size message', () => {
    const atLimit = fakeFile('at.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const over = fakeFile('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    expect(validateFiles([over])).toEqual({ accepted: [], rejections: new Set(['size']) });
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('also works on real File objects', () => {
    const file = new File([new Uint8Array(3)], 'tiny.png', { type: 'image/png' });
    expect(validateFiles([file]).accepted).toEqual([file]);
  });
});

describe('TC-09 count and type', () => {
  it('21 valid files: the first IMAGE_MAX_FILES_PER_ADD are accepted, plus the count message', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => fakeFile(`${i}.png`, 'image/png'));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections).toEqual(new Set(['count']));
  });

  it('exactly IMAGE_MAX_FILES_PER_ADD files: all accepted, no message', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => fakeFile(`${i}.webp`, 'image/webp'));
    expect(validateFiles(files)).toEqual({ accepted: files, rejections: new Set() });
  });

  it('a PDF and a PNG: the PNG is accepted, plus the type message; SVG, HEIC and video are refused too', () => {
    const pdf = fakeFile('doc.pdf', 'application/pdf');
    const png = fakeFile('shot.png', 'image/png');
    expect(validateFiles([pdf, png])).toEqual({ accepted: [png], rejections: new Set(['type']) });
    for (const type of ['image/svg+xml', 'image/heic', 'video/mp4', '']) {
      expect(validateFiles([fakeFile('x', type)]).rejections).toEqual(new Set(['type']));
    }
  });

  it('refused files do not count towards the limit', () => {
    const bad = Array.from({ length: 5 }, (_, i) => fakeFile(`${i}.pdf`, 'application/pdf'));
    const good = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => fakeFile(`${i}.gif`, 'image/gif'));
    const { accepted, rejections } = validateFiles([...bad, ...good]);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toEqual(new Set(['type']));
  });

  it('messages match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
      rate: "You're adding images too quickly. Wait a minute and try again.",
    });
  });
});
