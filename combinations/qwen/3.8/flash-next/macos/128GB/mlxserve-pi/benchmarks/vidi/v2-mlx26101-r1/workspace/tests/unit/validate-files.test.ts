// image.insert unit tests (story 12, TC-08, TC-09).
//
// The gate in front of the network. Nothing in here uploads anything — that is the point: a person
// should be told a file was hopeless before their laptop starts pushing ten megabytes at a server
// that was always going to say no (image.too_large), and a board should never gain an object whose
// bytes were never going to be stored.
//
// What is worth testing is the *combination* rules, not the individual ones. One file that is too
// big is easy; what the PRD actually promises is that a mixed batch still works (image.mixed_batch):
// the good files go through, and each reason for leaving something out is said once. A validator that
// stopped at the first bad file would pass a test of "one bad file is refused" and fail the only
// sentence that matters.
//
// The sizes are the interesting numbers, so they are built from the real fixture: a JPEG padded to
// exactly IMAGE_MAX_BYTES and the same file one byte bigger. "10 MB or smaller" is a boundary, and a
// test that only tries 11 MB has not found out which side of it the code is on.

import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  REJECTION_MESSAGES,
  isAcceptedImageType,
  rejectionMessage,
  validateFiles,
} from '../../src/client/images/validateFiles';
import {
  imageFile,
  manyImageFiles,
  sizeBoundaryFiles,
} from '../fixtures/image-files';

const png = (name = 'a.png'): File => imageFile('swatch-100x100.png', { name });
const pdf = (name = 'plan.pdf'): File => new File([new Uint8Array(8)], name, { type: 'application/pdf' });
const svg = (name = 'logo.svg'): File => new File([new Uint8Array(8)], name, { type: 'image/svg+xml' });
const ofSize = (size: number, name = 'big.png'): File =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

describe('validateFiles: the size boundary (TC-08)', () => {
  it('takes a file of exactly IMAGE_MAX_BYTES and refuses one byte more', () => {
    const { atLimit, overLimit } = sizeBoundaryFiles();
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    expect(overLimit.size).toBe(IMAGE_MAX_BYTES + 1);

    const accepted = validateFiles([atLimit]);
    expect(accepted.accepted).toEqual([atLimit]);
    expect([...accepted.rejections]).toEqual([]);

    const refused = validateFiles([overLimit]);
    expect(refused.accepted).toEqual([]);
    expect([...refused.rejections]).toEqual(['size']);
    expect(rejectionMessage('size')).toBe('Images must be 10 MB or smaller.');
  });

  it('is a byte-level rule, not a megabyte-rounding one', () => {
    expect(validateFiles([ofSize(IMAGE_MAX_BYTES - 1)]).accepted).toHaveLength(1);
    expect(validateFiles([ofSize(IMAGE_MAX_BYTES)]).accepted).toHaveLength(1);
    expect(validateFiles([ofSize(IMAGE_MAX_BYTES + 1)]).accepted).toHaveLength(0);
    expect(validateFiles([ofSize(11 * 1024 * 1024)]).rejections).toEqual(new Set(['size']));
  });

  it('leaves an empty file to the decode step, which is where bytes get looked at', () => {
    // A zero-byte file claims to be a PNG. The size check passes it — it is the decode that will
    // refuse it (image.decode), and that happens later, where the bytes are actually looked at.
    const empty = new File([], 'empty.png', { type: 'image/png' });
    expect(validateFiles([empty]).accepted).toEqual([empty]);
  });
});

describe('validateFiles: the count boundary and a mixed batch (TC-09)', () => {
  it('keeps the first IMAGE_MAX_FILES_PER_ADD files and says why the rest are not there', () => {
    const files = manyImageFiles(IMAGE_MAX_FILES_PER_ADD + 1);
    const plan = validateFiles(files);
    expect(plan.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(plan.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...plan.rejections]).toEqual(['count']);
    expect(rejectionMessage('count')).toBe('Only 20 images can be added at once.');
  });

  it('takes exactly twenty without mentioning a limit at all', () => {
    const plan = validateFiles(manyImageFiles(IMAGE_MAX_FILES_PER_ADD));
    expect(plan.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(plan.rejections.size).toBe(0);
  });

  it('adds the good files from a mixed batch and names each reason once', () => {
    const plan = validateFiles([
      pdf('contract.pdf'),
      png('one.png'),
      svg('logo.svg'),
      ofSize(IMAGE_MAX_BYTES + 1, 'huge.png'),
      png('two.png'),
    ]);
    expect(plan.accepted.map((file) => file.name)).toEqual(['one.png', 'two.png']);
    // Three reasons, in the order they first appeared: a document, a file that is far too big.
    expect([...plan.rejections]).toEqual(['type', 'size']);
    expect(rejectionMessage('type')).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('reports all three reasons when a drop has all three in it', () => {
    const plan = validateFiles([
      ...manyImageFiles(IMAGE_MAX_FILES_PER_ADD),
      ofSize(IMAGE_MAX_BYTES + 1, 'huge.png'),
      pdf('contract.pdf'),
      png('twenty-first.png'),
    ]);
    expect(plan.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect([...plan.rejections].sort()).toEqual(['count', 'size', 'type']);
  });

  it('names the four types it takes, and refuses the ones a board must not carry', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isAcceptedImageType(type)).toBe(true);
    }
    // SVG is the one that matters: it can carry a script, so it is not an image here whatever the
    // browser thinks of it (image.types).
    for (const type of [
      'image/svg+xml',
      'image/heic',
      'image/bmp',
      'image/tiff',
      'video/mp4',
      'application/pdf',
      'text/plain',
      '',
    ]) {
      expect(isAcceptedImageType(type)).toBe(false);
    }
  });

  it('says nothing about nothing', () => {
    expect(validateFiles([])).toEqual({ accepted: [], rejections: new Set() });
  });

  it('keeps every accepted type the board advertises, in the order they were dropped', () => {
    const files = [
      imageFile('screenshot-1440x900.png'),
      imageFile('photo-4032x3024.jpg'),
      imageFile('animation.gif'),
      imageFile('picture.webp'),
    ];
    expect(validateFiles(files).accepted.map((file) => file.type)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);
  });

  it('has a message for every reason it can give, including the offline one', () => {
    const expected: Record<string, string> = {
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    };
    expect(REJECTION_MESSAGES).toEqual(expected);
    for (const reason of ['type', 'size', 'count', 'offline'] as const) {
      expect(rejectionMessage(reason)).toBe(expected[reason]);
    }
  });
});
