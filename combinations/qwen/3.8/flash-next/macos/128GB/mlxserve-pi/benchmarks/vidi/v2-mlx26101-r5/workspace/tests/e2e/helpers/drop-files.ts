/**
 * Putting a file into a browser from the outside.
 *
 * A board that takes images has to be tested with files, and Playwright's file API has two doors, which are
 * worth keeping straight because only one of them is a drag:
 *
 * **The picker** is easy and honest: `setInputFiles` puts real files on a real `<input type=file>` and the
 * browser fires the real `change` event, exactly as it does when a person chooses files from Finder. The
 * board's hidden input is in the DOM for precisely this reason, so a test can hand it files without a person.
 *
 * **The drop** is the one that needs a helper. There is no drag-and-drop API in Playwright, because there is
 * no way for an automation driver to make the operating system drag a file — a file drag is a gesture between
 * two applications, and a browser is only allowed to *receive* one. What every browser does allow is a script
 * in the page making the events itself: construct a `DataTransfer`, add `File` objects to it, and dispatch
 * `dragenter`, `dragover` and `drop` at a point. The board cannot tell the difference, and neither can
 * anything else on the page: `DataTransfer.files` is a real `FileList` of real `File`s, with the bytes, the
 * name and the declared MIME type the test asked for — which is the point. The board's own checks (the
 * `Files` type on the transfer, the MIME type of each file, and eventually the bytes themselves) all run
 * against those real objects, so nothing below is a stub: the file is the file, and only the hand is fake.
 *
 * What this does *not* fake, and no test here pretends otherwise: the highlight the browser itself draws
 * under a file being dragged, the system's own file-not-found behaviour, and the operating system's idea of
 * what MIME type a file has. The last one matters for the renamed fixtures: `report.pdf` handed over as
 * `application/pdf` and `fake-image.png` handed over as `image/png` are the two halves of the PRD's renamed
 * file, one refused by the type check and one by the magic number four steps later.
 *
 * Files are read here, in node, and handed to the page as base64 — the fixtures are kilobytes, and a
 * `Uint8Array` does not survive `page.evaluate` any other way. The one file that is not a fixture is the
 * oversized one in TC-26, which is made to a byte count rather than stored in the repository: a ten-megabyte
 * file in git is a clone that takes a minute longer, for a file that is a header and a run of zeroes.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/images');

/** A file as it is handed to a browser: bytes, name, and the type the browser will report for it. */
export interface FileForBoard {
  name: string;
  mimeType: string;
  /** Bytes, ready to hand to the page or to the file input. */
  base64: string;
}

/** The name of a file in `tests/fixtures/images`. */
export type FixtureName =
  | 'screenshot.png'
  | 'blue.png'
  | 'photo.jpg'
  | 'picture.webp'
  | 'animation.gif'
  | 'diagram.svg'
  | 'fake-image.png'
  | 'truncated.png'
  | 'report.pdf';

/** What each fixture *is*, as distinct from what its name says it is. The names are half the test. */
const DECLARED: Record<FixtureName, string> = {
  'screenshot.png': 'image/png',
  'blue.png': 'image/png',
  'photo.jpg': 'image/jpeg',
  'picture.webp': 'image/webp',
  'animation.gif': 'image/gif',
  'diagram.svg': 'image/svg+xml',
  // A PDF, with a `.png` name and the type a `.png` would have. This is the PRD's "a PDF renamed .png", and
  // the reason the name and the type are both spelled out here is that the test is about the lie.
  'fake-image.png': 'image/png',
  // A PNG header and nothing after it: a file that begins truthfully and ends early.
  'truncated.png': 'image/png',
  'report.pdf': 'application/pdf',
};

/** A real fixture file, read from disk, as the browser will be handed it. */
export async function imageFixture(name: FixtureName): Promise<FileForBoard> {
  const bytes = await readFile(join(FIXTURES, name));
  return { name, mimeType: DECLARED[name], base64: bytes.toString('base64') };
}

/** Several fixtures, in order — the order a person selects them in is the order they are placed in. */
export async function imageFixtures(...names: FixtureName[]): Promise<FileForBoard[]> {
  const files: FileForBoard[] = [];
  for (const name of names) files.push(await imageFixture(name));
  return files;
}

/**
 * A file of an exact size, with a JPEG's first bytes so that the only thing wrong with it is its length.
 *
 * Made rather than stored: this is the file that is one byte over the limit, or over it by a megabyte, and a
 * repository that carried either would carry a ten-megabyte blob to say "greater than". The header is real
 * (`FF D8 FF E0`) because the board's size check happens before anything reads the bytes, and a test that
 * needed the bytes to decode would be testing a different thing.
 */
export function fileOfBytes(name: string, mimeType: string, bytes: number): FileForBoard {
  const buffer = Buffer.alloc(bytes, 0);
  buffer.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return { name, mimeType, base64: buffer.toString('base64') };
}

/** A point on the screen, which is where a drop happens: the board turns it into world coordinates. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A drag that has begun and has not let go. */
export interface DragInPage {
  /** The files, as the page now holds them — the count is what the board was given. */
  readonly files: number;
  /** Let go here. */
  drop(at?: ScreenPoint): Promise<void>;
}

/**
 * The events, dispatched in the page at a screen point.
 *
 * `phase` is which half of the drag this call makes: `enter` sends `dragenter` and `dragover` and leaves the
 * files in the hand, so a test can look at the board *during* the drag — which is the only way to see the
 * drop highlight, and the highlight is half of what the PRD asks for. `drop` sends the `drop` and nothing
 * else, at the point given, which is how a test drops somewhere other than where it hovered.
 *
 * A real drag carries one `DataTransfer` from beginning to end; two calls make two, equal in every way the
 * board reads. It reads `types` (to decide whether a file is in the hand at all) and `files` (to get them),
 * and it reads both from whichever event it is answering, so two equal transfers stand in for one real one.
 * Anything that ever inspects the identity of a transfer would have to be tested with a real drag, and a
 * board that did that would be a board that could not be tested at all.
 */
async function dispatch(
  page: Page,
  files: readonly FileForBoard[],
  at: ScreenPoint,
  phase: 'enter' | 'drop',
): Promise<number> {
  return page.evaluate(
    ({ files, x, y, phase }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
      }
      // The page's own answer to "what is under this point", which is the element a real drag would have
      // entered. Handing the events to `document.body` instead would be a drag that never touched the board.
      const target = document.elementFromPoint(x, y);
      if (target === null) throw new Error(`nothing on the screen at ${x}, ${y}`);
      const types = phase === 'enter' ? ['dragenter', 'dragover'] : ['drop'];
      for (const type of types) {
        const sent = transfer.files.length === 0 ? null : transfer;
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: sent ?? undefined,
        });
        target.dispatchEvent(event);
      }
      return transfer.files.length;
    },
    { files, x: at.x, y: at.y, phase },
  );
}

/**
 * Take the files to a point on the board and hold them there: `dragenter` and `dragover`, no drop.
 *
 * Fails loudly if the page's `DataTransfer` came back empty, which is the one way this helper can be quietly
 * unsupported by a browser. A silent empty transfer would be a test that dropped nothing and passed.
 */
export async function dragFilesTo(page: Page, files: FileForBoard[], at: ScreenPoint): Promise<DragInPage> {
  const handed = await dispatch(page, files, at, 'enter');
  if (handed !== files.length) {
    throw new Error(
      `this browser's DataTransfer took ${handed} of ${files.length} files; the drop cannot be tested here`,
    );
  }
  return {
    files: handed,
    drop: (where?: ScreenPoint) =>
      dispatch(page, files, where ?? at, 'drop').then(() => undefined),
  };
}

/** Take the files to a point and let go. The drop the PRD is about, in one line. */
export async function dropFiles(page: Page, files: FileForBoard[], at: ScreenPoint): Promise<void> {
  const drag = await dragFilesTo(page, files, at);
  await drag.drop();
}

/** The board's own drop highlight, whatever state it is in. */
export const dropHighlight = (page: Page): Locator => page.getByTestId('drop-highlight');

/** The file picker the board opened: present in the DOM, invisible on the screen, always. */
export const filePicker = (page: Page): Locator => page.getByTestId('image-picker-input');

/** What the board's own filter says, which is the four formats the PRD names. */
export async function pickerFilter(page: Page): Promise<string | null> {
  return filePicker(page).getAttribute('accept');
}

/** The dialog the operating system was asked to put on the screen. */
export interface FileChooser {
  /** Choose these files. The board sees a `change` event and a real `FileList`. */
  choose(files: readonly FileForBoard[]): Promise<void>;
}

const asInputFiles = (files: readonly FileForBoard[]) =>
  files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.base64, 'base64'),
  }));

/**
 * Do something that opens the system's file dialog, and catch the dialog.
 *
 * The two have to happen together, and that is not a style preference: while a file chooser is open the
 * browser considers the page to be waiting on a person, and Playwright holds every other action on that page
 * until the chooser is answered. A test that pressed the Image button and then went on to assert something
 * would be a test that timed out on its next command, with a message about a different command. So the
 * dialog is caught first, and the thing that opens it happens behind it.
 *
 * This is also why the picker cannot be driven with `setInputFiles` alone once a button has been pressed: the
 * dialog is already open, and filling in the input underneath it is not an answer to it.
 */
export async function catchFileChooser(page: Page, open: () => Promise<void>): Promise<FileChooser> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    open(),
  ]);
  return { choose: (files: readonly FileForBoard[]) => chooser.setFiles(asInputFiles(files)) };
}

/** Press `I`, the board's letter for the Image tool, and catch the dialog it opens. */
export async function openPickerWithKey(page: Page): Promise<FileChooser> {
  return catchFileChooser(page, () => page.keyboard.press('i'));
}

/** Press the toolbar's Image button, and catch the dialog it opens. */
export async function openPickerWithButton(page: Page): Promise<FileChooser> {
  return catchFileChooser(page, () => page.getByTestId('tool-image').click());
}

/**
 * The line at the bottom of the screen, or null when the board has nothing to say.
 *
 * A direct read rather than a locator, because it is called in a poll that spends most of its time while the
 * toast is absent — and a locator call waits for an element to *appear*.
 */
export async function toastText(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('[data-testid="toast"]')?.textContent ?? null);
}

/** Wait for the board to say this line, and hand back what it actually said. */
export async function expectToast(page: Page, said: string): Promise<string> {
  const seen = page
    .waitForFunction(
      (text) => (document.querySelector('[data-testid="toast"]')?.textContent ?? '').includes(text),
      said,
      { timeout: 15_000, polling: 50 },
    )
    .then(() => true)
    .catch(() => false);
  if (!(await seen)) throw new Error(`the board never said "${said}" (last seen: "${await toastText(page)}")`);
  return (await toastText(page)) ?? '';
}
