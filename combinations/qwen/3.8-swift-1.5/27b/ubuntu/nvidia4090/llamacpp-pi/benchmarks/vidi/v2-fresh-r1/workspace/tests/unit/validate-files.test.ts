// TC-08: validateFiles size boundary
// TC-09: validateFiles count limit and type mix

import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(type: string, size: number): File {
  // Create a File with the given type and size.
  // For small sizes we use a Blob; for large sizes we fake the size.
  if (size <= 1024) {
    const content = new Uint8Array(size);
    return new File([content], 'test.img', { type });
  }
  // For large files, create a File and override size
  const file = new File([''], 'test.img', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file at IMAGE_MAX_BYTES + 1 with size message', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('TC-09: validateFiles count limit and type mix', () => {
  it('21 valid files → first 20 accepted + count rejection', () => {
    const files = Array.from({ length: 21 }, (_, i) => makeFile('image/png', 100));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('PDF + PNG mix → PNG accepted + type rejection', () => {
    const pdf = makeFile('application/pdf', 100);
    const png = makeFile('image/png', 100);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(png);
    expect(rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES', () => {
  it('matches PRD wording exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
