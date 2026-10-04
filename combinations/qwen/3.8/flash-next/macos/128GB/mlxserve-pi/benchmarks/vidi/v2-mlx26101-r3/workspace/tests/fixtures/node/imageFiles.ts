/**
 * The image fixtures on disk, for the tests that run with a file system.
 *
 * The files in `../images/` are real - a 4032x3024 JPEG photograph, a 1440x900 PNG screenshot, an
 * animated GIF, a WebP, an SVG with a script in it, a PDF wearing a `.png` name, a PNG that stops halfway
 * through its pixel data. Reading them is what makes "a real PNG" in a test mean a real PNG: the
 * alternative, a byte array that begins with a PNG signature, would test the sniffer and nothing else.
 *
 * This module is in a directory of its own because it imports `node:fs`, and two of the three type sets
 * this repository is checked with do not have a file system: the integration tests run inside workerd,
 * which has no access to this directory even in principle. Those tests build their fixtures in
 * `../imageBytes.ts` instead, and this one exists for the unit tests and the e2e suite, where a real file
 * is the point.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the fixtures are, relative to this file. */
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'images');

/** The names in that directory that a test can ask for by name. */
export type ImageFixtureName =
  | 'screenshot.png'
  | 'screenshot-2.png'
  | 'screenshot-3.png'
  | 'photo.jpg'
  | 'picture.webp'
  | 'animation.gif'
  | 'static.gif'
  | 'script.svg'
  | 'document.pdf'
  | 'renamed-pdf.png'
  | 'broken.png'
  | 'tiny.jpg'
  | 'tiny.webp';

/**
 * The fixture's bytes.
 *
 * Read from disk on every call, because these files are small enough that caching them buys nothing and
 * a test that saw a stale copy of a fixture it had just regenerated would be the most confusing kind of
 * passing test.
 */
export function fixtureBytes(name: ImageFixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(directory, name)));
}

/** The fixture's absolute path, for the e2e suite, which hands files to the browser by path. */
export function fixturePath(name: ImageFixtureName): string {
  return join(directory, name);
}

/** The first `count` bytes of a fixture - which is as much of a file as a sniffer ever sees. */
export function fixtureHead(name: ImageFixtureName, count: number): Uint8Array {
  return fixtureBytes(name).subarray(0, count);
}

/** A `File` from a fixture, with the type a browser would have given it from that name. */
export function fixtureFile(name: ImageFixtureName, type = mimeOf(name)): File {
  // Copied into a fresh array rather than handed over as the view `readFileSync` produced: the DOM type set
  // wants a `BlobPart` over an `ArrayBuffer`, and a Node `Buffer`'s buffer is not provably one.
  return new File([new Uint8Array(fixtureBytes(name))], name, { type });
}

/** What a browser's file picker reports for a file with this extension. */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** The MIME type a browser's file picker reports for a file with this extension. */
export function mimeOf(name: ImageFixtureName): string {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
