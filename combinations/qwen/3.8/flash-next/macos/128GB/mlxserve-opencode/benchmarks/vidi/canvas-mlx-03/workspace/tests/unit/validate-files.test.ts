// Story 12, task 1 — the client's decision about a pile of files.
//
// Three limits and one judgement run here: is it an image, is it small enough, are there too
// many of them. The judgement is the interesting one, because the file's own report of what
// it is — `File.type` — comes from the operating system's idea of its extension, and a file
// that lies about being a PNG is the case the PRD names. So this half of the check reads the
// name, then the length, then the bytes; and it is the only half that can tell a real photo
// from a photo-shaped file, because it is the only half with an image decoder in front of it.
//
// TC-08, TC-09.
import { describe, expect, it, vi } from 'vitest';
import {
  REJECTION_MESSAGES,
  KNOWN_NON_IMAGE_EXTENSIONS,
  KNOWN_NON_IMAGE_TYPES,
  UNCLAIMED_FILE_TYPES,
  defaultContentCheck,
  validateFiles,
} from '../../src/client/images/validateFiles.ts';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config.ts';
import { imageBytes, imageFile, oversizedImageFile } from '../fixtures/images/files.ts';
import { sniffImageType } from '../../src/shared/image-format.ts';

/**
 * A file that reports a size it does not hold bytes for. Only `name`, `type` and `size` are
 * read of it by the rules under test; allocating a gigabyte to find out that a rule is about
 * length would make the test slow for a reason it is not testing.
 */
function fileClaiming(name: string, type: string, size: number): File {
  const empty = new Uint8Array(0);
  return {
    name,
    type,
    size,
    arrayBuffer: async () => empty.buffer as ArrayBuffer,
    slice: () => new Blob([]),
  } as unknown as File;
}

const acceptedOf = (result: { accepted: File[] }) => result.accepted.map((f) => f.name);
const rejectedOf = (result: { rejected: { file: File; reason: string }[] }) =>
  result.rejected.map((r) => `${r.file.name}:${r.reason}`);

/** A content check that reads the signature and asks nothing else of the file. */
const sniffOnly = async (bytes: Uint8Array) => sniffImageType(bytes) !== null;

describe('validateFiles: the four kinds of file', () => {
  it('accepts the four image formats, and only them', async () => {
    const files = [
      imageFile('png-1440x900', 'screenshot.png'),
      imageFile('jpeg-4032x3024', 'photo.jpg'),
      imageFile('gif-animated', 'logo.gif'),
      imageFile('webp-640x480', 'still.webp'),
    ];
    const result = await validateFiles(files, sniffOnly);
    expect(acceptedOf(result)).toEqual(['screenshot.png', 'photo.jpg', 'logo.gif', 'still.webp']);
    expect(result.rejected).toEqual([]);
    // The Files it hands back are the ones it was given: an upload sends the file, not a copy.
    expect(result.accepted[0]).toBe(files[0]);
  });

  it('refuses a PDF by its type, without reading its bytes', async () => {
    const read = vi.fn(async (_bytes: Uint8Array) => true);
    const result = await validateFiles([imageFile('pdf', 'contract.pdf')], read);
    expect(rejectedOf(result)).toEqual(['contract.pdf:type']);
    expect(result.accepted).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses the formats the PRD calls out by name', async () => {
    const names = [
      'diagram.svg',
      'photo.heic',
      'clip.mp4',
      'icon.ico',
      'archive.zip',
      'note.txt',
      'sheet.csv',
    ];
    const result = await validateFiles(names.map((name) => fileClaiming(name, '', 100)), sniffOnly);
    expect(rejectedOf(result).sort()).toEqual([...names].sort().map((n) => `${n}:type`));
  });

  it('refuses a type it knows is not an image, whatever the name says', async () => {
    const result = await validateFiles(
      [
        fileClaiming('photo.jpg', 'image/svg+xml', 100),
        fileClaiming('diagram.png', 'text/html', 100),
        fileClaiming('slide.webp', 'video/webm', 100),
      ],
      sniffOnly,
    );
    expect(rejectedOf(result)).toEqual(['photo.jpg:type', 'diagram.png:type', 'slide.webp:type']);
  });

  it('takes a file that reports no type at all on its bytes, not its name', async () => {
    // The drop a browser hands over when it does not know: a PNG whose `type` is empty. The
    // absence of a claim is not a refusal; the content is the rule.
    const honest = imageFile('png-24', 'untitled', '');
    const liar = imageFile('pdf', 'photo.png', '');
    const result = await validateFiles([honest, liar], sniffOnly);
    expect(acceptedOf(result)).toEqual(['untitled']);
    expect(rejectedOf(result)).toEqual(['photo.png:undecodable']);
  });

  it('treats a claim it has never heard of exactly like no claim at all', async () => {
    // Neither evidence of being an image nor of not being one, so neither a refusal nor an
    // acceptance: it goes to the bytes.
    const real = await validateFiles(
      [imageFile('gif-animated', 'thing.weirdtype', 'application/x-never-heard-of-it')],
      sniffOnly,
    );
    expect(acceptedOf(real)).toEqual(['thing.weirdtype']);

    const fake = await validateFiles(
      [imageFile('pdf', 'other.weirdtype', 'application/x-never-heard-of-it')],
      sniffOnly,
    );
    expect(rejectedOf(fake)).toEqual(['other.weirdtype:undecodable']);
  });

  it('adds the supported files of a mixed drop and refuses the rest', async () => {
    // The PRD's alternate flow, in one call: the good ones are still added.
    const files = [
      imageFile('png-24', 'shot.png'),
      imageFile('pdf', 'contract.pdf'),
      imageFile('jpeg-24', 'photo.jpg'),
      fileClaiming('clip.mp4', 'video/mp4', 100),
    ];
    const result = await validateFiles(files, sniffOnly);
    expect(acceptedOf(result)).toEqual(['shot.png', 'photo.jpg']);
    expect(rejectedOf(result)).toEqual(['contract.pdf:type', 'clip.mp4:type']);
  });
});

describe('validateFiles: the count limit', () => {
  it('keeps the first twenty and rejects the rest as too many', async () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 5 }, (_, i) =>
      imageFile('png-24', `shot-${String(i + 1).padStart(2, '0')}.png`),
    );
    const result = await validateFiles(files, sniffOnly);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(acceptedOf(result)[0]).toBe('shot-01.png');
    expect(acceptedOf(result)[IMAGE_MAX_FILES_PER_ADD - 1]).toBe('shot-20.png');
    expect(rejectedOf(result)).toEqual([
      'shot-21.png:count',
      'shot-22.png:count',
      'shot-23.png:count',
      'shot-24.png:count',
      'shot-25.png:count',
    ]);
  });

  it('says too many about the twenty-first file even when it is also the wrong kind', async () => {
    // The count is positional and known first; what the extra file *is* would need reading it.
    const files = [
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => imageFile('png-24', `f${i}.png`)),
      imageFile('pdf', 'contract.pdf'),
      fileClaiming('huge.png', 'image/png', IMAGE_MAX_BYTES + 1),
    ];
    const result = await validateFiles(files, sniffOnly);
    expect(rejectedOf(result)).toEqual(['contract.pdf:count', 'huge.png:count']);
  });

  it('accepts exactly twenty and refuses the twenty-first', async () => {
    const exactly = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) =>
      imageFile('png-24', `f${i}.png`),
    );
    expect((await validateFiles(exactly, sniffOnly)).rejected).toEqual([]);
    const oneMore = await validateFiles([...exactly, imageFile('png-24', 'one-more.png')], sniffOnly);
    expect(rejectedOf(oneMore)).toEqual(['one-more.png:count']);
  });
});

describe('validateFiles: the size limit', () => {
  it('refuses a file bigger than the limit without reading it', async () => {
    const read = vi.fn(async (_bytes: Uint8Array) => true);
    const result = await validateFiles(
      [fileClaiming('huge.png', 'image/png', IMAGE_MAX_BYTES + 1)],
      read,
    );
    expect(rejectedOf(result)).toEqual(['huge.png:size']);
    expect(read).not.toHaveBeenCalled();
  });

  it('accepts a real image of exactly the limit', async () => {
    // "more than 10 MB" is the rule, so 10 MB itself is allowed. The assertion is a byte
    // comparison, so the file is real bytes of exactly that length.
    const atLimit = oversizedImageFile(IMAGE_MAX_BYTES, 'big.jpg');
    expect(atLimit.size).toBe(IMAGE_MAX_BYTES);
    const result = await validateFiles([atLimit], defaultContentCheck);
    expect(acceptedOf(result)).toEqual(['big.jpg']);
  });

  it('reports the size of an oversized file it would also have refused for its content', async () => {
    // Same file, two rules that would catch it: the cheap one (length) runs first, and the
    // message a user is given is the one they can act on.
    const read = vi.fn(async (_bytes: Uint8Array) => false);
    const result = await validateFiles(
      [fileClaiming('not-an-image.png', 'image/png', IMAGE_MAX_BYTES + 1)],
      read,
    );
    expect(rejectedOf(result)).toEqual(['not-an-image.png:size']);
    expect(read).not.toHaveBeenCalled();
  });

  it('counts a file whose reported size lies against the limit, and then its real bytes', async () => {
    // `File.size` is what the file claims; a 40-byte file claiming to be small is checked like
    // the 40 bytes it is. This is why the size rule is not the last word on anything.
    const liar = imageFile('png-24', 'honest-size.png', 'image/png');
    Object.defineProperty(liar, 'size', { value: IMAGE_MAX_BYTES + 1 });
    const result = await validateFiles([liar], sniffOnly);
    expect(rejectedOf(result)).toEqual(['honest-size.png:size']);
  });
});

describe('validateFiles: the content check', () => {
  it('refuses a file that cannot be decoded, with the type message', async () => {
    // A PNG's signature with nothing behind it: `File.type` says PNG, the name says PNG, and
    // only looking catches it. The decoder is the seam, so the seam is what says no here.
    const cannotDecode = vi.fn(async (_bytes: Uint8Array) => false);
    const corrupt = imageFile('png-truncated', 'corrupt.png', 'image/png');
    const result = await validateFiles([corrupt], cannotDecode);
    expect(rejectedOf(result)).toEqual(['corrupt.png:undecodable']);
    expect(REJECTION_MESSAGES.undecodable).toBe(REJECTION_MESSAGES.type);
  });

  it('passes the file bytes and trusts the answer it is given', async () => {
    const check = vi.fn(async (_bytes: Uint8Array) => false);
    const file = imageFile('png-24', 'shot.png', 'image/png');
    const result = await validateFiles([file], check);
    expect(result.accepted).toEqual([]);
    expect(check).toHaveBeenCalledTimes(1);
    const passed = check.mock.calls[0][0];
    expect(passed.length).toBe(imageBytes('png-24').length);
    expect(sniffImageType(passed)).toBe('image/png');
  });

  it('hands the check the whole file, because a decoder needs all of it', async () => {
    // The length rule runs first precisely so that this read is never asked of a file that
    // was already refused for being long; and a decoder cannot work from a head.
    const file = imageFile('jpeg-24', 'photo.jpg', 'image/jpeg');
    const seen: Uint8Array[] = [];
    await validateFiles([file], async (bytes) => {
      seen.push(bytes);
      return true;
    });
    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0])).toEqual(Array.from(imageBytes('jpeg-24')));
  });

  it('reports a content check that throws as a file that is not an image', async () => {
    // The client cannot be expected to know why a decoder fell over, and a file it could not
    // make sense of is a file it will not upload.
    const result = await validateFiles(
      [imageFile('png-24', 'shot.png', 'image/png')],
      async () => {
        throw new Error('decoder exploded');
      },
    );
    expect(rejectedOf(result)).toEqual(['shot.png:undecodable']);
  });

  it('refuses nothing when there is nothing to refuse', async () => {
    expect(await validateFiles([], sniffOnly)).toEqual({ accepted: [], rejected: [] });
  });
});

describe('defaultContentCheck: the level of looking the client does without a seam', () => {
  it('agrees these bytes are the four formats', async () => {
    for (const name of ['png-1440x900', 'png-24', 'jpeg-4032x3024', 'jpeg-24', 'webp-640x480', 'gif-animated']) {
      await expect(defaultContentCheck(imageBytes(name))).resolves.toBe(true);
    }
  });

  it('refuses bytes that are not one of the formats at all', async () => {
    for (const name of ['pdf', 'svg']) {
      await expect(defaultContentCheck(imageBytes(name))).resolves.toBe(false);
    }
    await expect(defaultContentCheck(new Uint8Array(0))).resolves.toBe(false);
    await expect(defaultContentCheck(new Uint8Array(64))).resolves.toBe(false);
    // A PNG cut off 24 bytes in is the file this level of looking cannot catch: its signature
    // is true and only a decoder can see that nothing follows it. Where there is no decoder
    // there is nothing to see it with — which is why the check is a seam (the refusal above is
    // made through it) and why the browser suite is the one that catches it for real.
    expect(sniffImageType(imageBytes('png-truncated'))).toBe('image/png');
  });
});

describe('the messages themselves', () => {
  it('says what the PRD says, with the limits interpolated rather than retyped', () => {
    expect(REJECTION_MESSAGES.type).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
    expect(REJECTION_MESSAGES.undecodable).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('knows the names and types it refuses without reading, and none of the ones it accepts', () => {
    expect(KNOWN_NON_IMAGE_TYPES).toEqual(
      expect.arrayContaining(['application/pdf', 'image/svg+xml', 'text/plain', 'video/mp4']),
    );
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(KNOWN_NON_IMAGE_TYPES).not.toContain(type);
      expect(KNOWN_NON_IMAGE_EXTENSIONS).not.toContain(type.slice('image/'.length));
    }
    expect(KNOWN_NON_IMAGE_EXTENSIONS).toEqual(
      expect.arrayContaining(['pdf', 'svg', 'heic', 'mp4', 'zip', 'txt']),
    );
    expect(UNCLAIMED_FILE_TYPES).toEqual(expect.arrayContaining(['', 'application/octet-stream']));
  });
});
