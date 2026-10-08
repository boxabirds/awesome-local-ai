import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { fixtureBytes, fixtureFile, paddedJpeg } from '../fixtures/images';

/**
 * Story 12 — the browser's own say on a batch of files (image.insert).
 *
 * Nothing here uploads anything: it decides, from `File.type` and `File.size`, what
 * would be worth uploading, and which of the PRD's three messages the person gets
 * told. The server decides again later from the bytes; both decisions have to be the
 * same, or a refused file would still travel across the network.
 */

const png = (name: string, bytes = 1024) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

describe('validateFiles (image.types, image.size_limit, image.count_limit)', () => {
  // TC-08: the size limit is a limit *and* it is inclusive.
  it('TC-08 accepts a file of exactly IMAGE_MAX_BYTES and refuses one byte more', async () => {
    const jpeg = await fixtureBytes('photo.jpg');
    const at = fileLike('huge.jpg', 'image/jpeg', paddedJpeg(jpeg, IMAGE_MAX_BYTES));
    const over = fileLike('over.jpg', 'image/jpeg', paddedJpeg(jpeg, IMAGE_MAX_BYTES + 1));

    const acceptedAt = validateFiles([at]);
    expect(acceptedAt.accepted).toEqual([at]);
    expect(acceptedAt.rejections.size).toBe(0);

    const acceptedOver = validateFiles([over]);
    expect(acceptedOver.accepted).toEqual([]);
    expect(acceptedOver.rejections).toEqual(new Set(['size']));
  });

  // TC-09: the count limit keeps the first N and says so; a wrong type costs only itself.
  it('TC-09 keeps the first IMAGE_MAX_FILES_PER_ADD files and reports the count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => png(`p${i}.png`));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted[0]).toBe(files[0]);
    expect(accepted[IMAGE_MAX_FILES_PER_ADD - 1]).toBe(files[IMAGE_MAX_FILES_PER_ADD - 1]);
    expect(rejections).toEqual(new Set(['count']));
  });

  it('TC-09 adds the supported file from a mixed batch and reports the type', async () => {
    const notAnImage = await fixtureFile('document.pdf');
    const supported = await fixtureFile('photo.png');
    const { accepted, rejections } = validateFiles([notAnImage, supported]);
    expect(accepted.map((f) => f.name)).toEqual(['photo.png']);
    expect(rejections).toEqual(new Set(['type']));
  });

  it('lets a PDF wearing a .png name through, because the browser believes names', async () => {
    // The client's `File.type` check cannot see through this one, so the bytes decide
    // and the server's 415 answers instead — with the same message (PRD image.types).
    const disguised = await fixtureFile('fake.png');
    expect(disguised.name).toBe('fake.png');
    expect(disguised.type).toBe('image/png');
    const { accepted } = validateFiles([disguised]);
    expect(accepted).toHaveLength(1);
  });

  it('reports every kind of refusal a batch can cause, once each', async () => {
    const files = [
      await fixtureFile('script.svg'),
      new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' }),
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 2 }, (_, i) => png(`p${i}.png`)),
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections).toEqual(new Set(['type', 'size', 'count']));
  });

  it('accepts each supported type and nothing else', async () => {
    const files = await Promise.all([
      fixtureFile('photo.png'),
      fixtureFile('photo.jpg'),
      fixtureFile('photo.webp'),
      fixtureFile('animated.gif'),
      fixtureFile('document.pdf'),
      fixtureFile('script.svg'),
    ]);
    const { accepted, rejections } = validateFiles(files);
    expect(accepted.map((f) => f.name)).toEqual(['photo.png', 'photo.jpg', 'photo.webp', 'animated.gif']);
    expect(rejections).toEqual(new Set(['type']));
  });

  it('an empty batch rejects nothing, because nothing was refused', () => {
    expect(validateFiles([])).toEqual({ accepted: [], rejections: new Set() });
  });
});

describe('REJECTION_MESSAGES (PRD wording)', () => {
  // The PRD's exact sentences, because they are what the person is promised.
  it('says exactly what the PRD says', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });

  it('names the limits it enforces, taken from the settings themselves', () => {
    expect(REJECTION_MESSAGES.size).toContain(`${IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
    expect(REJECTION_MESSAGES.count).toContain(`${IMAGE_MAX_FILES_PER_ADD}`);
  });
});

/** A fixture's bytes wearing another name and type. */
function fileLike(name: string, type: string, bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], name, { type });
}
