/**
 * Story 12 unit tests: client-side file validation (TC-08, TC-09).
 */

import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

function makeFile(name: string, type: string, size: number): File {
  // Create a File with the given size without actually allocating all the bytes
  const blob = new Blob([new ArrayBuffer(Math.min(size, 1))], { type });
  const file = new File([blob], name, { type, lastModified: 0 });
  // Override size to simulate actual size
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('at-limit.png', 'image/png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.size).toBe(0);
  });

  it('rejects a file at IMAGE_MAX_BYTES + 1 with size message', () => {
    const file = makeFile('too-big.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('TC-09: validateFiles count limit and type mixing', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD files from 21 valid files and flags count', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 100),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts PNG from a mix of PDF and PNG, flags type', () => {
    const pdf = makeFile('doc.pdf', 'application/pdf', 100);
    const png = makeFile('pic.png', 'image/png', 100);
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
