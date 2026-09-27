import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { jpegBytes, junkBytes, pdfBytes, pngBytes, svgScriptBytes } from '../fixtures/image-bytes';
import { imageFile } from '../fixtures/image-files';

const png = (name: string): File => imageFile(name, 'image/png', pngBytes());
const jpeg = (name: string): File => imageFile(name, 'image/jpeg', jpegBytes());

/**
 * TC-08, TC-09 (`image.types`, `image.size_limit`, `image.count_limit`): the
 * screening the user sees before anything leaves the browser. One message per
 * reason, never per file, and the accepted files keep their order.
 */
describe('validateFiles', () => {
  it('TC-08: accepts PNG, JPEG, GIF and WebP', () => {
    const files = [
      png('a.png'),
      jpeg('b.jpg'),
      imageFile('c.gif', 'image/gif'),
      imageFile('d.webp', 'image/webp'),
    ];
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files);
    expect(result.rejections.size).toBe(0);
  });

  it('TC-08: accepts a file exactly at the size limit and refuses one byte over it', () => {
    const atLimit = imageFile('at-limit.jpg', 'image/jpeg', jpegBytes(IMAGE_MAX_BYTES));
    const overLimit = imageFile('over.jpg', 'image/jpeg', jpegBytes(IMAGE_MAX_BYTES + 1));

    expect(validateFiles([atLimit]).accepted).toHaveLength(1);
    expect(validateFiles([atLimit]).rejections.size).toBe(0);

    const result = validateFiles([overLimit]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(new Set(['size']));
  });

  it('TC-08: reports one type message for a batch mixing several rejected types', () => {
    const files = [
      png('ok-1.png'),
      imageFile('picture.svg', 'image/svg+xml', svgScriptBytes()),
      imageFile('report.pdf', 'application/pdf', pdfBytes()),
      png('ok-2.png'),
      imageFile('notes.txt', 'text/plain', junkBytes(32)),
    ];
    const result = validateFiles(files);
    expect(result.accepted).toEqual([files[0], files[3]]);
    expect(result.rejections).toEqual(new Set(['type']));
    expect(result.rejections.size).toBe(1);
  });

  it('TC-08: reports one size message for several oversized files', () => {
    const big = (name: string): File => imageFile(name, 'image/jpeg', jpegBytes(IMAGE_MAX_BYTES + 1));
    const result = validateFiles([png('ok.png'), big('one.jpg'), big('two.jpg')]);
    expect(result.accepted.map((file) => file.name)).toEqual(['ok.png']);
    expect(result.rejections).toEqual(new Set(['size']));
  });

  it('TC-09: accepts exactly IMAGE_MAX_FILES_PER_ADD files with no rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => png(`image-${index}.png`));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it(`TC-09: keeps the first ${IMAGE_MAX_FILES_PER_ADD} of ${IMAGE_MAX_FILES_PER_ADD + 1} and says why`, () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      png(`image-${index}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections).toEqual(new Set(['count']));
  });

  it('TC-09: counts the cap against supported files, and reports type alongside it', () => {
    const files = [
      imageFile('picture.svg', 'image/svg+xml', svgScriptBytes()),
      png('ok-1.png'),
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD - 1 }, (_unused, index) => png(`image-${index}.png`)),
      imageFile('notes.txt', 'text/plain', junkBytes(24)),
    ];
    const result = validateFiles(files);
    // 20 supported files among 22: every supported one is kept, in order, and no
    // count message is raised for files that were never going to be added.
    expect(result.accepted).toEqual([files[1], ...files.slice(2, 2 + IMAGE_MAX_FILES_PER_ADD - 1)]);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('TC-09: counts the cap over supported files, not over the whole batch', () => {
    // A PDF named .png: the browser reports image/png, so it is not screened out
    // here — the server sniff and the browser decode are what refuse it.
    const disguised = imageFile('report.png', 'image/png', pdfBytes());
    const files = [
      imageFile('picture.svg', 'image/svg+xml', svgScriptBytes()),
      disguised,
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => png(`image-${index}.png`)),
    ];
    const result = validateFiles(files);
    // 21 supported files: the first 20 are kept, which is the disguised PDF and
    // the first 19 PNGs, and the user is told about both refusals.
    expect(result.accepted).toEqual([disguised, ...files.slice(2, 2 + IMAGE_MAX_FILES_PER_ADD - 1)]);
    expect(result.rejections).toEqual(new Set(['type', 'count']));
  });

  it('TC-09: refuses a batch of only unsupported files without a count message', () => {
    const result = validateFiles([
      imageFile('a.svg', 'image/svg+xml', svgScriptBytes()),
      imageFile('b.txt', 'text/plain', junkBytes(16)),
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('TC-09: an empty batch asks for nothing', () => {
    const result = validateFiles([]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.size).toBe(0);
  });

  it('uses the PRD wording for every message', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });
});
