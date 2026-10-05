import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(type: string, size: number, name = 'test.png'): File {
  // Create a File with the given type and size.
  // We can't easily create a File with an arbitrary size in node, so we use
  // a Blob and wrap it. For validation purposes, only type and size matter.
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

// ─── TC-08: validateFiles size boundary ───────────────────────────────────────

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with size rejection', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

// ─── TC-09: validateFiles count and type ──────────────────────────────────────

describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 of 21 valid files with count rejection', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      makeFile('image/png', 1000, `img${i}.png`),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted[0]).toBe(files[0]);
    expect(accepted[19]).toBe(files[19]);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts PNG and rejects PDF with type rejection', () => {
    const png = makeFile('image/png', 1000, 'valid.png');
    const pdf = makeFile('application/pdf', 2000, 'fake.png');
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(png);
    expect(rejections.has('type')).toBe(true);
  });

  it('REJECTION_MESSAGES match PRD wording exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
