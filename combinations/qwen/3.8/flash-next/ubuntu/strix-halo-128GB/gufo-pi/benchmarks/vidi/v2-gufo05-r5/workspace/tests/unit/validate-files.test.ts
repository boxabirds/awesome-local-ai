/**
 * Client-side file validation unit tests (TC-08, TC-09).
 *
 * The three limits a person can hit before anything is uploaded - type, size, count - are decided
 * here so a refused file never crosses the network, and so the wording that explains the refusal is
 * one string in one place. The boundary values are tested exactly: `IMAGE_MAX_BYTES` accepted, one
 * byte more refused, `IMAGE_MAX_FILES_PER_ADD` accepted, one file more truncated with a message.
 */
import { describe, expect, test } from 'vitest';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/** A file as the browser hands one: name, bytes and the type the browser read from it. */
function file(name: string, type: string, size = 64): File {
  return new File([new Uint8Array(size)], name, { type });
}

const png = (name = 'shot.png', size = 64) => file(name, 'image/png', size);

describe('image.size_limit: files are refused before they are uploaded', () => {
  test('TC-08 a file of exactly the limit is accepted', () => {
    const atLimit = png('at-limit.png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([atLimit]);
    expect(accepted).toEqual([atLimit]);
    expect(rejections.size).toBe(0);
  });

  test('TC-08 one byte over the limit is refused with the size message', () => {
    const { accepted, rejections } = validateFiles([png('over.png', IMAGE_MAX_BYTES + 1)]);
    expect(accepted).toEqual([]);
    expect(rejections).toEqual(new Set(['size']));
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  test('a batch keeps the files within the limit and reports the ones that are not', () => {
    const small = png('small.png', 1024);
    const tooBig = file('too-big.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([small, tooBig]);
    expect(accepted).toEqual([small]);
    expect(rejections).toEqual(new Set(['size']));
  });
});

describe('image.types: an unsupported type is refused, supported ones still go through', () => {
  test('TC-09 a PDF mixed in with a PNG: the PNG is added and the type is explained', () => {
    const pdf = file('report.pdf', 'application/pdf');
    const image = png('shot.png');
    const { accepted, rejections } = validateFiles([pdf, image]);
    expect(accepted).toEqual([image]);
    expect(rejections).toEqual(new Set(['type']));
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  test('TC-09 every accepted media type passes', () => {
    const files = IMAGE_ACCEPTED_TYPES.map((type, index) => file(`image-${index}`, type));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toEqual(files);
    expect(rejections.size).toBe(0);
  });

  test('SVG, HEIC and video are all refused with the same message', () => {
    const { accepted, rejections } = validateFiles([
      file('diagram.svg', 'image/svg+xml'),
      file('photo.heic', 'image/heic'),
      file('clip.mp4', 'video/mp4'),
    ]);
    expect(accepted).toEqual([]);
    expect(rejections).toEqual(new Set(['type']));
  });

  test('a file with no type at all is refused rather than guessed', () => {
    const { accepted, rejections } = validateFiles([file('mystery', '')]);
    expect(accepted).toEqual([]);
    expect(rejections).toEqual(new Set(['type']));
  });
});

describe('image.count_limit: one action adds a bounded number of images', () => {
  test('TC-09 the first IMAGE_MAX_FILES_PER_ADD files are added, the rest are skipped with a message', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      png(`shot-${index}.png`),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections).toEqual(new Set(['count']));
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  test('exactly the limit is accepted with nothing to explain', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) =>
      png(`shot-${index}.png`),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.size).toBe(0);
  });

  test('the count applies to supported files: 20 images plus a PDF says type only, not count', () => {
    const files = [
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => png(`shot-${index}.png`)),
      file('report.pdf', 'application/pdf'),
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toEqual(new Set(['type']));
  });

  test('a file that fails two rules reports both messages', () => {
    const { rejections } = validateFiles([file('huge.pdf', 'application/pdf', IMAGE_MAX_BYTES + 1)]);
    expect(rejections).toEqual(new Set(['type', 'size']));
  });

  test('nothing at all is accepted from an empty drop, with nothing to explain', () => {
    const { accepted, rejections } = validateFiles([]);
    expect(accepted).toEqual([]);
    expect(rejections.size).toBe(0);
  });
});

describe('image.offline: the offline wording is the PRD’s', () => {
  test('one message, shown whatever the entry point was', () => {
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline \u2014 images can be added when you reconnect.",
    );
  });
});
