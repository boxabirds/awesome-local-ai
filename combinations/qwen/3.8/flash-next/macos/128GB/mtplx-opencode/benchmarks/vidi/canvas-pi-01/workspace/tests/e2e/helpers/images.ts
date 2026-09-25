/**
 * Story 12 · e2e helpers for images (Chromium/Firefox/WebKit, real browser).
 *
 * The whole point of the e2e tier is that a *real* image is decoded and a *real*
 * upload crosses the wire, so these helpers work with the actual fixtures and the
 * app's own file paths (drop, paste, the Image picker), not a fake. A file that a
 * browser cannot decode (a PDF, an SVG-with-script) is refused by the *client*
 * decode as well as by the Worker's magic-byte check — the double check the design
 * calls out is exercised here against a real stack.
 */
import { type Page } from '@playwright/test';
import { settle } from './board';

/** Turn a base64 PNG into a File, in the browser, and hand it to a drop/paste. */
async function filesFromBase64(
  page: Page,
  entries: Array<{ name: string; mime: string; base64: string }>,
): Promise<void> {
  await page.evaluate((items) => {
    const dt = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      dt.items.add(new File([bytes], item.name, { type: item.mime }));
    }
    (window as unknown as { __dt?: DataTransfer }).__dt = dt;
  }, entries);
}

/**
 * Drop the given files on the board at (x, y). A file drop is a `dragover` (which
 * arms the drop-target highlight) followed by a `drop`, both carrying the same
 * `dataTransfer`. Real file drags do carry `types: ['Files']`, so this is faithful.
 */
export async function dropFilesAt(
  page: Page,
  x: number,
  y: number,
  entries: Array<{ name: string; mime: string; base64: string }>,
): Promise<void> {
  await filesFromBase64(page, entries);
  await page.evaluate(
    ({ x, y }) => {
      const dt = (window as unknown as { __dt: DataTransfer }).__dt;
      const target = document.elementFromPoint(x, y) ?? document.body;
      const over = new DragEvent('dragover', { bubbles: true, dataTransfer: dt });
      target.dispatchEvent(over);
      const drop = new DragEvent('drop', { bubbles: true, dataTransfer: dt });
      target.dispatchEvent(drop);
    },
    { x, y },
  );
}

/** The board's file-drag highlight state (`data-file-drag-over`). */
export async function boardDragOverState(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-file-drag-over]');
    return el ? el.getAttribute('data-file-drag-over') : null;
  });
}

/** Paste the given files (as image/* clipboard items) into the board. */
export async function pasteFiles(
  page: Page,
  entries: Array<{ name: string; mime: string; base64: string }>,
): Promise<void> {
  await filesFromBase64(page, entries);
  await page.evaluate(() => {
    const dt = (window as unknown as { __dt: DataTransfer }).__dt;
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    window.dispatchEvent(event);
  });
}

export interface ImageReadout {
  id: string;
  status: string;
  /** Painted box, in CSS px, from the DOM. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Read every image object's painted box and status from the DOM.
 *
 * The DOM box is the *screen* size (world size × zoom), so at zoom 1 a 200×100
 * image measures 200×100 CSS px — that is what makes "the placed size is right"
 * an e2e fact rather than a stored-number echo.
 */
export async function readImages(page: Page): Promise<ImageReadout[]> {
  return page.evaluate(() => {
    const out: ImageReadout[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-testid="image"]'))) {
      const box = (el as HTMLElement).getBoundingClientRect();
      out.push({
        id: el.getAttribute('data-image-id') ?? '',
        status: el.getAttribute('data-status') ?? '',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
    return out;
  });
}

/** Wait until every image has left the `uploading` state (or `timeout` ms). */
export async function imagesSettled(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-testid="image"]')).every(
        (el) => el.getAttribute('data-status') !== 'uploading',
      ),
    undefined,
    { timeout },
  );
  await settle(page, 4);
}

/**
 * Drag an image's resize handle (by its `data-testid`) from its own centre, after
 * selecting the image. Returns false if the handle is not present (so the caller
 * can assert on that instead of timing out).
 */
export async function dragImageHandle(
  page: Page,
  imageId: string,
  handle: string,
  dx: number,
  dy: number,
): Promise<boolean> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await settle(page);
  // Select the image by a click inside its box.
  await page.locator(`[data-testid="image"][data-image-id="${imageId}"]`).click({
    position: { x: 5, y: 5 },
  });
  await settle(page, 4);
  const sel = page.locator(`[data-testid="image-handle-${handle}"]`);
  if ((await sel.count()) === 0) return false;
  const box = (await sel.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.5, from.y + dy * 0.5, { steps: 6 });
  await settle(page);
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await settle(page);
  await page.mouse.up();
  await settle(page, 4);
  return true;
}

/** The Image button opens the file picker; a disabled button proves offline read-only. */
export async function imageButtonState(page: Page): Promise<{ disabled: boolean; pressed: string | null }> {
  const button = page.getByTestId('tool-image');
  return {
    disabled: await button.isDisabled(),
    pressed: await button.getAttribute('aria-pressed'),
  };
}
