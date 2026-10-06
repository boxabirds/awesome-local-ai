/**
 * Which of these files the board will take (story 12, TC-08, TC-09).
 *
 * Three rules with an order between them, and the order is the interesting part. Type before size, because
 * telling somebody their PDF is too big is a sentence about a file that would not have been added at any
 * size; size before count, because a file that is not going to be stored should not be taking one of the
 * twenty places a batch has. And count measured in *accepted* files rather than in files, because the PRD's
 * limit is "more than 20 **supported** files added in one action" — eight pictures and six PDFs is a batch of
 * eight pictures, and refusing two of the pictures for the PDFs' sake would be a board that damages the work
 * it was asked to do.
 *
 * The size test allocates ten megabytes twice rather than twenty-one times, which is the only compromise in
 * the file: the boundary is what is under test, and a boundary is two points, not a distribution. The count
 * test, which needs twenty-one files, uses twenty-one small ones: the limit counts files and does not care
 * what is in them.
 *
 * One thing this file cannot test is whether the four types are the *right* four, and it does not try:
 * `File.type` is the extension's opinion, and a PDF renamed `.png` walks through this function and is
 * stopped later, by a magic number. That is not a gap, it is the division of labour — see
 * `tests/unit/image-format.test.ts` for the side that reads bytes.
 */

import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  isAcceptedFileType,
  messagesFor,
  rejectionMessages,
  REJECTION_MESSAGES,
  validateFiles,
  type FileRejection,
} from '../../src/client/images/validateFiles';

/** A file the board wants, at whatever size the test needs. */
const image = (name = 'picture.png', type = 'image/png', size = 1024): File =>
  new File([new Uint8Array(size)], name, { type });

/** A file the board does not want, of any size. */
const unwanted = (name: string, type: string, size = 1024): File =>
  new File([new Uint8Array(size)], name, { type });

describe('a file exactly at the size limit is a file the board takes (TC-08)', () => {
  it('accepts one that is exactly ten megabytes', () => {
    const atLimit = image('huge.png', 'image/png', IMAGE_MAX_BYTES);
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    const result = validateFiles([atLimit]);
    expect(result.accepted).toEqual([atLimit]);
    expect(result.rejections.size).toBe(0);
  });

  it('refuses one byte more, and says so in the PRD’s words', () => {
    const over = image('huge.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('size')).toBe(true);
    expect(rejectionMessages(result)).toBe(REJECTION_MESSAGES.size);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('refuses the oversized file and still adds its neighbours', () => {
    // PRD `image.types` for a mixed batch: the good ones arrive whatever the bad ones were doing there.
    const good = [image('a.png'), image('b.jpg', 'image/jpeg')];
    const result = validateFiles([good[0] as File, unwanted('film.mov', 'video/quicktime'), image('big.png', 'image/png', IMAGE_MAX_BYTES + 1), good[1] as File]);
    expect(result.accepted).toEqual(good);
    expect(result.rejections).toEqual(new Set<FileRejection>(['type', 'size']));
  });

  it('names a type problem in preference to a size problem on the same file', () => {
    // A forty-megabyte PDF is not "too big", it is "not an image": being smaller would not have helped it.
    const result = validateFiles([unwanted('spec.pdf', 'application/pdf', IMAGE_MAX_BYTES * 4)]);
    expect([...result.rejections]).toEqual(['type']);
  });

  it('is unbothered by an empty batch', () => {
    const result = validateFiles([]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.size).toBe(0);
    expect(rejectionMessages(result)).toBe('');
  });
});

describe('a batch of more than twenty is cut to twenty (TC-09)', () => {
  it('adds the first twenty of twenty-one and reports the count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      image(`shot-${index}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    // "the first 20", in the order they came: the ones that arrived are the ones that were dropped first.
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections.has('count')).toBe(true);
    expect(rejectionMessages(result)).toBe(REJECTION_MESSAGES.count);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('adds exactly twenty without complaint', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => image(`shot-${index}.png`));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it('counts the files it could have added, not the files that were dropped', () => {
    // Eight pictures and six documents is a batch of eight. The limit is on supported files, so the
    // documents are not in the arithmetic at all — and a person who drops fourteen files of which eight are
    // images should get eight images and no lecture about the limit.
    const pictures = Array.from({ length: 8 }, (_unused, index) => image(`shot-${index}.png`));
    const paperwork = Array.from({ length: 6 }, (_unused, index) => unwanted(`doc-${index}.pdf`, 'application/pdf'));
    const result = validateFiles([...pictures, ...paperwork]);
    expect(result.accepted).toEqual(pictures);
    expect(result.rejections.has('count')).toBe(false);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('names every reason the batch met, in one line, in an order that does not move', () => {
    // Both reasons are true of this batch, and there is one toast. It says both sentences — a toast that
    // mentioned only the PDF would be a toast that had read one file of two — and it says them in a fixed
    // order, kind before size, whatever order the files happened to arrive in. This is the line e2e TC-26
    // asserts, so it is worth pinning here where the string is assembled rather than in the browser.
    const result = validateFiles([
      unwanted('drawing.svg', 'image/svg+xml'),
      image('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
    ]);
    // The set itself keeps the order the reasons were met in, which is a fact about the walk over the list.
    expect(result.rejections).toEqual(new Set<FileRejection>(['type', 'size']));
    expect(rejectionMessages(result)).toBe(`${REJECTION_MESSAGES.type} ${REJECTION_MESSAGES.size}`);
  });

  it('says the reasons in the same order whichever end of the batch they came from', () => {
    // The same two reasons, met in the opposite order: the oversized file first this time. What the person
    // is told cannot depend on the order they happened to select their files in.
    const reversed = validateFiles([
      image('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
      unwanted('drawing.svg', 'image/svg+xml'),
    ]);
    expect([...reversed.rejections]).toEqual(['size', 'type']);
    expect(rejectionMessages(reversed)).toBe(rejectionMessages(
      validateFiles([
        unwanted('drawing.svg', 'image/svg+xml'),
        image('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
      ]),
    ));
  });

  it('says nothing when it has nothing to say, and says a reason it was handed late', () => {
    // `messagesFor` is the same line built from a bare set, for the caller that learns a reason after the
    // walk over the list — the file that would not decode is a type reason, and nothing earlier knew it.
    expect(messagesFor(new Set<FileRejection>([]))).toBe('');
    expect(messagesFor(new Set<FileRejection>(['type']))).toBe(REJECTION_MESSAGES.type);
    expect(messagesFor(new Set<FileRejection>(['count', 'size']))).toBe(
      `${REJECTION_MESSAGES.size} ${REJECTION_MESSAGES.count}`,
    );
  });

  it('adds a PNG dropped next to a PDF, and says what it refused', () => {
    // The PRD's own scenario, line for line.
    const png = image('screenshot.png');
    const pdf = unwanted('report.pdf', 'application/pdf');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toEqual([png]);
    expect(result.rejections).toEqual(new Set<FileRejection>(['type']));
  });
});

describe('the four types are the four the PRD names', () => {
  it('takes each of them and nothing else', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isAcceptedFileType(type)).toBe(true);
      expect(validateFiles([image('f', type)]).accepted).toHaveLength(1);
    }
    for (const type of ['image/svg+xml', 'image/heic', 'video/mp4', 'application/pdf', 'text/plain', '']) {
      expect(isAcceptedFileType(type)).toBe(false);
    }
  });

  it('keeps the order the files came in', () => {
    // Twenty screenshots dropped together become a row, left to right, in the order the person selected
    // them. A batch that arrived shuffled would be a row that tells the story out of order.
    const files = Array.from({ length: 5 }, (_unused, index) => image(`shot-${index}.png`));
    expect(validateFiles(files).accepted).toEqual(files);
  });

  it('says the PRD’s sentences, unchanged', () => {
    // Four strings the PRD specifies word for word, and a test whose only job is to notice the day one of
    // them is reworded by somebody who had not read it. `offline` is here although no file is ever refused
    // for it, because it is raised by the same gesture and belongs with the rest of the wording.
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
