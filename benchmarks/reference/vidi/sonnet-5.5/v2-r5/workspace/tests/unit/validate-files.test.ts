import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFiles', () => {
  it('TC-08 accepts exactly IMAGE_MAX_BYTES and rejects one byte more with size', () => {
    expect(validateFiles([file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES)])).toEqual({ accepted: expect.any(Array), rejections: new Set() });
    const over = validateFiles([file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1)]);
    expect(over.accepted).toEqual([]);
    expect([...over.rejections]).toEqual(['size']);
  });

  it('TC-09 keeps the first 20 of 21 valid files and reports count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles(files);
    expect(r.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);
    expect(validateFiles(files.slice(0, IMAGE_MAX_FILES_PER_ADD)).rejections.size).toBe(0);
  });

  it('TC-09 a PDF and a PNG: the PNG is accepted and type is reported', () => {
    const png = file('a.png', 'image/png');
    const r = validateFiles([file('a.pdf', 'application/pdf'), png, file('b.svg', 'image/svg+xml')]);
    expect(r.accepted).toEqual([png]);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('messages use the exact PRD wording', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
