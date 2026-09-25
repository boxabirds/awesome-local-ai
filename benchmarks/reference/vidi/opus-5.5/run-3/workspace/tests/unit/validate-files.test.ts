import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

function file(name: string, type: string, size = 100): File {
  // A sparse blob part keeps the 10 MB boundary cheap.
  return new File([new Uint8Array(size)], name, { type });
}

describe('image.insert: validateFiles', () => {
  it('TC-08 a file of exactly IMAGE_MAX_BYTES is accepted; one byte more is rejected with size', () => {
    const atLimit = file('at.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const over = file('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    const r = validateFiles([over]);
    expect(r.accepted).toEqual([]);
    expect([...r.rejections]).toEqual(['size']);
  });

  it('TC-09 21 valid files: the first IMAGE_MAX_FILES_PER_ADD are accepted, with the count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles(files);
    expect(r.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);
    expect(validateFiles(files.slice(0, IMAGE_MAX_FILES_PER_ADD)).rejections.size).toBe(0);
  });

  it('TC-09 a PDF and a PNG: the PNG is accepted, with the type rejection; SVG, HEIC and video are refused too', () => {
    const pdf = file('doc.pdf', 'application/pdf');
    const png = file('shot.png', 'image/png');
    const r = validateFiles([pdf, png]);
    expect(r.accepted).toEqual([png]);
    expect([...r.rejections]).toEqual(['type']);
    for (const t of ['image/svg+xml', 'image/heic', 'video/mp4', '']) {
      expect(validateFiles([file('x', t)]).rejections.has('type')).toBe(true);
    }
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(validateFiles([file('x', t)]).accepted).toHaveLength(1);
    }
  });

  it('counts only supported files towards the limit', () => {
    const pdfs = Array.from({ length: 5 }, (_, i) => file(`${i}.pdf`, 'application/pdf'));
    const pngs = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles([...pdfs, ...pngs]);
    expect(r.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('REJECTION_MESSAGES match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
      rate: "You're adding images too quickly. Wait a minute and try again.",
    });
  });
});
