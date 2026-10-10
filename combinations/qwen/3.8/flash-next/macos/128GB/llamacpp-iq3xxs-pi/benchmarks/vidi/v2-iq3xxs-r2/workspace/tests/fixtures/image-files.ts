/**
 * The real image files in `tests/fixtures/images/`, for the tests that run in Node and in a
 * browser: unit, component and end-to-end. They are built by `images/generate.mjs`.
 *
 * `fileFor` hands one over as a `File` with the type a browser would have worked out from
 * its name — which is a claim about the file, not a fact about it, and the difference is
 * what the disguised-PDF fixture is for.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'images');

export type ImageFixture =
  | 'screenshot-1440x900.png'
  | 'screenshot-1200x800.png'
  | 'screenshot-900x600.png'
  | 'broken.png'
  | 'disguised-pdf.png'
  | 'animated.gif'
  | 'photo-640x480.webp'
  | 'photo-4032x3024.jpg'
  | 'svg-with-script.svg';

/** The type a browser would give a file of this name, from its extension. */
function claimedType(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  throw new Error(`no MIME type for fixture ${name}`);
}

export function bytesOf(fixture: ImageFixture): Uint8Array<ArrayBuffer> {
  // Typed as a view over a plain ArrayBuffer so it is a BlobPart without arguing about
  // SharedArrayBuffer, which a file on disk never is.
  return new Uint8Array(readFileSync(join(DIRECTORY, fixture)));
}

/**
 * A `File` as an upload or a drop would present it: named, typed by name, and holding the
 * fixture's actual bytes. Pass `name` to upload it under a different name, which is how a
 * test drops `photo.jpg` when the fixture is called something else.
 */
export function fileFor(fixture: ImageFixture, name = fixture): File {
  const bytes = bytesOf(fixture);
  return new File([bytes], name, { type: claimedType(name) });
}

/**
 * The same file for Playwright's `setInputFiles`, which wants a name, a MIME type and the
 * bytes rather than a path — so the fixture stays a fixture and no test depends on what
 * temporary directory the run happened to write it to.
 */
export function uploadFor(fixture: ImageFixture, name = fixture): {
  name: string;
  mimeType: string;
  buffer: Uint8Array;
} {
  return { name, mimeType: claimedType(name), buffer: bytesOf(fixture) };
}
