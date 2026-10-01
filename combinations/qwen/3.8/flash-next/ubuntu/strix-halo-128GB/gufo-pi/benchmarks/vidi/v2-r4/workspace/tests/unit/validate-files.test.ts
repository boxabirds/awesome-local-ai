/**
 * Unit tests for client-side file validation (TC-08, TC-09).
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(name: string, type: string, size: number): File {
  const content = new Uint8Array(Math.min(size, 64)); // don't allocate 10MB
  const file = new File([content], name, { type });
  // Override size for large files since we can't actually allocate 10MB
  if (size > 64) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('big.png', 'image/png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1', () => {
    const file = makeFile('toobig.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('validateFiles count limit (TC-09)', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD when given 21 valid files', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 100),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts PNG and rejects PDF in same batch', () => {
    const pdf = makeFile('document.pdf', 'application/pdf', 1000);
    const png = makeFile('image.png', 'image/png', 100);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(png);
    expect(rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES match PRD wording', () => {
  it('type message', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('size message', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('count message', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('offline message', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
