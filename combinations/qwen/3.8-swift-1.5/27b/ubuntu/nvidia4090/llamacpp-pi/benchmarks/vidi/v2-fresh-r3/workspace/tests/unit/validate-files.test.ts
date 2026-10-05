import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/** A File with an exact size (content sized to match). */
function file(name: string, type: string, size: number): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

/** N valid 1-byte PNG files. */
function validPngs(n: number): File[] {
  return Array.from({ length: n }, (_, i) => file(`img-${i}.png`, 'image/png', 1));
}

describe('TC-08: validateFiles size limit (boundary)', () => {
  it('a file of exactly IMAGE_MAX_BYTES is accepted', () => {
    const { accepted, rejections } = validateFiles([file('edge.jpg', 'image/jpeg', IMAGE_MAX_BYTES)]);
    expect(accepted).toHaveLength(1);
    expect(rejections.has('size')).toBe(false);
  });

  it('a file of IMAGE_MAX_BYTES + 1 is rejected with the size message', () => {
    const { accepted, rejections } = validateFiles([file('big.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1)]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('TC-09: validateFiles count limit and type mix', () => {
  it(`${IMAGE_MAX_FILES_PER_ADD + 1} valid files → first ${IMAGE_MAX_FILES_PER_ADD} accepted + count rejection`, () => {
    const files = validPngs(IMAGE_MAX_FILES_PER_ADD + 1);
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('a mix of PDF and PNG → the PNG accepted + type rejection', () => {
    const pdf = file('doc.png', 'application/pdf', 100);
    const png = file('pic.png', 'image/png', 1);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toEqual([png]);
    expect(rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });
});

describe('REJECTION_MESSAGES match the PRD wording exactly', () => {
  it('type / size / count / offline', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
