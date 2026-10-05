/**
 * TC-08: validateFiles size boundary.
 * TC-09: validateFiles count limit and type/size mix.
 */
import { describe, expect, it } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function mkFile(name: string, type: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = mkFile('big.png', 'image/png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1', () => {
    const file = mkFile('toobig.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('validateFiles count limit (TC-09)', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD of 21 valid files and flags count', () => {
    const files = Array.from({ length: 21 }, (_, i) => mkFile(`img${i}.png`, 'image/png', 100));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts exactly IMAGE_MAX_FILES_PER_ADD without count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => mkFile(`img${i}.png`, 'image/png', 100));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(false);
  });

  it('mix of PDF and PNG: PNG accepted, type rejection flagged', () => {
    const pdf = mkFile('doc.pdf', 'application/pdf', 100);
    const png = mkFile('photo.png', 'image/png', 100);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.name).toBe('photo.png');
    expect(rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES', () => {
  it('type message matches PRD', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('size message matches PRD', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('count message matches PRD', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('offline message matches PRD', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline \u2014 images can be added when you reconnect.");
  });
});
