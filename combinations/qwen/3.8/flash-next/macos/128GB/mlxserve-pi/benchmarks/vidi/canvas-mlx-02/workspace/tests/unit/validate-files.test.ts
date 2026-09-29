// The client's pre-upload gate (TC-29): it says no, in the product's own words, to a
// file that is not an accepted image, is too big, or would be the twenty-first in one
// add. These are the three refusals a person can hit without a network round-trip,
// so the exact strings and the boundaries are the contract.
//
// Note what this does NOT decide: the real type is the server's magic-byte sniff. A
// file renamed to lie about `File.type` passes HERE and is caught on upload - so this
// gate checks the declared type, and these tests check THAT, plus the size and count
// numbers, nothing more.
import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config.ts';
import { REJECTION_MESSAGES, isAcceptedFileType, validateFiles } from '../../src/client/images/validateFiles.ts';

/** A File of `size` bytes carrying a declared MIME type. */
function file(name: string, type: string, size = 8): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('isAcceptedFileType', () => {
  it('accepts exactly the four formats and nothing else', () => {
    expect(isAcceptedFileType('image/png')).toBe(true);
    expect(isAcceptedFileType('image/jpeg')).toBe(true);
    expect(isAcceptedFileType('image/gif')).toBe(true);
    expect(isAcceptedFileType('image/webp')).toBe(true);
    expect(isAcceptedFileType('image/svg+xml')).toBe(false);
    expect(isAcceptedFileType('image/bmp')).toBe(false);
    expect(isAcceptedFileType('application/pdf')).toBe(false);
    expect(isAcceptedFileType('')).toBe(false);
  });
});

describe('validateFiles (TC-29)', () => {
  it('accepts the four formats', () => {
    const v = validateFiles([
      file('a.png', 'image/png'),
      file('b.jpg', 'image/jpeg'),
      file('c.gif', 'image/gif'),
      file('d.webp', 'image/webp'),
    ]);
    expect(v.accepted.length).toBe(4);
    expect(v.rejections.size).toBe(0);
  });

  it('refuses a non-image and names the type message (TC-29)', () => {
    const v = validateFiles([file('x.svg', 'image/svg+xml'), file('x.pdf', 'application/pdf')]);
    expect(v.accepted.length).toBe(0);
    expect([...v.rejections]).toEqual(['type']);
    // the exact PRD wording, verbatim
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('refuses an oversized file with the size message, at the exact boundary', () => {
    // exactly at the limit is allowed; one byte over is not.
    const at = validateFiles([file('ok.png', 'image/png', IMAGE_MAX_BYTES)]);
    expect(at.accepted.length).toBe(1);
    expect(at.rejections.size).toBe(0);

    const over = validateFiles([file('big.png', 'image/png', IMAGE_MAX_BYTES + 1)]);
    expect(over.accepted.length).toBe(0);
    expect([...over.rejections]).toEqual(['size']);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('refuses the 21st otherwise-valid image with the count message', () => {
    const many = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`i${i}.png`, 'image/png'));
    const v = validateFiles(many);
    expect(v.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD); // exactly twenty get in
    expect([...v.rejections]).toEqual(['count']);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');

    // exactly twenty is fine, no rejection at all.
    const exact = validateFiles(Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => file(`i${i}.png`, 'image/png')));
    expect(exact.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(exact.rejections.size).toBe(0);
  });

  it('never lets a type- or size-rejected file eat a slot (mixed batch)', () => {
    // Twenty valid images plus garbage: all twenty valid ones still get in, and BOTH
    // the type and size reasons surface - the junk is refused without crowding out
    // the good files.
    const batch = [
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => file(`good${i}.png`, 'image/png')),
      file('junk.svg', 'image/svg+xml'),
      file('huge.png', 'image/png', IMAGE_MAX_BYTES + 1),
    ];
    const v = validateFiles(batch);
    expect(v.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect([...v.rejections].sort()).toEqual(['size', 'type']);
  });

  it('handles an empty drop without throwing', () => {
    const v = validateFiles([]);
    expect(v.accepted).toEqual([]);
    expect(v.rejections.size).toBe(0);
  });
});
