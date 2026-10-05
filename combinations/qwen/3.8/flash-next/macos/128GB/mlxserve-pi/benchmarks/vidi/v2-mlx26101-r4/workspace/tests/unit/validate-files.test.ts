/**
 * Story 12 — which files the board takes (TC-08, TC-09).
 *
 * `validateFiles` is the whole of the board's answer to a person dropping twenty-one files, four of which
 * are PDFs: which ones does it take, and what does it say about the rest. There is deliberately nothing else
 * in it — no reading of bytes (the server sniffs those), no decoding (the insert gets the dimensions from
 * that), no uploading. It is a decision about a list of files and nothing else, which is why it can be tested
 * with files that are not pictures at all.
 *
 * What it must never do is the point:
 *  - never accept an unsupported type (TC-08) — a PDF renamed `.png` has a `File.type` of `application/pdf`
 *    and the board does not care what the name says;
 *  - never accept an oversize file, and never refuse one that is exactly at the limit (TC-08);
 *  - never silently lose a file: 21 supported files are twenty added and one said out loud (TC-09), because a
 *    person who dropped twenty-one and sees twenty has to be told which twenty-one happened.
 */
import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from '../../src/client/images/validateFiles';

/** A file as the browser hands one over: bytes, a name, and the type the browser worked out. */
function file(name: string, type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const PNG = file('shot.png', 'image/png');
const JPEG = file('photo.jpg', 'image/jpeg');
const GIF = file('animation.gif', 'image/gif');
const WEBP = file('picture.webp', 'image/webp');

/** A file of `bytes` bytes, for testing the limit at its edges. */
function sized(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('validating dropped files', () => {
  it('TC-08: accepts one of each supported type', () => {
    for (const f of [PNG, JPEG, GIF, WEBP]) {
      expect(validateFiles([f])).toEqual({ accepted: [f], rejections: new Set<FileRejection>() });
    }
  });

  it('TC-08: refuses a file of an unsupported type, whatever its name says', () => {
    const pdf = file('contract.pdf', 'application/pdf');
    const pdfNamedAsAPng = file('screenshot.png', 'application/pdf');
    const svg = file('logo.svg', 'image/svg+xml');
    const text = file('notes.txt', 'text/plain');
    const noTypeAtAll = file('mystery', '');

    const { accepted, rejections } = validateFiles([pdf, pdfNamedAsAPng, svg, text, noTypeAtAll]);

    expect(accepted).toEqual([]);
    expect(rejections).toEqual(new Set<FileRejection>(['type']));
  });

  it('TC-08: keeps the files it can use out of a mixed drop and says what it threw away', () => {
    const pdf = file('contract.pdf', 'application/pdf');

    const { accepted, rejections } = validateFiles([pdf, PNG]);

    expect(accepted).toEqual([PNG]);
    expect(rejections).toEqual(new Set<FileRejection>(['type']));
  });

  it('TC-08: refuses a file heavier than the limit and accepts one exactly at it', () => {
    const atTheLimit = sized('exactly.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const oneByteOver = sized('over.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);

    expect(validateFiles([atTheLimit])).toEqual({ accepted: [atTheLimit], rejections: new Set<FileRejection>() });
    expect(validateFiles([oneByteOver])).toEqual({ accepted: [], rejections: new Set<FileRejection>(['size']) });
  });

  it('TC-08: reports the kinds it hit, once each, whatever the order they came in', () => {
    const tooBig = sized('huge.png', 'image/png', IMAGE_MAX_BYTES + 1000);
    const { accepted, rejections } = validateFiles([PNG, tooBig, file('doc.pdf', 'application/pdf')]);

    expect(accepted).toEqual([PNG]);
    // Both went wrong, and both are said — but a person needs to be told *that* two of the four files went
    // wrong and why, not shown three lines about one file each.
    expect(rejections).toEqual(new Set<FileRejection>(['size', 'type']));
  });

  it('TC-09: takes the first twenty of twenty-one supported files and says the rest were skipped', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      file(`shot-${index}.png`, 'image/png'),
    );

    const { accepted, rejections } = validateFiles(files);

    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections).toEqual(new Set<FileRejection>(['count']));
  });

  it('TC-09: counts the limit against the files it could use, not against the ones it could not', () => {
    // Twenty pictures and a PDF: the PDF was never going to be one of the twenty, so nobody loses an image.
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) =>
      file(`shot-${index}.png`, 'image/png'),
    );

    expect(validateFiles([...files, file('doc.pdf', 'application/pdf')])).toEqual({
      accepted: files,
      rejections: new Set<FileRejection>(['type']),
    });

    // Twenty-one pictures and a PDF: the twentieth image is still the last one in, and both goings-wrong are said.
    const oneTooMany = [...files, file('shot-20.png', 'image/png'), file('doc.pdf', 'application/pdf')];
    const { accepted, rejections } = validateFiles(oneTooMany);
    expect(accepted).toEqual(files);
    expect(rejections).toEqual(new Set<FileRejection>(['count', 'type']));
  });

  it('TC-09: says nothing when there is nothing to say', () => {
    expect(validateFiles([])).toEqual({ accepted: [], rejections: new Set<FileRejection>() });
  });

  it('TC-08/TC-09: every rejection has a sentence for the person who caused it', () => {
    // The wording is what the tests and the toast agree on; the PRD's own wording is what they agree to.
    expect(REJECTION_MESSAGES.type).toMatch(/PNG.*JPEG.*GIF.*WebP/);
    expect(REJECTION_MESSAGES.size).toContain('10 MB');
    expect(REJECTION_MESSAGES.count).toContain(String(IMAGE_MAX_FILES_PER_ADD));
    for (const rejection of ['type', 'size', 'count'] satisfies FileRejection[]) {
      expect(REJECTION_MESSAGES[rejection].length).toBeGreaterThan(0);
    }
  });
});
