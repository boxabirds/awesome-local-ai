import { describe, expect, it } from 'vitest';
import {
  isAcceptedFileSize,
  isAcceptedFileType,
  REJECTION_MESSAGES,
  REJECTION_ORDER,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/**
 * Story 12, image.validation: the first gate is the cheap one, and what it is
 * tested on here is the two boundaries and the order of the three questions.
 *
 * The questions are asked in the order of the story — what it is, how big it is,
 * how many — and the order is not decoration: a 40 MB PDF is the wrong thing, not
 * too big, and the twenty-first file of twenty-one good ones is the only one which
 * is refused for being the twenty-first.
 */

/** A file of `size` bytes under the name and type a browser would report. */
function file(name: string, type: string, size = 8): File {
  const made = new File([new Uint8Array(size)], name, { type });
  if (made.size === size) return made;
  // A File's size is its bytes; declaring one of a given size without keeping
  // ten megabytes of them in memory is the same object as far as this gate can
  // tell, because this gate reads the name, the type and the size and nothing else.
  Object.defineProperty(made, 'size', { value: size });
  return made;
}

const png = (name = 'a.png', size = 8): File => file(name, 'image/png', size);
const jpeg = (name = 'a.jpg', size = 8): File => file(name, 'image/jpeg', size);
const gif = (name = 'a.gif', size = 8): File => file(name, 'image/gif', size);
const webp = (name = 'a.webp', size = 8): File => file(name, 'image/webp', size);
const pdf = (name = 'scan.pdf', size = 8): File => file(name, 'application/pdf', size);
const svg = (name = 'logo.svg', size = 8): File => file(name, 'image/svg+xml', size);
const noType = (name: string): File => file(name, '', 8);

describe('the four types the board keeps', () => {
  it('PNG, JPEG, GIF and WebP are accepted; everything else the browser names is not', () => {
    for (const good of [png(), jpeg(), gif(), webp()]) expect(isAcceptedFileType(good)).toBe(true);
    for (const bad of [pdf(), svg(), noType('notes.txt'), noType('movie.mp4')]) {
      expect(isAcceptedFileType(bad)).toBe(false);
    }
  });

  it('the accepted list is exactly the four, in the order the message says them', () => {
    expect([...IMAGE_ACCEPTED_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  });
});

describe('TC-08: the size line, and which side of it a file is on', () => {
  it('exactly the limit is small enough', () => {
    expect(isAcceptedFileSize(png('big.png', IMAGE_MAX_BYTES))).toBe(true);
  });

  it('one byte over the limit is not', () => {
    expect(isAcceptedFileSize(png('big.png', IMAGE_MAX_BYTES + 1))).toBe(false);
  });

  it('the limit is ten megabytes as the story numbers it', () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('a file at the limit is added, and its neighbour one byte larger is refused for size', () => {
    const result = validateFiles([png('one.png', IMAGE_MAX_BYTES), png('two.png', IMAGE_MAX_BYTES + 1)]);
    expect(result.accepted.map((f) => f.name)).toEqual(['one.png']);
    expect(result.rejections).toEqual(['size']);
  });

  it('a big PDF is refused as the wrong thing, not as too big', () => {
    // The order of the questions: a 40 MB PDF gets the sentence about what may be
    // added, and not the one about size, because the board never asked how big it
    // was — it had already decided.
    const result = validateFiles([pdf('huge.pdf', 40 * 1024 * 1024)]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(['type']);
  });
});

describe('TC-09: the count, the mixed drop, and what is said about each', () => {
  it('twenty files arrive and nothing is complained about', () => {
    const twenty = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, i) => png(`p${i}.png`));
    const result = validateFiles(twenty);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections).toEqual([]);
  });

  it('twenty-one good files keep twenty and say why the rest did not make it', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, i) => png(`p${i}.png`));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted[0]!.name).toBe('p0.png');
    expect(result.accepted.at(-1)!.name).toBe(`p${IMAGE_MAX_FILES_PER_ADD - 1}.png`);
    expect(result.rejections).toEqual(['count']);
  });

  it('a PDF and a PNG keep the PNG, and the PDF is what the message is about', () => {
    const result = validateFiles([pdf(), png()]);
    expect(result.accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(result.rejections).toEqual(['type']);
  });

  it('one drop that is wrong in all three ways is answered in all three ways, in order', () => {
    const many = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 2 }, (_unused, i) => png(`p${i}.png`));
    const result = validateFiles([pdf(), ...many, png('huge.png', IMAGE_MAX_BYTES + 1)]);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections).toEqual(['type', 'size', 'count']);
    expect(REJECTION_ORDER).toEqual(['type', 'size', 'count']);
  });

  it('one reason is said once, whatever the number of files it covers', () => {
    // Forty wrong files are one refusal: a board that answered each file with its
    // own toast would spend the toast host's whole height on the same sentence.
    const result = validateFiles(Array.from({ length: 40 }, (_unused, i) => pdf(`s${i}.pdf`)));
    expect(result.accepted).toEqual([]);
    expect(result.rejections).toEqual(['type']);
  });

  it('nothing dropped is nothing accepted and nothing said', () => {
    expect(validateFiles([])).toEqual({ accepted: [], rejections: [] });
  });

  it('files the browser could not name are refused rather than guessed at', () => {
    // A file dragged out of some apps arrives with an empty type. The bytes would
    // settle it, and this gate does not read bytes — so this gate says no, and the
    // decode step in useImageInsert is where a name with good bytes gets its chance.
    expect(validateFiles([noType('photo.png')]).rejections).toEqual(['type']);
  });
});

describe('the sentences', () => {
  it('each refusal has the PRD’s words, letter for letter', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });

  it('the count sentence agrees with the setting, and the setting is twenty', () => {
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
    expect(REJECTION_MESSAGES.count).toContain(String(IMAGE_MAX_FILES_PER_ADD));
  });

  it('the size sentence agrees with the setting, in the unit a person reads', () => {
    expect(REJECTION_MESSAGES.size).toContain(`${IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
  });
});
