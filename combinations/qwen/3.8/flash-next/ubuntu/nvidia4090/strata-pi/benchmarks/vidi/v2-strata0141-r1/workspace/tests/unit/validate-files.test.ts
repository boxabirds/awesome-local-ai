import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { fileOf, jpegAtLimit, jpegOverLimit } from '../fixtures/oversizeImage';

/**
 * Unit tests for the client-side file gate (anchor `images.validation`).
 *
 * TC-08 which files may be added, TC-09 what the person is told instead.
 * `validateFiles` decides before anything is written to the document or uploaded,
 * and its answer is always "these files, and these reasons for the others". The
 * bytes are real fixtures; the names and the claimed MIME types are the lies this
 * gate has to ignore.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/images/', import.meta.url));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(`${FIXTURES}${name}`));

const pngs = (count: number): File[] =>
  Array.from({ length: count }, (_, index) =>
    fileOf(`photo-${index}.png`, fixture('photo.png'), 'image/png'),
  );

describe('images.validation - what a file may be (TC-08)', () => {
  // TC-08
  it('TC-08 real images are accepted with no rejection', async () => {
    for (const [name, type] of [
      ['photo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo-large.jpg', 'image/jpeg'],
      ['photo.webp', 'image/webp'],
      ['animated.gif', 'image/gif'],
    ] as const) {
      const { accepted, rejections } = await validateFiles([fileOf(name, fixture(name), type)]);
      expect(rejections, `${name} should be accepted`).toEqual([]);
      expect(accepted, `${name} should be accepted`).toHaveLength(1);
    }
  });

  // TC-08: a PDF named .png is refused by its content.
  it('TC-08 a file named and typed as a PNG that is really a PDF is rejected as a type problem', async () => {
    const file = fileOf('not-an-image.png', fixture('not-an-image.png'), 'image/png');
    const { accepted, rejections, reasons } = await validateFiles([file]);
    expect(accepted).toEqual([]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.reason).toBe('type');
    expect(rejections[0]!.file).toBe(file);
    expect(rejections[0]!.message).toBe(REJECTION_MESSAGES.type);
    expect([...reasons]).toEqual(['type']);
  });

  // TC-08: SVG is refused, whatever it is named (PRD: no vector formats).
  it('TC-08 an SVG is rejected even when its bytes are perfectly readable', async () => {
    const { accepted, rejections } = await validateFiles([
      fileOf('drawing.svg', fixture('drawing.svg'), 'image/svg+xml'),
    ]);
    expect(accepted).toEqual([]);
    expect(rejections[0]?.reason).toBe('type');
  });

  // TC-08: a real JPEG named .txt gets in - the name decides nothing.
  it('TC-08 a real JPEG named .txt is accepted', async () => {
    const file = fileOf('photo.txt', fixture('photo.jpg'), '');
    const { accepted, rejections } = await validateFiles([file]);
    expect(rejections).toEqual([]);
    expect(accepted).toEqual([file]);
  });

  // TC-08 boundary: a truncated PNG is still a PNG up front, so this gate lets it
  // through and `createImageBitmap` is what refuses it (TC-29).
  it('TC-08 a truncated PNG is accepted on its header, because only half a file is read', async () => {
    const { accepted, rejections } = await validateFiles([
      fileOf('broken.png', fixture('truncated.png')),
    ]);
    expect(rejections).toEqual([]);
    expect(accepted).toHaveLength(1);
  });

  // TC-08
  it('TC-08 an empty file is rejected as a type problem', async () => {
    const { accepted, rejections } = await validateFiles([
      fileOf('empty.png', new Uint8Array(0), 'image/png'),
    ]);
    expect(accepted).toEqual([]);
    expect(rejections[0]?.reason).toBe('type');
  });

  // TC-08 boundary: 20 in, 21 offered.
  it('TC-08 more than IMAGE_MAX_FILES_PER_ADD files in one add rejects the extras', async () => {
    const files = pngs(IMAGE_MAX_FILES_PER_ADD + 1);
    const { accepted, rejections } = await validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toHaveLength(1);
    expect(rejections.every((rejection) => rejection.reason === 'count')).toBe(true);
    expect(rejections.map((rejection) => rejection.file)).toEqual(
      files.slice(IMAGE_MAX_FILES_PER_ADD),
    );
  });

  it('TC-08 exactly IMAGE_MAX_FILES_PER_ADD files are all accepted', async () => {
    const { accepted, rejections } = await validateFiles(pngs(IMAGE_MAX_FILES_PER_ADD));
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toEqual([]);
  });

  it('TC-08 nothing at all is nothing to insert', async () => {
    const { accepted, rejections, reasons } = await validateFiles([]);
    expect(accepted).toEqual([]);
    expect(rejections).toEqual([]);
    expect(reasons.size).toBe(0);
  });

  // TC-08 boundary: exactly 10 MB is accepted, 10 MB + 1 is not.
  it('TC-08 size is measured in bytes and 10 MB is the accepted side of the boundary', async () => {
    const atLimit = fileOf('exact.png', jpegAtLimit(), 'image/png');
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    const accepted = await validateFiles([atLimit]);
    expect(accepted.rejections).toEqual([]);
    expect(accepted.accepted).toEqual([atLimit]);

    const over = fileOf('over.png', jpegOverLimit(), 'image/png');
    expect(over.size).toBe(IMAGE_MAX_BYTES + 1);
    const refused = await validateFiles([over]);
    expect(refused.accepted).toEqual([]);
    expect(refused.rejections[0]?.reason).toBe('size');
  });

  // TC-08: an oversized file named .txt still gets the size reason, not the type one.
  it('TC-08 an oversized file named .txt is rejected on size, not on its name', async () => {
    const { rejections } = await validateFiles([fileOf('huge.txt', jpegOverLimit(), '')]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toBe('size');
  });

  it('TC-08 the size rule runs before the type rule on a file that fails both', async () => {
    const { rejections } = await validateFiles([
      fileOf('huge.txt', new Uint8Array(IMAGE_MAX_BYTES + 1).fill(0x25), 'text/plain'),
    ]);
    expect(rejections[0]?.reason).toBe('size');
  });

  it('TC-08 the count rule counts accepted files, not files offered', async () => {
    // A file that is refused for its content does not use up one of the 20 places:
    // 21 files here are 1 PDF and 20 PNGs, and all 20 PNGs get in.
    const files = [fileOf('pdf.png', fixture('not-an-image.png'), 'image/png'), ...pngs(IMAGE_MAX_FILES_PER_ADD)];
    const { accepted, rejections } = await validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toBe('type');
  });
});

describe('images.validation - what a person is told (TC-09)', () => {
  // TC-09
  it('TC-09 the rejection messages are the product wording, keyed by reason', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });

  // TC-09 boundary: every reason the gate can answer has a message.
  it('TC-09 every rejection reason carries its message on the rejection itself', async () => {
    const many = await validateFiles(pngs(IMAGE_MAX_FILES_PER_ADD + 2));
    const notImage = await validateFiles([
      fileOf('not-an-image.png', fixture('not-an-image.png'), 'image/png'),
    ]);
    const tooBig = await validateFiles([fileOf('huge.png', jpegOverLimit(), 'image/png')]);
    const rejections = [...many.rejections, ...notImage.rejections, ...tooBig.rejections];

    expect(rejections.map((rejection) => rejection.reason).sort()).toEqual([
      'count',
      'count',
      'size',
      'type',
    ]);
    for (const rejection of rejections) {
      expect(REJECTION_MESSAGES[rejection.reason]).toBe(rejection.message);
      expect(rejection.message.length).toBeGreaterThan(0);
    }
  });

  it('TC-09 the picker accepts the same formats the gate sniffs', () => {
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe('image/png,image/jpeg,image/gif,image/webp');
  });
});
