// Getting files onto the board from a test (story 12).
//
// Two ways in, and each needs a different trick, because both are things a browser does not let a
// remote script do on somebody's behalf.
//
// The picker is a real `<input type=file>`; a test can put files into one, but not by clicking it —
// the dialogue a click opens belongs to the operating system, and there is nothing on the page for
// Playwright to type into. So the helper hands the input the files directly, after bringing it
// back inside the viewport: the board keeps it out of sight on purpose (a control nobody sees is
// reached by the Image button, not by the tab key), and Playwright will not hand files to something
// it cannot see.
//
// A drag of a file is the other way: a test cannot make the operating system drag a file, but the
// board asks a drag only the questions a `DataTransfer` answers — the files it carries and where
// the pointer is — so the helper builds a `DataTransfer` in the page and dispatches the three events
// a drop is, in order, at a point of the board. That is the same sequence the browser would have
// sent, and nothing about the board is changed to allow it.

import { expect, type Page } from '@playwright/test';

/** A file to hand to the board, with the bytes the test already has. */
export interface FileSpec {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** One picture's box, as the screen holds it. */
export interface ImageBox {
  id: string;
  /** What the record says: uploading, ready or failed. */
  status: string;
  /** What this screen says: the same word, or the one this screen found out for itself. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The address the picture is fetched from, when it is being fetched. */
  src: string | null;
  /** Pixels the browser actually decoded, which is the only proof a picture arrived. */
  naturalWidth: number;
  /** Whether the picture is drawn and how wide it is drawn, in screen pixels. */
  drawn: boolean;
  drawWidth: number;
  drawHeight: number;
  hasRetry: boolean;
  hasRemove: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function specs(files: FileSpec[]): { name: string; type: string; base64: string }[] {
  return files.map((file) => ({
    name: file.name,
    type: file.type,
    base64: toBase64(file.bytes),
  }));
}

// Everything between here and the end of each `page.evaluate` below runs *in the page*, which is
// why it is written out three times rather than shared: Playwright hands the browser a function's
// source and nothing of its surroundings, so a helper defined up here would simply not exist down
// there.

/** The Image control's own file input. */
export function pickerInput(page: Page) {
  return page.locator('[data-testid="image-picker"]');
}

/**
 * Choose files in the picker, as the person does.
 *
 * This is not the click that opens the dialogue: a test cannot see or close the operating system's
 * file dialogue, and does not need to. What it can do is put files where the browser would have put
 * them, which is the same thing the input sees either way.
 */
export async function chooseFiles(page: Page, files: FileSpec[]): Promise<void> {
  const input = pickerInput(page);
  await expect(input).toHaveCount(1);
  // Out of sight by design; Playwright needs to see it to put files in it.
  await input.evaluate((el) => {
    el.style.cssText =
      'position:fixed;left:8px;top:8px;width:200px;height:24px;opacity:1;z-index:99999;pointer-events:none';
  });
  await input.setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: file.type,
      buffer: Buffer.from(file.bytes.slice().buffer as ArrayBuffer),
    })),
  );
}

/**
 * Watch the picker for the clicks the board makes on the person's behalf.
 *
 * A browser's file dialogue is not something a test can see or close, so the honest measure of
 * "the Image button opens the picker" is the click the board puts on the input — the one thing that
 * is in the page's power, and the thing a person's mouse is answered by.
 */
export async function watchPickerClicks(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    (window as unknown as { __pickerClicks: number }).__pickerClicks = 0;
    document
      .querySelector('[data-testid="image-picker"]')!
      .addEventListener('click', () => {
        (window as unknown as { __pickerClicks: number }).__pickerClicks++;
      });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __pickerClicks: number }).__pickerClicks);
}

/** Drag files onto the board and drop them at a screen point. */
export async function dropFiles(page: Page, files: FileSpec[], at: { x: number; y: number }): Promise<void> {
  await page.evaluate(
    ({ files, at }) => {
      const dataTransfer = new DataTransfer();
      for (const spec of files) {
        const binary = atob(spec.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(
          new File([bytes.buffer as ArrayBuffer], spec.name, { type: spec.type }),
        );
      }
      const target = document.querySelector('[data-testid="app"]')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            dataTransfer,
          }),
        );
      }
    },
    { files: specs(files), at },
  );
}

/** One moment of a drag, for the tests that care about the frame and not the arrival. */
export async function dragEvent(
  page: Page,
  type: 'dragenter' | 'dragover' | 'dragleave',
  files: FileSpec[],
  at: { x: number; y: number } = { x: 600, y: 400 },
): Promise<void> {
  await page.evaluate(
    ({ files, type, at }) => {
      const dataTransfer = new DataTransfer();
      for (const spec of files) {
        const binary = atob(spec.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(
          new File([bytes.buffer as ArrayBuffer], spec.name, { type: spec.type }),
        );
      }
      const target = document.querySelector('[data-testid="app"]')!;
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          dataTransfer,
        }),
      );
    },
    { files: specs(files), type, at },
  );
}

/**
 * Paste files, as the browser does when a picture is on the clipboard.
 *
 * `ClipboardEvent` with a `DataTransfer` is what the board reads; the system clipboard itself is not
 * involved, which is as well — a test that wrote to the machine's clipboard would be measuring the
 * machine.
 */
export async function pasteFiles(page: Page, files: FileSpec[]): Promise<void> {
  await page.evaluate(
    ({ files }) => {
      const dataTransfer = new DataTransfer();
      for (const spec of files) {
        const binary = atob(spec.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(
          new File([bytes.buffer as ArrayBuffer], spec.name, { type: spec.type }),
        );
      }
      document
        .querySelector('[data-testid="app"]')!
        .dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }),
        );
    },
    { files: specs(files) },
  );
}

/** Every picture's box on the board, in the order they stand on it. */
export async function imageBoxes(page: Page): Promise<ImageBox[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-image-status]'))
      .map((element) => {
        const el = element as HTMLElement;
        const img = el.querySelector('img');
        const rect = el.getBoundingClientRect();
        return {
          id: el.dataset.imageId ?? '',
          status: el.dataset.imageStatus ?? '',
          // What the screen says: the state line when there is one, and otherwise the name the
          // box gives itself — a drawn picture has nothing to explain.
          label: (
            el.querySelector('[data-testid="image-state-label"]')?.textContent ??
            el.getAttribute('aria-label') ??
            ''
          ).trim(),
          x: parseFloat(el.style.left),
          y: parseFloat(el.style.top),
          w: parseFloat(el.style.width),
          h: parseFloat(el.style.height),
          src: img?.getAttribute('src') ?? null,
          naturalWidth: img?.naturalWidth ?? 0,
          drawn: img !== null && img.complete && (img.naturalWidth ?? 0) > 0,
          drawWidth: rect.width,
          drawHeight: rect.height,
          hasRetry: el.querySelector('[data-testid^="image-retry-"]') !== null,
          hasRemove: el.querySelector('[data-testid^="image-remove-"]') !== null,
        };
      })
      .sort((a, b) => a.x - b.x),
  );
}

/**
 * Press a picture the way a person does: a click on the box it is standing in.
 *
 * Where in the box is pressable is worth naming, because a box that has something to say has
 * buttons in it, and a click that lands on the box's own Retry button presses the button and not
 * the object — which is right, and is why a test that wants the object presses somewhere plain.
 */
export async function clickImage(
  page: Page,
  id: string,
  at: { dx?: number; dy?: number } = {},
): Promise<void> {
  const box = await page.locator(`[data-image-id="${id}"][data-image-status]`).boundingBox();
  if (!box) throw new Error(`no picture ${id} on the screen`);
  // The middle by default: the middle of a drawn picture is the picture. The <img> is not a target
  // of its own, so a click there arrives at the object rather than starting a drag of the file.
  const dx = at.dx ?? box.width / 2;
  const dy = at.dy ?? box.height / 2;
  await page.mouse.click(box.x + dx, box.y + dy);
}

/** What the board has said out loud, oldest first, without the dismiss control's own glyph. */
export async function toastTexts(page: Page): Promise<string[]> {
  // The words, and not the × beside them.
  return (await page.locator('[data-testid="toast-message"]').allInnerTexts()).map((text) =>
    text.trim(),
  );
}

