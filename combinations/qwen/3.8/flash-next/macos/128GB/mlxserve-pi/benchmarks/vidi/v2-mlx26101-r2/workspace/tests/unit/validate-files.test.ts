/**
 * What the browser refuses before it uploads (`tests/unit/validate-files.test.ts`).
 *
 * TC-08 and TC-09 of story 12: the client's half of `image.types`,
 * `image.size_limit` and `image.count_limit`, plus the exact sentences the PRD
 * attaches to each. These are unit tests because the rules are arithmetic on a
 * `File` - its claimed type, its size, how many came at once - and because the
 * wording is a product decision that a test should be able to pin down character by
 * character: "Images must be 10 MB or smaller." with a full stop is the message, and
 * a test that only asserted it *mentions* 10 MB would let the message change without
 * anyone noticing.
 *
 * The two boundaries are the whole point of TC-08: at the limit is accepted, one
 * byte over is not. A limit tested only on the obvious side is a limit that can be
 * wrong by one and still look green.
 */

import { describe, expect, it } from 'vitest';

import {
  REJECTION_MESSAGES,
  rejectionMessages,
  validateFiles,
} from '../../src/client/images/validateFiles.js';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config.js';
import { PNG_MAGIC_BYTES, bytesOfLength } from '../fixtures/image-fixtures.js';

/** A file as the browser hands it over: a name, a claimed type and a size. */
const file = (name: string, type: string, size = 64): File =>
  new File([bytesOfLength(size, PNG_MAGIC_BYTES)], name, { type });

const png = (name = 'photo.png', size = 64): File => file(name, 'image/png', size);

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const at = png('exactly-10mb.png', IMAGE_MAX_BYTES);
    expect(at.size).toBe(IMAGE_MAX_BYTES);
    const result = validateFiles([at]);
    expect(result.accepted).toEqual([at]);
    expect(result.rejections.size).toBe(0);
  });

  it('refuses a file one byte larger, and says so', () => {
    const over = png('one-byte-over.png', IMAGE_MAX_BYTES + 1);
    expect(over.size).toBe(IMAGE_MAX_BYTES + 1);
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('size')).toBe(true);
    expect(rejectionMessages(result.rejections)).toEqual([
      'Images must be 10 MB or smaller.',
    ]);
  });

  it('refuses the oversized file and still accepts the good one beside it', () => {
    const good = png('good.png');
    const over = file('huge.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1024);
    const result = validateFiles([good, over]);
    expect(result.accepted).toEqual([good]);
    expect(result.rejections).toEqual(new Set(['size']));
  });

  it('says the size message once, however many oversized files were dropped', () => {
    const many = [0, 1, 2, 3, 4].map((n) => file(`big-${n}.jpg`, 'image/jpeg', IMAGE_MAX_BYTES + 1 + n));
    const result = validateFiles(many);
    expect(result.accepted).toEqual([]);
    expect(rejectionMessages(result.rejections)).toEqual(['Images must be 10 MB or smaller.']);
  });
});

describe('validateFiles type and count (TC-09)', () => {
  it('accepts each of the four types, and only those', () => {
    for (const type of IMAGE_ACCEPTED_TYPES) {
      const one = file(`photo.${type === 'image/png' ? 'png' : 'x'}`, type);
      expect(validateFiles([one]).accepted).toEqual([one]);
    }
    for (const type of ['application/pdf', 'image/svg+xml', 'image/heic', 'video/mp4', '']) {
      const one = file('mystery.bin', type);
      const result = validateFiles([one]);
      expect(result.accepted).toEqual([]);
      expect(result.rejections.has('type')).toBe(true);
    }
  });

  it('takes the first IMAGE_MAX_FILES_PER_ADD of 21 valid files and says why the rest went missing', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      png(`photo-${index}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections).toEqual(new Set(['count']));
    expect(rejectionMessages(result.rejections)).toEqual([
      'Only 20 images can be added at once.',
    ]);
  });

  it('takes exactly 20 without complaining', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) =>
      png(`photo-${index}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it('does not let a refused file use up one of the twenty places', () => {
    // Twenty-one files, one of them a PDF: the count is about what lands on the
    // board, so the twenty PNGs are all added and the only message is about the PDF.
    const files = [
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => png(`photo-${index}.png`)),
      file('contract.pdf', 'application/pdf'),
    ];
    const result = validateFiles(files);
    expect(result.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('accepts the PNG from a PDF-and-PNG drop and says what was refused', () => {
    const image = png('holiday.png');
    const document = file('contract.pdf', 'application/pdf');
    const result = validateFiles([document, image]);
    expect(result.accepted).toEqual([image]);
    expect(result.rejections).toEqual(new Set(['type']));
    expect(rejectionMessages(result.rejections)).toEqual([
      'Only PNG, JPEG, GIF and WebP images can be added.',
    ]);
  });

  it('reports each kind of refusal once, in one fixed order', () => {
    const files = [
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) => png(`photo-${index}.png`)),
      file('big-1.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1),
      file('big-2.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 2),
      file('contract.pdf', 'application/pdf'),
      file('diagram.svg', 'image/svg+xml'),
    ];
    const result = validateFiles(files);
    expect(result.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections).toEqual(new Set(['count', 'size', 'type']));
    expect(rejectionMessages(result.rejections)).toEqual([
      'Only PNG, JPEG, GIF and WebP images can be added.',
      'Images must be 10 MB or smaller.',
      'Only 20 images can be added at once.',
    ]);
  });

  it('accepts nothing from an empty or absent batch', () => {
    expect(validateFiles([])).toEqual({ accepted: [], rejections: new Set() });
    expect(validateFiles(undefined as unknown as File[])).toEqual({
      accepted: [],
      rejections: new Set(),
    });
  });
});

describe('REJECTION_MESSAGES (the PRD’s own sentences)', () => {
  it('says exactly what the PRD says', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    // The em dash is in the PRD's sentence; an ASCII hyphen would be a different string.
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline \u2014 images can be added when you reconnect.",
    );
  });

  it('quotes the settings rather than repeating their numbers', () => {
    expect(REJECTION_MESSAGES.size).toContain(`${IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
    expect(REJECTION_MESSAGES.count).toContain(`${IMAGE_MAX_FILES_PER_ADD} images`);
  });
});
