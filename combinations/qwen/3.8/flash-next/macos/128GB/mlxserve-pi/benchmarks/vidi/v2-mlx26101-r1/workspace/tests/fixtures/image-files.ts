// The image fixtures, as things a test can hold.
//
// The files themselves are in `images/` next to this module and are made by `images/generate.mjs`.
// What lives here is the part that is not about pixels: handing them to a test as `File`s, renaming a
// PDF so it wears a `.png` name, and making a JPEG of an exact number of bytes — which the size
// limits need, because "10 MB or smaller" and "10 MB plus one byte" are the two files that decide the
// rule (image.too_large).
//
// Node's `fs` is used on purpose: the unit and ui-component suites run in Node/jsdom and the e2e suite
// runs in Node too, so the same helper builds a `File` here and a Playwright file payload there.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES } from '../../src/shared/config';

const imagesDir = join(dirname(fileURLToPath(import.meta.url)), 'images');

export type ImageFixtureName =
  | 'screenshot-1440x900.png'
  | 'diagram-1000x400.png'
  | 'swatch-100x100.png'
  | 'photo-4032x3024.jpg'
  | 'picture.webp'
  | 'animation.gif'
  | 'script.svg'
  | 'renamed-pdf.png'
  | 'truncated.png';

/** The media type a fixture claims, by extension — the same guess a browser makes. */
export function typeForFileName(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/** A fixture's bytes, exactly as committed. */
export function imageFixture(name: ImageFixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(imagesDir, name)));
}

/** A fixture as a `File`, with the type its name implies (a renamed PDF claims `.png`). */
export function imageFile(
  name: ImageFixtureName,
  overrides: { name?: string; type?: string } = {},
): File {
  const bytes = imageFixture(name);
  const type = overrides.type ?? typeForFileName(name);
  return new File([bytes as unknown as BlobPart], overrides.name ?? name, { type });
}

/** The dimensions a fixture really has, which is what `createImageBitmap` is stubbed to report. */
export const IMAGE_FIXTURE_DIMENSIONS: Readonly<Record<ImageFixtureName, { width: number; height: number }>> = {
  'screenshot-1440x900.png': { width: 1440, height: 900 },
  'diagram-1000x400.png': { width: 1000, height: 400 },
  'swatch-100x100.png': { width: 100, height: 100 },
  'photo-4032x3024.jpg': { width: 4032, height: 3024 },
  'picture.webp': { width: 320, height: 240 },
  'animation.gif': { width: 24, height: 16 },
  'script.svg': { width: 100, height: 80 },
  'renamed-pdf.png': { width: 0, height: 0 },
  'truncated.png': { width: 0, height: 0 },
};

/** The three screenshots a moodboard starts with, as files. */
export function screenshotFiles(): File[] {
  return (['screenshot-1440x900.png', 'diagram-1000x400.png', 'swatch-100x100.png'] as const).map(
    (name) => imageFile(name),
  );
}

/**
 * A real JPEG of exactly `target` bytes, made by slipping comment segments in after the start of
 * image marker (FF D8). A decoder is told to skip a comment segment, so the picture is still the
 * picture — which is how a test can hand in a JPEG that is exactly IMAGE_MAX_BYTES big, or one byte
 * bigger, without committing either to git and without inventing bytes a decoder would choke on.
 *
 * Below the original size there is nothing to add, and 1 to 3 spare bytes do not fit a segment
 * header, so those are appended after the end of image marker instead — trailing bytes a decoder
 * has already stopped reading.
 */
export function jpegPaddedTo(jpeg: Uint8Array, target: number): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('jpegPaddedTo needs a file that starts with a JPEG marker');
  }
  let spare = target - jpeg.length;
  if (spare < 0) throw new Error(`cannot pad a ${jpeg.length}-byte file to ${target} bytes`);
  const segments: number[] = [];
  while (spare >= 4) {
    const payload = Math.min(spare - 4, 0xfffb); // FF FE + two length bytes, at most 65535 long
    segments.push(0xff, 0xfe, (payload + 2) >> 8, (payload + 2) & 0xff);
    for (let i = 0; i < payload; i += 1) segments.push(0x20); // spaces: a comment nobody wrote
    spare -= payload + 4;
  }
  const tail = new Uint8Array(spare); // 0..3 bytes, after the picture, for an exact count
  const out = new Uint8Array(jpeg.length + segments.length + spare);
  out.set(jpeg, 0);
  out.set(segments, jpeg.length);
  out.set(tail, jpeg.length + segments.length);
  return out;
}

/** A valid JPEG of exactly `size` bytes, built from the photo fixture. */
export function jpegFileOfSize(size: number, name = 'exactly-at-limit.jpg'): File {
  const bytes = jpegPaddedTo(imageFixture('photo-4032x3024.jpg'), size);
  return new File([bytes as unknown as BlobPart], name, { type: 'image/jpeg' });
}

/** The two files that decide the size rule: the largest one allowed, and one byte past it. */
export function sizeBoundaryFiles(): { atLimit: File; overLimit: File } {
  return {
    atLimit: jpegFileOfSize(IMAGE_MAX_BYTES, 'at-limit.jpg'),
    overLimit: jpegFileOfSize(IMAGE_MAX_BYTES + 1, 'one-byte-over.jpg'),
  };
}

/** `n` valid image files, named so a test can tell an order out. */
export function manyImageFiles(n: number): File[] {
  const bytes = imageFixture('swatch-100x100.png');
  return Array.from({ length: n }, (_unused, i) =>
    new File([bytes as unknown as BlobPart], `image-${String(i + 1)}.png`, {
      type: 'image/png',
    }),
  );
}

/** The accepted media types, for a test that wants to iterate over them. */
export const ACCEPTED_MEDIA_TYPES: readonly (typeof IMAGE_ACCEPTED_TYPES)[number][] = [
  ...IMAGE_ACCEPTED_TYPES,
];

/** The leading bytes of each accepted type, and of the things that only look like them. */
export function headerOf(name: ImageFixtureName, bytes = 12): Uint8Array {
  return imageFixture(name).subarray(0, bytes);
}

/** Bytes that are not any image: the smallest thing that is honestly a PDF. */
export function pdfBytes(): Uint8Array {
  return imageFixture('renamed-pdf.png');
}

/** Bytes that are an SVG: a document, and scriptable, so never an image here. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(readFileSync(join(imagesDir, 'script.svg'), 'utf8'));
}
