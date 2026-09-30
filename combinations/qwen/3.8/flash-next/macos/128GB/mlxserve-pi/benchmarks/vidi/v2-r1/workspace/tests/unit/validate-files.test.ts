// The client's own file check, before a byte is uploaded (`image.insert`,
// TC-08, TC-09).
//
// `validateFiles` is pure — a list of `File`s in, the files to keep and the reasons
// some were refused out — so the three product limits (accepted type, 10 MB size,
// 20-per-action count) are tested against their exact boundary values here, with no
// upload, no document and no browser image decoder. The boundary is the point: a file
// of exactly IMAGE_MAX_BYTES is accepted and IMAGE_MAX_BYTES + 1 is refused (PRD
// `image.size_limit`), and the count message is about the *supported* files that
// survived, not the raw drop.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images" — Tests.
import { describe, expect, it } from 'vitest';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  exactlyAtLimitPng,
  fileFrom,
  jpegBytes,
  oneOverLimitPng,
  pdfBytes,
  pngBytes,
} from '../fixtures/image-fixtures';

const png = (name = 'a.png', bytes = pngBytes(64)): File =>
  fileFrom(name, 'image/png', bytes);
const jpeg = (name = 'a.jpg', bytes = jpegBytes(64)): File =>
  fileFrom(name, 'image/jpeg', bytes);

describe('validateFiles size limit (image.size_limit, TC-08)', () => {
  // TC-08: exactly the limit is accepted; one byte over is refused with 'size'.
  it('accepts a file of exactly IMAGE_MAX_BYTES and refuses one over', () => {
    const atLimit = fileFrom('at-limit.png', 'image/png', exactlyAtLimitPng());
    const over = fileFrom('over.png', 'image/png', oneOverLimitPng());

    const accepted = validateFiles([atLimit]);
    expect(accepted.accepted).toEqual([atLimit]);
    expect(accepted.rejections.size).toBe(0);

    const refused = validateFiles([over]);
    expect(refused.accepted).toEqual([]);
    expect(refused.rejections.has('size')).toBe(true);
  });

  // A refusal is per file: an over-large file in a batch does not stop its small
  // companions from being added (PRD: "still adding any supported files").
  it('keeps the good files of a batch a size refusal touched', () => {
    const over = fileFrom('over.jpg', 'image/jpeg', oneOverLimitPng());
    const result = validateFiles([png('good.png'), over]);
    expect(result.accepted.map((file) => file.name)).toEqual(['good.png']);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('validateFiles type and count limits (image.types, image.count_limit, TC-09)', () => {
  // TC-09: 21 supported files keep the first 20 and report the count.
  it('adds only the first IMAGE_MAX_FILES_PER_ADD and reports the count', () => {
    const many = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      png(`image-${index}.png`),
    );
    const result = validateFiles(many);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted).toEqual(many.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections.has('count')).toBe(true);
  });

  // TC-09: a PDF renamed to `.png` is refused on its type; the PNG survives.
  it('refuses a file whose own type is unsupported and still adds the rest', () => {
    // `File.type` is what the browser was told the file is; a PDF says `application/pdf`,
    // which is not an accepted image type, so it is refused here — before the server's
    // byte-sniffing refuses the same file again (image.types is enforced in three places).
    const disguised = fileFrom('renamed.png', 'application/pdf', pdfBytes(64));
    const svg = fileFrom('carries-script.svg', 'image/svg+xml', svgBytesForTest());
    const result = validateFiles([disguised, png('good.png'), svg]);

    expect(result.accepted.map((file) => file.name)).toEqual(['good.png']);
    expect(result.rejections.has('type')).toBe(true);
    // One 'type' reason covers both bad files: one toast, not two.
    expect(result.rejections.has('size')).toBe(false);
    expect(result.rejections.has('count')).toBe(false);
  });

  // A JPEG and a PNG both being supported are both kept, in the order they came.
  it('keeps every accepted type it is given, in order', () => {
    const result = validateFiles([png('a.png'), jpeg('b.jpg')]);
    expect(result.accepted.map((file) => file.name)).toEqual(['a.png', 'b.jpg']);
    expect(result.rejections.size).toBe(0);
  });

  // The count limit is about the supported survivors: 20 real images plus one PDF is
  // exactly at the limit and says nothing about a count.
  it('counts only supported files towards the limit', () => {
    const supported = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_u, i) =>
      png(`ok-${i}.png`),
    );
    const bad = fileFrom('nope.pdf', 'application/pdf', pdfBytes(32));
    const result = validateFiles([...supported, bad]);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    // The refusal is a type one, not a count one: the 20 that survived *are* the limit.
    expect(result.rejections.has('count')).toBe(false);
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES (exact PRD wording)', () => {
  // The wording is a product promise, so it is asserted here rather than eyeballed.
  it('holds the exact strings the PRD specifies', () => {
    expect(REJECTION_MESSAGES.type).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });

  // The numbers in the messages come from the named settings, so they track them.
  it('states the numbers the settings carry', () => {
    expect(REJECTION_MESSAGES.size).toContain(String(IMAGE_MAX_BYTES / (1024 * 1024)));
    expect(REJECTION_MESSAGES.count).toContain(String(IMAGE_MAX_FILES_PER_ADD));
  });
});

/** A tiny SVG body, only its `File.type` matters to this test. */
function svgBytesForTest(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}
