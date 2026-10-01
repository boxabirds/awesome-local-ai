import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFiles', () => {
  it('TC-08: IMAGE_MAX_BYTES is accepted, one byte more is rejected with a size message', () => {
    const ok = validateFiles([file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES)]);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.rejections.size).toBe(0);
    const big = validateFiles([file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1)]);
    expect(big.accepted).toHaveLength(0);
    expect([...big.rejections]).toEqual(['size']);
  });

  it('TC-09: 21 valid files keep the first 20 and report count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles(files);
    expect(r.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);
  });

  it('TC-09: a PDF next to a PNG is refused with a type message, the PNG stays', () => {
    const png = file('a.png', 'image/png');
    const r = validateFiles([file('a.pdf', 'application/pdf'), png, file('b.svg', 'image/svg+xml')]);
    expect(r.accepted).toEqual([png]);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('messages match the product wording', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
