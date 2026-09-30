/**
 * Story 12: client-side file validation tests (TC-08, TC-09).
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '@client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';
import { fixtureBytes, sizedBytes, JPEG_MAGIC } from '../fixtures/images';

function pngFile(name = 'a.png', size?: number): File {
  const bytes = size !== undefined ? sizedBytes(size, fixtureBytes('small.png')) : fixtureBytes('small.png');
  return new File([bytes], name, { type: 'image/png' });
}

describe('TC-08: size limit boundary', () => {
  it('a file of exactly IMAGE_MAX_BYTES is accepted', () => {
    const file = new File([sizedBytes(IMAGE_MAX_BYTES, JPEG_MAGIC)], 'limit.jpg', { type: 'image/jpeg' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.has('size')).toBe(false);
  });

  it('a file of IMAGE_MAX_BYTES + 1 is rejected with size (negative)', () => {
    const file = new File([sizedBytes(IMAGE_MAX_BYTES + 1, JPEG_MAGIC)], 'over.jpg', { type: 'image/jpeg' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('TC-09: count limit and type mix', () => {
  it('21 valid files → first 20 accepted + count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => pngFile(`${i}.png`));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted[0]).toBe(files[0]);
    expect(accepted[IMAGE_MAX_FILES_PER_ADD - 1]).toBe(files[IMAGE_MAX_FILES_PER_ADD - 1]);
    expect(rejections.has('count')).toBe(true);
  });

  it('PDF + PNG mix → PNG accepted + type rejection', () => {
    const pdf = new File([fixtureBytes('fake.png')], 'doc.pdf', { type: 'application/pdf' });
    const png = pngFile('ok.png');
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(png);
    expect(rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES match the PRD wording exactly', () => {
  it('type', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('size', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('count', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('offline', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
