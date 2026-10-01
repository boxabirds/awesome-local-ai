import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFiles', () => {
  it('TC-08: the size limit is inclusive', () => {
    const ok = validateFiles([file('a.jpg', 'image/jpeg', IMAGE_MAX_BYTES)]);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.rejections.size).toBe(0);
    const big = validateFiles([file('b.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1)]);
    expect(big.accepted).toHaveLength(0);
    expect([...big.rejections]).toEqual(['size']);
  });

  it('TC-09: only the first 20 are kept; unsupported types are rejected but the rest stay', () => {
    const many = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles(many);
    expect(r.accepted).toEqual(many.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);
    const exactly = validateFiles(many.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(exactly.rejections.size).toBe(0);

    const mix = validateFiles([file('a.pdf', 'application/pdf'), file('b.png', 'image/png'), file('c.svg', 'image/svg+xml')]);
    expect(mix.accepted.map((f) => f.name)).toEqual(['b.png']);
    expect([...mix.rejections]).toEqual(['type']);
  });

  it('uses the exact PRD wording', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
