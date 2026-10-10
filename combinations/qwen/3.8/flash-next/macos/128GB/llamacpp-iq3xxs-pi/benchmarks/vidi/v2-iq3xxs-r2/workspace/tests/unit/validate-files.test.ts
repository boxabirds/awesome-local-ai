/**
 * Story 12, task 1: what the client refuses before it uploads anything (TC-08, TC-09).
 *
 * `validateFiles` is a convenience, not a security boundary — the server re-checks the size
 * and sniffs the bytes — but it is the only thing standing between a person who drags a
 * folder of photos and twenty network round trips that all fail. So the interesting cases
 * are the ones where a batch is *partly* fine: the accepted files must still be added, and
 * the rejected ones must be named in the same breath rather than silently dropped.
 */
import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { fileFor } from '../fixtures/image-files';

/** A PNG of `bytes` bytes, whatever the contents of those bytes are. */
function pngSized(bytes: number, name = 'big.png'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

/** `n` valid PNGs, named so a test can tell which ones were kept. */
function pngs(n: number): File[] {
  return Array.from({ length: n }, (_unused, index) =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], `photo-${index}.png`, { type: 'image/png' }),
  );
}

describe('validateFiles (TC-08)', () => {
  it('accepts the four kinds it serves', () => {
    const files = [
      fileFor('screenshot-1440x900.png'),
      fileFor('photo-4032x3024.jpg'),
      fileFor('animated.gif'),
      fileFor('photo-640x480.webp'),
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted.map((file) => file.name)).toEqual(files.map((file) => file.name));
    expect([...rejections]).toEqual([]);
  });

  it('rejects a file whose type is not one of them, and keeps the rest (TC-09)', () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'contract.pdf', {
      type: 'application/pdf',
    });
    const svg = new File([new TextEncoder().encode('<svg/>')], 'logo.svg', { type: 'image/svg+xml' });
    const png = fileFor('screenshot-900x600.png');

    const { accepted, rejections } = validateFiles([pdf, png, svg]);

    // TC-09: the PNG is still added, and the two rejections are reported as one type message.
    expect(accepted.map((file) => file.name)).toEqual(['screenshot-900x600.png']);
    expect(rejections.has('type')).toBe(true);
  });

  it('rejects a file over the limit at the byte it stops being allowed (TC-08)', () => {
    // Exactly 10 MB is within "up to 10 MB", so it is accepted; one byte more is refused
    // before anything is read from it.
    const exactly = pngSized(IMAGE_MAX_BYTES, 'exactly.png');
    const over = pngSized(IMAGE_MAX_BYTES + 1, 'over.png');
    expect(validateFiles([exactly]).accepted.map((f) => f.name)).toEqual(['exactly.png']);
    expect(validateFiles([exactly]).rejections.size).toBe(0);

    const { accepted, rejections } = validateFiles([over]);
    expect(accepted).toEqual([]);
    expect(rejections.has('size')).toBe(true);
  });

  it('keeps the first files when a batch is too large and reports the rest (TC-08)', () => {
    const files = pngs(IMAGE_MAX_FILES_PER_ADD + 1);
    const { accepted, rejections } = validateFiles(files);
    expect(accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    // The ones that were dropped are named in the message, so a person can drop the rest.
    expect(rejections.has('count')).toBe(true);
    expect(accepted.map((file) => file.name)).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD).map((f) => f.name));
  });

  it('says both things at once when a batch has two problems', () => {
    const files = [fileFor('screenshot-1440x900.png'), new File([new Uint8Array()], 'notes.pdf', {
      type: 'application/pdf',
    }), pngSized(IMAGE_MAX_BYTES + 1, 'huge.png')];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted.map((file) => file.name)).toEqual(['screenshot-1440x900.png']);
    expect([...rejections].sort()).toEqual(['size', 'type']);
  });

  it('reports nothing when there is nothing to report', () => {
    expect(validateFiles([]).rejections.size).toBe(0);
    expect(validateFiles([]).accepted).toEqual([]);
  });
});

describe('rejection messages', () => {
  it('names the formats a person can actually use', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('states the size limit in the units a person thinks in', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('states the batch limit as a number of images, not of files', () => {
    expect(REJECTION_MESSAGES.count).toBe(`Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`);
  });

  it('tells an offline person why nothing arrived', () => {
    // `image.placeholder.upload_state`: "Offline: queued and added on reconnect" is the
    // rejected alternative, so the only honest message is that the image was not added.
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
