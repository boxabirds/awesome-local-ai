/**
 * What the browser refuses before anything is uploaded (`image.insert`, pure half).
 *
 * TC-08 and TC-09 sit on the two boundaries the PRD names — 10 MB and 20 files — and on the
 * rule that a refusal explains itself. Both boundaries are checked exactly: a file of exactly
 * the limit is accepted and one byte more is not, because "10 MB or smaller" is a promise
 * about the boundary and not about the average case.
 *
 * One thing these tests do not do is decide a file's format from its bytes. That is
 * `image-format`'s job on the way in and the decoder's job in the browser (TC-29); what is
 * decided here is whether it is worth a request at all.
 */
import { describe, expect, it } from 'vitest';

import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { fixtureBytes, fixtureFile, paddedJpegFile } from '../fixtures/image-files';

/** A valid-looking PNG file of a chosen size, for the boundary cases. */
function pngOfSize(bytes: number): File {
  return new File([new Uint8Array(bytes)], `note-${bytes}.png`, { type: 'image/png' });
}

function pngs(count: number): File[] {
  return Array.from({ length: count }, (_unused, index) => fixtureFile('small.png', `pic-${index}.png`));
}

describe('validateFiles: the size limit (TC-08)', () => {
  it('accepts a file of exactly 10 MB', () => {
    const file = pngOfSize(IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toEqual([file]);
    expect(result.rejections.size).toBe(0);
  });

  it('refuses a file one byte over 10 MB, with the size message', () => {
    const over = paddedJpegFile('too-big.jpg', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('refuses only the oversize file and still accepts the rest', () => {
    const good = fixtureFile('small.png');
    const over = pngOfSize(IMAGE_MAX_BYTES + 1);
    const result = validateFiles([good, over]);
    expect(result.accepted).toEqual([good]);
    expect(result.rejections).toEqual(new Set(['size']));
  });
});

describe('validateFiles: the type list (TC-09)', () => {
  it('accepts each of the four accepted types', () => {
    const files = ['small.png', 'photo-small.jpg', 'animation.gif', 'picture.webp'].map((name) =>
      fixtureFile(name),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(4);
    expect(result.rejections.size).toBe(0);
  });

  it('refuses a PDF and still accepts the PNG from the same action', () => {
    const pdf = new File([fixtureBytes('renamed-pdf.png')], 'deck.pdf', { type: 'application/pdf' });
    const png = fixtureFile('small.png');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toEqual([png]);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('refuses an SVG, which is markup rather than a picture', () => {
    const svg = fixtureFile('script.svg');
    const result = validateFiles([svg]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('refuses a file that claims no type at all', () => {
    const unknown = new File([fixtureBytes('small.png')], 'no-type', { type: '' });
    const result = validateFiles([unknown]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('validateFiles: the count limit (TC-09)', () => {
  it('accepts the first 20 of 21 valid files and says the rest were skipped', () => {
    const files = pngs(IMAGE_MAX_FILES_PER_ADD + 1);
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections).toEqual(new Set(['count']));
  });

  it('accepts exactly 20 without a message', () => {
    const files = pngs(IMAGE_MAX_FILES_PER_ADD);
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it('counts only the accepted files toward the limit', () => {
    // Twenty-one refusals are not twenty-one skipped images: the message a person needs is
    // "those are not images", not "too many images".
    const junk = Array.from({ length: 21 }, (_unused, index) =>
      new File([fixtureBytes('renamed-pdf.png')], `junk-${index}.pdf`, { type: 'application/pdf' }),
    );
    const result = validateFiles(junk);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(new Set(['type']));
  });
});

describe('the refusal wording (TC-09)', () => {
  it('says exactly what the product promises', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });
});
