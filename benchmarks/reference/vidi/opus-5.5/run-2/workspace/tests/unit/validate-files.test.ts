/** Story 12 image.insert unit tests (TC-08, TC-09): client-side type, size and count validation. */
import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/** A File of `size` bytes without allocating them (validation reads only name, type and size). */
function fakeFile(name: string, type: string, size = 1000): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateFiles', () => {
  it('TC-08 a file of exactly IMAGE_MAX_BYTES is accepted; one byte more is rejected with the size message', () => {
    const atLimit = fakeFile('at.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const over = fakeFile('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect([...result.rejections]).toEqual(['size']);
    // With real bytes too.
    const real = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    expect([...validateFiles([real]).rejections]).toEqual(['size']);
  });

  it('TC-09 21 valid files: the first IMAGE_MAX_FILES_PER_ADD are accepted and the count message is shown', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => fakeFile(`s${i}.png`, 'image/png'));
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...result.rejections]).toEqual(['count']);
    expect(validateFiles(files.slice(0, IMAGE_MAX_FILES_PER_ADD)).rejections.size).toBe(0);
  });

  it('TC-09 a PDF and a PNG: the PNG is accepted and the type message is shown; SVG, HEIC and video too', () => {
    const pdf = fakeFile('doc.pdf', 'application/pdf');
    const png = fakeFile('shot.png', 'image/png');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toEqual([png]);
    expect([...result.rejections]).toEqual(['type']);
    for (const type of ['image/svg+xml', 'image/heic', 'video/mp4', '']) {
      expect([...validateFiles([fakeFile('x', type)]).rejections]).toEqual(['type']);
    }
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(validateFiles([fakeFile('x', type)]).accepted).toHaveLength(1);
    }
  });

  it('TC-09 messages match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
      rate: "You're adding images too quickly. Wait a minute and try again.",
    });
  });
});
