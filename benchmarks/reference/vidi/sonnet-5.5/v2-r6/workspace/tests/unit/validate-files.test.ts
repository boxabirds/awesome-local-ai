import { describe, expect, it } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

const file = (name: string, type: string, size = 10): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFiles', () => {
  it('TC-08: exactly IMAGE_MAX_BYTES is accepted; one byte more is rejected as size', () => {
    const ok = validateFiles([file('a.png', 'image/png', IMAGE_MAX_BYTES)]);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.rejections.size).toBe(0);
    const big = validateFiles([file('b.png', 'image/png', IMAGE_MAX_BYTES + 1)]);
    expect(big.accepted).toHaveLength(0);
    expect([...big.rejections]).toEqual(['size']);
  });

  it('TC-09: 21 valid files keep the first 20 and report count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`${i}.png`, 'image/png'));
    const r = validateFiles(files);
    expect(r.accepted.map((f) => f.name)).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD).map((f) => f.name));
    expect([...r.rejections]).toEqual(['count']);
  });

  it('TC-09: a PDF next to a PNG leaves the PNG and reports type', () => {
    const r = validateFiles([file('a.pdf', 'application/pdf'), file('b.png', 'image/png')]);
    expect(r.accepted.map((f) => f.name)).toEqual(['b.png']);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('accepts PNG, JPEG, GIF and WebP and refuses SVG', () => {
    const r = validateFiles(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].map((t, i) => file(`${i}`, t)));
    expect(r.accepted).toHaveLength(4);
    expect([...r.rejections]).toEqual(['type']);
  });

  it('uses the exact PRD wording', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
