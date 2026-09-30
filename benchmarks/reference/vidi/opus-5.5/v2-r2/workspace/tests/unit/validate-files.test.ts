// Story 12 — image.insert client validation: TC-08 (size), TC-09 (count, type) and the PRD wording.
import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, rejectionMessages, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

const png = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

describe('validateFiles', () => {
  it('TC-08: exactly IMAGE_MAX_BYTES is accepted; one byte more is refused with "size"', () => {
    const atLimit = new File([new Uint8Array(IMAGE_MAX_BYTES)], 'big.jpg', { type: 'image/jpeg' });
    const over = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect([...result.rejections]).toEqual(['size']);
  });

  it('TC-09: 21 valid files → the first IMAGE_MAX_FILES_PER_ADD are accepted and "count" is reported', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => png(`${i}.png`));
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...result.rejections]).toEqual(['count']);
    expect(validateFiles(files.slice(0, IMAGE_MAX_FILES_PER_ADD)).rejections.size).toBe(0);
  });

  it('TC-09: a PDF next to a PNG → the PNG is accepted and "type" is reported', () => {
    const pdf = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    const image = png('a.png');
    const result = validateFiles([pdf, image]);
    expect(result.accepted).toEqual([image]);
    expect([...result.rejections]).toEqual(['type']);
  });

  it.each([
    ['SVG', 'image/svg+xml'],
    ['HEIC', 'image/heic'],
    ['video', 'video/mp4'],
    ['no type', ''],
  ])('refuses %s with "type"', (_name, type) => {
    expect([...validateFiles([new File(['x'], 'f', { type })]).rejections]).toEqual(['type']);
  });

  it('refused files do not count towards the limit', () => {
    const files = [
      ...Array.from({ length: 3 }, (_, i) => new File(['x'], `${i}.pdf`, { type: 'application/pdf' })),
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => png(`${i}.png`)),
    ];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect([...result.rejections]).toEqual(['type']);
  });

  it('messages match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
    expect(rejectionMessages(new Set(['count', 'type']))).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.count]);
  });
});
