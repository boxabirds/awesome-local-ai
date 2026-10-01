// Task 1, cases 08 and 09: the client-side rules a batch of files is checked against, and
// the exact words said about each kind of rejection.
//
// The point of the exact wording is the PRD's: the reasons are not swapped and not counted
// twice. Case 09's mixed batch is the one that catches a careless implementation - a file
// that is too big *and* of the wrong type is two true things about one file, and both are
// said, while ten files that are all the wrong type are said once.

import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  REJECTION_MESSAGES,
  dragCarriesFiles,
  imageFilesOf,
  validateFiles,
} from '../../src/client/images/validateFiles';

function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(Math.min(size, 1024))], name, { type });
}

/** A File whose `size` is the number, without keeping that many bytes in memory. */
function fileOfSize(name: string, type: string, size: number): File {
  const object = file(name, type);
  Object.defineProperty(object, 'size', { value: size });
  return object;
}

function files(count: number, type = 'image/png'): File[] {
  return Array.from({ length: count }, (_unused, index) => file(`photo-${index}.png`, type));
}

describe('08 validateFiles', () => {
  it('accepts the four formats and nothing else', () => {
    const accepted = [
      file('a.png', 'image/png'),
      file('a.jpg', 'image/jpeg'),
      file('a.gif', 'image/gif'),
      file('a.webp', 'image/webp'),
    ];
    const result = validateFiles(accepted);
    expect(result.accepted).toEqual(accepted);
    expect(result.rejections).toEqual([]);
  });

  it('refuses a PDF, whatever its name says', () => {
    const pdf = file('holiday.png', 'application/pdf');
    const result = validateFiles([pdf]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(['type']);
  });

  it('refuses an SVG and a video, though both play in a browser', () => {
    expect(validateFiles([file('a.svg', 'image/svg+xml')]).rejections).toEqual(['type']);
    expect(validateFiles([file('a.mp4', 'video/mp4')]).rejections).toEqual(['type']);
    expect(validateFiles([file('a.heic', 'image/heic')]).rejections).toEqual(['type']);
  });

  it('refuses a file one byte over the limit and takes one exactly at it', () => {
    const exactly = fileOfSize('exactly.png', 'image/png', IMAGE_MAX_BYTES);
    const over = fileOfSize('over.png', 'image/png', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([exactly]).rejections).toEqual([]);
    expect(validateFiles([over]).accepted).toEqual([]);
    expect(validateFiles([over]).rejections).toEqual(['size']);
  });

  it('takes the first twenty of forty and says the count once', () => {
    const batch = files(40);
    const result = validateFiles(batch);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    // the first twenty, in the order they arrived: the ones dropped first are the ones that
    // would be expected to have landed
    expect(result.accepted).toEqual(batch.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections).toEqual(['count']);
  });

  it('twenty is not more than twenty', () => {
    expect(validateFiles(files(IMAGE_MAX_FILES_PER_ADD)).rejections).toEqual([]);
    expect(validateFiles(files(IMAGE_MAX_FILES_PER_ADD)).accepted).toHaveLength(20);
  });

  it('nothing at all is no accepted files and no rejection', () => {
    const result = validateFiles([]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it('a batch of only rejections accepts nothing', () => {
    const result = validateFiles([file('a.pdf', 'application/pdf'), file('b.txt', 'text/plain')]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(['type']);
  });

  it('counting the rest does not hide what the rest were', () => {
    // twenty-one files of which the last is a PDF: the count is said, and so is the PDF - the
    // files that will not be added are still looked at, because a person who dropped them
    // asked about all of them
    const batch = [...files(20), file('a.pdf', 'application/pdf')];
    const result = validateFiles(batch);
    expect(result.rejections).toEqual(['count', 'type']);
    expect(result.accepted).toHaveLength(20);
  });
});

describe('09 one message per reason, all reasons together', () => {
  it('ten files of the wrong type are one message', () => {
    const result = validateFiles(
      Array.from({ length: 10 }, (_unused, index) => file(`doc-${index}.pdf`, 'application/pdf')),
    );
    expect(result.rejections).toEqual(['type']);
  });

  it('a too-big file and a wrong-type file together say both, once each', () => {
    const result = validateFiles([
      fileOfSize('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
      file('wrong.pdf', 'application/pdf'),
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(['type', 'size']);
  });

  it('one file that is both too big and of the wrong type is both reasons', () => {
    const result = validateFiles([fileOfSize('big.pdf', 'application/pdf', IMAGE_MAX_BYTES + 1)]);
    expect(result.rejections).toEqual(['type', 'size']);
  });

  it('too many, too big and wrong type together say all three', () => {
    const batch = [
      ...files(IMAGE_MAX_FILES_PER_ADD),
      fileOfSize('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
      file('wrong.pdf', 'application/pdf'),
      file('one-more.png', 'image/png'),
    ];
    const result = validateFiles(batch);
    expect(result.rejections).toEqual(['count', 'type', 'size']);
  });

  it('the words are the PRD\'s', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });

  it('the settings are the numbers the words quote', () => {
    expect(IMAGE_MAX_BYTES / (1024 * 1024)).toBe(10);
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
  });
});

describe('the files of an event', () => {
  it('reads a FileList and a plain array alike', () => {
    const list = files(2);
    expect(imageFilesOf({ files: list } as unknown as DataTransfer)).toEqual(list);
    const withItem = {
      files: {
        length: 2,
        item: (index: number) => list[index] ?? null,
      },
    };
    expect(imageFilesOf(withItem as unknown as DataTransfer)).toEqual(list);
    expect(imageFilesOf(undefined)).toEqual([]);
    expect(imageFilesOf({ files: [] } as unknown as DataTransfer)).toEqual([]);
  });

  it('only a drag that carries files is a drag onto the board', () => {
    expect(dragCarriesFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(
      dragCarriesFiles({ types: ['Files', 'text/plain'] } as unknown as DataTransfer),
    ).toBe(true);
    // a dragged link, or a dragged selection: the board is not a place to drop those
    expect(dragCarriesFiles({ types: ['text/plain', 'text/html'] } as unknown as DataTransfer)).toBe(
      false,
    );
    expect(dragCarriesFiles({ types: [] } as unknown as DataTransfer)).toBe(false);
    expect(dragCarriesFiles(undefined)).toBe(false);
  });
});
