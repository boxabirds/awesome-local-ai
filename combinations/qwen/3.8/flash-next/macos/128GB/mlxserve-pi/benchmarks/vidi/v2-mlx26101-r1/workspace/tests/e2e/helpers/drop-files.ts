// Handing a browser a file without a file dialog (story 12, and anything after it that takes a drop).
//
// A person drags a file from their desktop and the browser hands the page a `DataTransfer` full of
// `File`s. There is no desktop to drag from in a test, and Playwright's drag automation cannot carry a
// file either — but the board only ever reads three things off a `DataTransfer`: `files`, `types`, and
// whether the drop was allowed. So this builds one in the page out of the same bytes the fixture
// directory holds, and dispatches the events in the order a browser dispatches them.
//
// Three things are deliberate here:
//
//   * The bytes are the real fixture bytes. A PNG that is a real PNG gets decoded by the real browser,
//     uploaded to the real bucket and drawn on screen; a file that only claims to be a PNG
//     (`renamed-pdf.png`) is refused for the same reason it would be refused on anybody's laptop.
//   * The events go to the element under the pointer, and they bubble. So a drop target that had been
//     left off an ancestor of the board is caught here rather than being invisible (image.drop).
//   * `dragenter` and `dragover` are dispatched too, because they are what a real drag consists of:
//     the highlight and the pointer's shape are part of the story, and a `drop` on its own proves
//     nothing about them.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';

const FIXTURES = fileURLToPath(new URL('../../fixtures/images/', import.meta.url));

/** What the browser would call each fixture, judging it by its own magic. */
const FIXTURE_TYPES = {
  'screenshot-1440x900.png': 'image/png',
  'diagram-1000x400.png': 'image/png',
  'swatch-100x100.png': 'image/png',
  'photo-4032x3024.jpg': 'image/jpeg',
  'animation.gif': 'image/gif',
  'picture.webp': 'image/webp',
  // A PDF wearing a PNG's name: the extension says yes, the bytes say something else (image.types).
  'renamed-pdf.png': 'image/png',
  // A PNG whose bytes stop in the middle of the first chunk.
  'truncated.png': 'image/png',
  'script.svg': 'image/svg+xml',
} as const;

export type ImageFixture = keyof typeof FIXTURE_TYPES;

/**
 * A file as it would sit on the person's disk, ready to be dragged onto a board.
 *
 * `Uint8Array` and not `Buffer`, because this repo types the same code for Workers as well and the
 * Workers types bring a `Buffer` of their own whose methods are not Node's. Anything that has to be
 * carried into a page is base64, which is what `base64Of` is for.
 */
export interface FileToDrop {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** One of the story's fixtures, read from disk in Node, for the page to be handed. */
export function fixtureFile(name: ImageFixture): FileToDrop {
  return { name, type: FIXTURE_TYPES[name], bytes: readFileSync(`${FIXTURES}/${name}`) };
}

/** Every fixture of one kind, for the tests that drop a handful of pictures. */
export function fixtureFiles(...names: readonly ImageFixture[]): FileToDrop[] {
  return names.map(fixtureFile);
}

/** A file that says it is `type` and is `bytes` bytes long: for the ones that are simply too big. */
export function fileOfSize(name: string, type: string, bytes: number): FileToDrop {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // A JPEG's start of image, so it sniffs as one.
  if (bytes <= head.length) throw new Error('a file has to be at least as long as its own magic');
  return { name, type, bytes: new Uint8Array([...head, ...new Array(bytes - head.length).fill(0)]) };
}

/** The events of a drag, in the order a browser sends them. */
type DragKind = 'dragenter' | 'dragover' | 'drop' | 'dragleave';

/**
 * Dispatch these drag events at this screen point, carrying these files.
 *
 * The bytes cross into the page as base64 because that is the only thing a Playwright `evaluate` can
 * carry; inside, they become a real `File` in a real `DataTransfer`, which is the only shape the
 * board's drop handler reads.
 */
async function drag(
  page: Page,
  kinds: readonly DragKind[],
  files: readonly FileToDrop[],
  at: { x: number; y: number },
): Promise<void> {
  await page.evaluate(
    ([payload, point, events]) => {
      const transfer = new DataTransfer();
      for (const file of payload) {
        transfer.items.add(
          new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, {
            type: file.type,
          }),
        );
      }
      for (const kind of events) {
        // Whatever is under the pointer, exactly as a pointer would find it: the board's viewport, a
        // placeholder already on the board, the toolbar. A drop that only worked on one particular
        // element would be a drop that failed in life.
        const target =
          document.elementFromPoint(point.x, point.y) ?? document.getElementById('root');
        target?.dispatchEvent(
          new DragEvent(kind, {
            bubbles: true,
            cancelable: true,
            clientX: point.x,
            clientY: point.y,
            dataTransfer: transfer,
          }),
        );
      }
    },
    [
      files.map((file) => ({ name: file.name, type: file.type, base64: base64Of(file.bytes) })),
      at,
      kinds,
    ] as [Array<{ name: string; type: string; base64: string }>, { x: number; y: number }, string[]],
  );
}

/**
 * Put these files on the pointer at a screen point and let go: `dragenter`, `dragover`, `drop`.
 * Defaults to a point in the middle of the board, clear of the toolbar on the left.
 */
export async function dropFiles(
  page: Page,
  files: readonly FileToDrop[],
  at: { x: number; y: number } = { x: 480, y: 320 },
): Promise<void> {
  await drag(page, ['dragenter', 'dragover', 'drop'], files, at);
}

/** Drag these files over a board point and hold them there: the frame should be up (image.drop). */
export async function dragFilesOver(
  page: Page,
  files: readonly FileToDrop[],
  at: { x: number; y: number } = { x: 480, y: 320 },
): Promise<void> {
  await drag(page, ['dragenter', 'dragover'], files, at);
}

/** Take the files away again, which is what a person who changed their mind does. */
export async function dragFilesAway(page: Page): Promise<void> {
  await drag(page, ['dragleave'], [], { x: 480, y: 320 });
}

/**
 * base64, spelled out.
 *
 * Node's `Buffer#toString('base64')` would be one call, but the global `Buffer` in a project that also
 * declares the Workers runtime is the Workers one, and that one does not know about encodings. In
 * chunks, because `String.fromCharCode` is not fond of being handed two megabytes of arguments.
 */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8_192;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

/** Turn base64 back into the bytes it was. */
export function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether two sequences of bytes are the same bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * An oversized picture (image.too_large), and the only honest way to have one: the rule is about how
 * big the file is, so the file has to be that big.
 *
 * It is handed to the picker as a path rather than as a buffer, which is what `pickerFiles` below is
 * for — shipping eleven megabytes of base64 across the wire to the page for a file that is about to be
 * refused is a test that is slow for the shape of its own assertion.
 */
export function oversizeFile(
  name = 'holiday.jpg',
  type = 'image/jpeg',
  bytes = IMAGE_MAX_BYTES + 1,
): FileToDrop {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // So it is a JPEG as far as its first bytes go.
  const body = new Uint8Array(bytes);
  body.set(head);
  return { name, type, bytes: body };
}

/**
 * These files, on disk, by these names, as paths.
 *
 * `setFiles` takes either buffers or paths and not a mix of both, so a batch that contains one file big
 * enough to be refused is a batch that is best put on disk as a whole. It is also the closer thing to
 * what a person does: they point the picker at files that exist, and the browser decides what kind of
 * file each one is from what it is called — which is why a PDF named `.png` is a thing that happens.
 */
export function pickerFiles(files: readonly FileToDrop[]): string[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/.tmp/picker');
  mkdirSync(dir, { recursive: true });
  return files.map((file) => {
    const path = join(dir, file.name);
    writeFileSync(path, file.bytes);
    return path;
  });
}
