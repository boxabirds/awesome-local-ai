import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(type: string, size: number): File {
  // In jsdom/node, we can create a File with the given type and size
  const content = new Uint8Array(size);
  return new File([content], 'test.png', { type });
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(file);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 of 21 valid files + count rejection', () => {
    const files = Array.from({ length: 21 }, () => makeFile('image/png', 100));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts PNG, rejects PDF with type rejection', () => {
    const png = makeFile('image/png', 100);
    const pdf = makeFile('application/pdf', 100);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(png);
    expect(result.rejections.has('type')).toBe(true);
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
