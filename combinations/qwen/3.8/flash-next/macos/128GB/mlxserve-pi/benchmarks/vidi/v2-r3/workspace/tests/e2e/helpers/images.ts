// Story 12 e2e helpers: pictures in a real browser, on a real room, with real bytes.
//
// Two things are worth saying about how a file gets into a browser at all.
//
// **The file is carried as bytes, not as a path.** The page under test is served by
// `wrangler dev` from `dist/client`, which does not serve the test directory, so there
// is no URL a page could fetch a fixture from. The bytes are read here and handed over,
// which is also closer to the truth: a dropped file is bytes plus a name the board never
// looks at.
//
// **The file picker is driven as a file chooser, not as an input.** Playwright's
// `filechooser` event is the browser's own "the page asked for a file" moment, so
// clicking the Image button and answering that event is the whole picker path — including
// whether the button opens a dialogue at all, which a `setInputFiles` straight onto the
// hidden input could never show.
import { expect, type FileChooser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { screenOf, type ScreenPoint } from './shapes';
import type { Point } from '../../../src/shared/geometry';
import type { Person } from './participants';

export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp';

/** The four formats the board takes, as files a person's computer would call them. */
const FIXTURES: Record<
  ImageFormat,
  { file: string; name: string; type: string; width: number; height: number }
> = {
  png: { file: 'tiny.png', name: 'holiday.png', type: 'image/png', width: 40, height: 30 },
  jpg: { file: 'tiny.jpg', name: 'holiday.jpg', type: 'image/jpeg', width: 40, height: 30 },
  gif: { file: 'tiny.gif', name: 'holiday.gif', type: 'image/gif', width: 40, height: 30 },
  webp: { file: 'tiny.webp', name: 'holiday.webp', type: 'image/webp', width: 40, height: 30 },
};

/** Every fixture is 40x30: a 4:3 picture, which is what an aspect-locked resize has to
 *  have to be about anything, and small enough that the board places it at its own size. */
export const FIXTURE_SIZE = { width: 40, height: 30 };

const HERE = dirname(fileURLToPath(import.meta.url));

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** The fixture's bytes, as Playwright wants them. */
export function payload(format: ImageFormat): FilePayload {
  const fixture = FIXTURES[format];
  return {
    name: fixture.name,
    mimeType: fixture.type,
    buffer: readFileSync(join(HERE, '..', '..', 'fixtures', fixture.file)),
  };
}

/** The Image button, by the name a person reads on it. */
export const imageButton = (page: Page) => page.getByRole('button', { name: 'Image', exact: true });

export const imageInput = (page: Page) => page.getByTestId('image-file-input');

export const imageLocator = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`);

/** One picture, as this page draws it. */
export interface ImageOnBoard {
  id: string;
  /** The box, in board units: what the board stores and the screen reports. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** What the document says, and what this person is being shown. */
  status: string;
  display: string;
  naturalWidth: number;
  naturalHeight: number;
  /** The `src` as written, not as the browser resolved it. */
  src: string;
  /** What the picture is called to somebody who cannot see it. */
  alt: string;
  /** What the browser decoded the picture as: 0 until the bytes are there and are one. */
  decodedWidth: number;
  decodedHeight: number;
  /** The words in the box, if there are words in it. */
  words: string;
  retry: boolean;
  remove: boolean;
}

async function readImage(page: Page, id: string): Promise<ImageOnBoard | null> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-object-id="${id}"]`);
    if (el === null) return null;
    const img = el.querySelector('img');
    const words = el.querySelector('.image-status-text');
    return {
      id,
      x: Number(el.getAttribute('data-box-x')),
      y: Number(el.getAttribute('data-box-y')),
      width: Number(el.getAttribute('data-box-width')),
      height: Number(el.getAttribute('data-box-height')),
      status: el.getAttribute('data-status') ?? '',
      display: el.getAttribute('data-display') ?? '',
      naturalWidth: Number(el.getAttribute('data-natural-width')),
      naturalHeight: Number(el.getAttribute('data-natural-height')),
      src: img?.getAttribute('src') ?? '',
      alt: img?.getAttribute('alt') ?? '',
      decodedWidth: img?.naturalWidth ?? 0,
      decodedHeight: img?.naturalHeight ?? 0,
      words: (words?.textContent ?? '').trim(),
      retry: el.querySelector('[data-testid="image-retry"]') !== null,
      remove: el.querySelector('[data-testid="image-remove"]') !== null,
    };
  }, id);
}

/** Every picture this page draws, in the order it draws them. */
export function imageIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-object-id]')).map((el) => el.getAttribute('data-object-id')!),
  );
}

export async function waitForImageCount(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(() => imageIds(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [50, 100, 250] })
    .toHaveLength(count);
  return imageIds(page);
}

export async function imageOf(page: Page, id: string): Promise<ImageOnBoard> {
  const found = await readImage(page, id);
  if (found === null) throw new Error(`this page is not drawing ${id}`);
  return found;
}

/** One line per picture, for asking whether two screens hold the same board. */
export function imageLines(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-object-id]')).map((el) =>
      [
        el.getAttribute('data-object-id'),
        el.getAttribute('data-box-x'),
        el.getAttribute('data-box-y'),
        el.getAttribute('data-box-width'),
        el.getAttribute('data-box-height'),
        el.getAttribute('data-status'),
        (el.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') ?? '',
      ].join('|'),
    ),
  );
}

/** Every screen holds the same pictures, in the same boxes. */
export async function expectSamePictures(people: Person[], label: string): Promise<void> {
  const [first, ...rest] = people;
  await expect
    .poll(
      async () => {
        const mine = await imageLines(first!.page);
        for (const other of rest) {
          const theirs = await imageLines(other.page);
          if (theirs.join('\n') !== mine.join('\n')) {
            return `${other.name}: ${theirs.length} pictures against ${mine.length}`;
          }
        }
        return '';
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [50, 100, 250] },
    )
    .toBe('');
  console.log(`  change   ${label}: every screen drew the same pictures`);
}

/** Wait until this page has the picture, its bytes, and its bytes back from the store. */
export async function waitForPicturePainted(page: Page, id: string): Promise<ImageOnBoard> {
  await expect
    .poll(() => readImage(page, id).then((found) => found?.decodedWidth ?? 0), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [50, 100, 250],
    })
    .toBe(FIXTURE_SIZE.width);
  const found = await readImage(page, id);
  if (found === null) throw new Error(`this page is not drawing ${id}`);
  return found;
}

/** The words on the board's screen, in the order they appeared. */
export function toastTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="toast"]')).map((el) => (el.textContent ?? '').trim()),
  );
}

export async function waitForToast(page: Page, text: string): Promise<void> {
  await expect
    .poll(() => toastTexts(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [50, 100, 250] })
    .toContain(text);
}

/**
 * A file laid on the board at a screen point.
 *
 * A new `DataTransfer` is built for each of the three events rather than one reused,
 * because a page is allowed to close a data transfer it has finished with, and a drop
 * that arrived with an empty transfer would be a test of nothing.
 */
export interface BytesInPage {
  name: string;
  mimeType: string;
  /** A plain array: that is what survives the trip into the page. */
  buffer: number[];
}

function bytesInPage(format: ImageFormat): BytesInPage {
  const file = payload(format);
  return { name: file.name, mimeType: file.mimeType, buffer: Array.from(file.buffer) };
}

export async function dropImage(page: Page, format: ImageFormat, at: ScreenPoint): Promise<void> {
  const file = bytesInPage(format);
  await page.evaluate(
    async ({ file, at }: { file: BytesInPage; at: ScreenPoint }) => {
      const surface = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
      const transfer = (): DataTransfer => {
        const data = new DataTransfer();
        data.items.add(new File([Uint8Array.from(file.buffer)], file.name, { type: file.mimeType }));
        return data;
      };
      // `at` is a client coordinate, which is what the board turns into a board point:
      // the drag is laid down where the hand let go of it, not where its box begins.
      for (const kind of ['dragenter', 'dragover', 'drop']) {
        surface.dispatchEvent(
          new DragEvent(kind, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer(),
            clientX: at.x,
            clientY: at.y,
          }),
        );
      }
    },
    { file, at },
  );
}

/** A file laid on the board at a board point. */
export async function dropImageAt(page: Page, format: ImageFormat, world: Point): Promise<void> {
  await dropImage(page, format, await screenOf(page, world));
}

/** A file pasted, on the window, which is where a browser sends a paste. */
export async function pasteImage(page: Page, format: ImageFormat): Promise<void> {
  const file = bytesInPage(format);
  await page.evaluate(({ file }: { file: BytesInPage }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(file.buffer)], file.name, { type: file.mimeType }));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    // The board listens on the window and reads `clipboardData`; this is the one
    // property a plain event has to be given, because a paste event cannot be made
    // with a clipboard in it in every browser.
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    window.dispatchEvent(event);
  }, { file });
}

/**
 * The Image button pressed, and its dialogue opened: the browser's own moment of being
 * asked for a file. Which is also how a test learns that a press opened one at all,
 * whether more than one file was on offer, and what formats the picker was limited to.
 */
export async function openImagePicker(page: Page): Promise<FileChooser> {
  const asking = page.waitForEvent('filechooser');
  await imageButton(page).click();
  return asking;
}

/** The Image button pressed, and the files chosen. */
export async function pickImages(page: Page, formats: ImageFormat[]): Promise<void> {
  const opened = await openImagePicker(page);
  await opened.setFiles(formats.map((format) => payload(format)));
}

/** The button opened no dialogue, and was not supposed to. */
export async function expectNoFileChooser(page: Page): Promise<void> {
  const opened = await page
    .waitForEvent('filechooser', { timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  expect(opened).toBe(false);
}

/** The upload's own address for this board, for a test which must break it. */
export const assetsRoute = (boardId: string): string => `**/api/boards/${boardId}/assets`;
