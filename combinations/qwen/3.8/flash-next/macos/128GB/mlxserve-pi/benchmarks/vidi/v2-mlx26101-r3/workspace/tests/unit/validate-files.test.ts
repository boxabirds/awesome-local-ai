/**
 * Story 12, task 1 (TC-08, TC-09): the three rules the board applies to files before any of them is read.
 *
 * These are pure and they are the ones a person feels. A count rule applied before the type rule tells
 * somebody who dropped twenty-two files that they dropped too many when what they dropped was nineteen
 * images and three PDFs; a size rule off by one rejects the largest file the product says it accepts.
 * Neither is a crash, which is why both need a test rather than a glance.
 *
 * The upload itself is not here: `uploadImage` is mocked in the component suite, and whether the worker
 * keeps its promises is the integration suite's business. What is under test is the decision about which
 * files are even candidates, and the sentences said about the rest.
 */
import { describe, expect, it } from 'vitest';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { fileOf, filesOf, jpegBytesOfLength, pdfBytes, pseudorandomBytes, svgBytes } from '../fixtures/imageBytes';

/** A file the board should accept, of `size` bytes, named as a PNG. */
function png(size = 1024, index = 0): File {
  return fileOf(`shot-${index + 1}.png`, pseudorandomBytes(size), 'image/png');
}

/* ------------------------------------------------------------------------------- TC-08 */

describe('validateFiles: the size limit', () => {
  it('accepts a file of exactly the limit', () => {
    // The boundary is "10 MB or smaller", and the message says so. A file of exactly IMAGE_MAX_BYTES is
    // the largest thing this product promises to take, so it is taken.
    const at = fileOf('photo.jpg', jpegBytesOfLength(IMAGE_MAX_BYTES), 'image/jpeg');
    expect(at.size).toBe(IMAGE_MAX_BYTES);
    const result = validateFiles([at]);
    expect(result.accepted).toEqual([at]);
    expect([...result.rejections]).toEqual([]);
  });

  it('rejects a file one byte over the limit, and says which rule it broke', () => {
    const over = fileOf('photo.jpg', jpegBytesOfLength(IMAGE_MAX_BYTES + 1), 'image/jpeg');
    const result = validateFiles([over]);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('says the PRD sentence about a file that is too big', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('rejects only the file that is too big', () => {
    // The rule is per file, and the PRD is explicit that the rest of the drop goes through: "nothing added
    // for that file".
    const good = png();
    const big = fileOf('huge.jpg', jpegBytesOfLength(IMAGE_MAX_BYTES + 1), 'image/jpeg');
    const result = validateFiles([good, big]);
    expect(result.accepted).toEqual([good]);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('takes the size the browser reports, which is the only size it has before uploading', () => {
    // `File.size` is a fact about the file in memory, not a claim from its name, so this gate can be
    // trusted in a way the type check below cannot. A file whose bytes disagree with its size is the
    // worker's problem, and the worker re-checks the byte length it actually received.
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(validateFiles([png(IMAGE_MAX_BYTES)]).accepted).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------------- TC-09 */

describe('validateFiles: the count limit', () => {
  it('accepts the first twenty of twenty-one valid files, in order, and says the rest were skipped', () => {
    // TC-09's case: 21 valid files. The first IMAGE_MAX_FILES_PER_ADD are accepted, in the order they
    // arrived, and the rest are not - and the reason they are not is in the set.
    const files = filesOf('shot', pseudorandomBytes(64), IMAGE_MAX_FILES_PER_ADD + 1);
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('says the PRD sentence about adding too many at once', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
  });

  it('adds nothing for the files past the limit and everything for the files within it', () => {
    // Not a rejection of the drop: the first twenty are added, the twenty-first is skipped. Somebody who
    // means to add forty screenshots adds them in two drops, and the message is what tells them why the
    // board has twenty on it.
    const files = filesOf('shot', pseudorandomBytes(64), IMAGE_MAX_FILES_PER_ADD * 2);
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted.at(-1)).toBe(files[IMAGE_MAX_FILES_PER_ADD - 1]);
  });

  it('says nothing about the count when the count is exactly the limit', () => {
    const result = validateFiles(filesOf('shot', pseudorandomBytes(64), IMAGE_MAX_FILES_PER_ADD));
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect([...result.rejections]).toEqual([]);
  });

  it('counts only the files that could have been added', () => {
    // Nineteen images and three PDFs: twenty-two files, nineteen added, one message - and it is about the
    // type, because nothing was skipped for being twenty-first. The order of the two rules is the whole
    // content of this test.
    const images = filesOf('shot', pseudorandomBytes(64), IMAGE_MAX_FILES_PER_ADD - 1);
    const documents = Array.from({ length: 3 }, (_unused, index) => fileOf(`report-${index + 1}.pdf`, pdfBytes(), 'application/pdf'));
    const result = validateFiles([...images, ...documents]);
    expect(result.accepted).toEqual(images);
    expect(result.rejections.has('count')).toBe(false);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('says both when both are true', () => {
    // Twenty-one images and one PDF: the type rule fires and the count rule fires, and a message that
    // explains only one of them leaves somebody wondering where their twenty-first screenshot went.
    const images = filesOf('shot', pseudorandomBytes(64), IMAGE_MAX_FILES_PER_ADD + 1);
    const result = validateFiles([...images, fileOf('scan.pdf', pdfBytes(), 'application/pdf')]);
    expect(result.accepted).toEqual(images.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections.has('count')).toBe(true);
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('validateFiles: the type limit', () => {
  it('accepts each of the four accepted types', () => {
    const files = IMAGE_ACCEPTED_TYPES.map((type, index) => fileOf(`shot-${index}${extensionOf(type)}`, pseudorandomBytes(32), type));
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files);
    expect([...result.rejections]).toEqual([]);
  });

  it('rejects a PDF and a video and an SVG, and says which rule they broke', () => {
    const files = [
      fileOf('scan.pdf', pdfBytes(), 'application/pdf'),
      fileOf('clip.mp4', pseudorandomBytes(64), 'video/mp4'),
      fileOf('logo.svg', svgBytes(), 'image/svg+xml'),
      fileOf('notes.heic', pseudorandomBytes(64), 'image/heic'),
    ];
    const result = validateFiles(files);
    expect(result.accepted).toEqual([]);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('says the PRD sentence about a file that is not one of the four', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('adds the supported files from a drop that also contained unsupported ones', () => {
    // The case the PRD calls out by name: a mixed drop is not refused as a whole.
    const image = png();
    const result = validateFiles([fileOf('plan.pdf', pdfBytes(), 'application/pdf'), image]);
    expect(result.accepted).toEqual([image]);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('says nothing at all about an empty drop', () => {
    // The empty case is not a rejection: nothing arrived, so there is nothing to explain. A toast for it
    // would be a toast for a drag that passed over the window and never let go of anything.
    const result = validateFiles([]);
    expect(result.accepted).toEqual([]);
    expect([...result.rejections]).toEqual([]);
  });

  it('is the only gate that can be fooled, and knows it', () => {
    // A PDF with a .png name is `image/png` to the browser, so this gate lets it through - which is why
    // the worker reads the bytes and answers 415, and why the client shows the same sentence when it
    // does. What this test pins down is that the weakness is understood rather than accidental: the file
    // is accepted here *because* a File carries a type from its name and nothing else.
    const disguised = fileOf('holiday.png', pdfBytes(), 'image/png');
    expect(validateFiles([disguised]).accepted).toEqual([disguised]);
    // A file that reports no type at all - which is what a File dragged out of some archive tools is - is
    // not accepted on the strength of its name either.
    expect(validateFiles([fileOf('mystery.png', pdfBytes(), '')]).rejections.has('type')).toBe(true);
  });

  it('says the sentence about being offline, which is not about a file at all', () => {
    // Offline is not a FileRejection - the files are fine, the connection is not - but it is the same kind
    // of thing to say, and it belongs in the same object so the two are not worded differently. The PRD's
    // sentence has an em dash in it, and the e2e test asserts the whole string.
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
    expect(Object.keys(REJECTION_MESSAGES).sort()).toEqual(['count', 'offline', 'size', 'type']);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => validateFiles([fileOf('x'.repeat(4096), pseudorandomBytes(8), 'image/png')])).not.toThrow();
    expect(() => validateFiles([png(0)])).not.toThrow();
  });
});

/** The extension a file of this accepted type would normally have. */
function extensionOf(type: (typeof IMAGE_ACCEPTED_TYPES)[number]): string {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[type];
}
