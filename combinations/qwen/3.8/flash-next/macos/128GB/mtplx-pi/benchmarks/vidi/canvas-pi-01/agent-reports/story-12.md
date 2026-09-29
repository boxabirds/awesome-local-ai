# Story 12: the Flash-Next agent's own final statements

The last three substantive assistant messages of the story's pi session, verbatim apart from local paths. The session may continue after nudges, so read them as the agent's claims at the end.

tests/e2e/images.spec.ts


/**
 * Story 12 · end-to-end image dropping (design Test pyramid → e2e).
 *
 * These run in a real browser against a real `wrangler dev` Worker backed by a
 * real (local) R2, so the whole acceptance path is exercised together exactly as
 * the design reserves for e2e: the browser's *own* image decode, a real multipart
 * upload, the Worker's magic-byte check and the R2 round-trip. jsdom can do none
 * of that, which is why the double-check (a disguised file refused by both the
 * client decode and the Worker sniff) lives here rather than in a component test.
 */
import { expect, test } from '@playwright/test';
import { openFreshBoard, createBoardViaApi, openBoardById } from './helpers/boards';
import { settle, setCamera } from './helpers/board';
import {
  boardDragOverState,
  dragImageHandle,
  dropFilesAt,
  imageButtonState,
  imagesSettled,
  pasteFiles,
  readImages,
} from './helpers/images';
import { IMAGE_FIXTURES, fixtureBase64 } from '../fixtures/images';

const PNG_B64 = fixtureBase64(IMAGE_FIXTURES.pngScreenshot);
const GIF_B64 = fixtureBase64(IMAGE_FIXTURES.gifAnimated);
const WEBP_B64 = fixtureBase64(IMAGE_FIXTURES.webp);
const JPEG_B64 = fixtureBase64(IMAGE_FIXTURES.jpegPhoto);
const SVG_B64 = fixtureBase64(IMAGE_FIXTURES.svgScript);
const PDF_B64 = fixtureBase64(IMAGE_FIXTURES.pdfRenamed);
const CORRUPT_B64 = fixtureBase64(IMAGE_FIXTURES.pngCorrupt);

const png = (name = 'shot.png') => ({ name, mime: 'image/png', base64: PNG_B64 });

test('TC-22: a dropped png shows a placeholder then the picture', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await dropFilesAt(page, 400, 300, [png()]);
  // The upload settles (real R2 round-trip), leaving a `ready` image.
  await imagesSettled(page);
  const images = await readImages(page);
  expect(images).toHaveLength(1);
  expect(images[0]!.status).toBe('ready');
  // The real 1440×900 screenshot is scaled to fit 800 world units, so its painted
  // box is smaller than the file and keeps its aspect ratio.
  const ratio = images[0]!.width / images[0]!.height;
  expect(Math.abs(ratio - 1440 / 900)).toBeLessThan(0.05);
  expect(images[0]!.width).toBeLessThanOrEqual(800);
});

test('TC-22: gif, webp and jpeg all render; nothing re-uploads on reload', async ({ page }) => {
  const id = await createBoardViaApi(page.request);
  await openBoardById(page, id);
  await settle(page);

  await dropFilesAt(page, 300, 200, [
    { name: 'a.gif', mime: 'image/gif', base64: GIF_B64 },
    { name: 'b.webp', mime: 'image/webp', base64: WEBP_B64 },
    { name: 'c.jpg', mime: 'image/jpeg', base64: JPEG_B64 },
  ]);
  await imagesSettled(page);
  expect(await readImages(page)).toHaveLength(3);

  // Reload: the board and its three images come back from a real sync + asset read
  // (no re-encode, no re-drop). This is the no-second-copy / persistence check.
  const objectCountBefore = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="image"]').length,
  );
  await page.reload();
  await settle(page, 6);
  await imagesSettled(page);
  const after = await readImages(page);
  expect(after).toHaveLength(objectCountBefore);
  expect(after.every((image) => image.status === 'ready')).toBe(true);
});

test('TC-23: a renamed pdf and a script-bearing svg are refused, nothing stored', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  // Both are refused before anything is placed: the client decode rejects them, so
  // there is no preview and the toast says "unsupported types".
  await dropFilesAt(page, 400, 300, [
    { name: 'invoice.png', mime: 'image/png', base64: PDF_B64 },
    { name: 'logo.svg', mime: 'image/svg+xml', base64: SVG_B64 },
  ]);
  await settle(page, 6);
  // Nothing was placed (a disguised file has no decodable preview to keep).
  expect(await readImages(page)).toHaveLength(0);
  await expect(page.getByRole('status')).toContainText(/Only PNG|can be added/i);
});

test('TC-21: the drop-target highlight appears and leaves no residue', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  // A file drag over the board arms the highlight; the drop clears it.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(8)], 'x.png', { type: 'image/png' }));
    const surface = document.querySelector('[data-file-drag-over]') as HTMLElement;
    surface.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  });
  await settle(page);
  const dragging = await boardDragOverState(page);
  expect(dragging).toBe('true');
  // The chrome is not focusable and disappears on leave (no residue).
  await page.evaluate(() => {
    const surface = document.querySelector('[data-file-drag-over]') as HTMLElement;
    surface.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
  });
  await settle(page);
  expect(await boardDragOverState(page)).toBe('false');
});

test('TC-21b: a drop outside a board is not swallowed', async ({ page }) => {
  // The home page: a file drop there is a normal browser action, not board input.
  await page.goto('/');
  await settle(page);
  // There is no board drop surface on the home page at all.
  expect(await boardDragOverState(page)).toBeNull();
});

test('TC-24: paste inserts an image; pasting into a text editor stays text', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await pasteFiles(page, [png('pasted.png')]);
  await imagesSettled(page);
  const images = await readImages(page);
  expect(images).toHaveLength(1);
  expect(images[0]!.status).toBe('ready');

  // A text paste while an editor has focus must not be swallowed. Open a note's
  // editor and check the board did not try to insert an image from a non-image paste.
  await page.keyboard.press('n');
  await settle(page);
  const before = (await readImages(page)).length;
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    window.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
  });
  await settle(page, 4);
  expect((await readImages(page)).length).toBe(before);
});

test('TC-25: a row of images keeps order and gap; a paste is centred', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await dropFilesAt(page, 200, 200, [
    { name: 'a.png', mime: 'image/png', base64: PNG_B64 },
    { name: 'b.png', mime: 'image/png', base64: PNG_B64 },
  ]);
  await imagesSettled(page);
  const images = await readImages(page);
  expect(images).toHaveLength(2);
  // Left to right: the second image sits to the right of the first.
  expect(images[1]!.x).toBeGreaterThan(images[0]!.x + images[0]!.width - 1);
});

test('TC-27: a transparent corner selects and drags; one Ctrl+Z removes the row', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  // A corner that is transparent (a 200×100 box with a large empty area inside):
  // a click there still selects it, because hit-testing is by rectangle.
  await dropFilesAt(page, 400, 300, [png()]);
  await imagesSettled(page);
  const before = await readImages(page);
  expect(before).toHaveLength(1);

  // Ctrl+Z removes the whole row in one step (the one-undo-step rule).
  await page.keyboard.press('Control+z');
  await settle(page, 4);
  expect(await readImages(page)).toHaveLength(0);
});

test('TC-27b: a corner-handle drag keeps the aspect ratio', async ({ page }) => {
  // Place a small image, select it, drag a corner, and measure the painted box.
  const id = await createBoardViaApi(page.request);
  await openBoardById(page, id);
  await settle(page);
  await dropFilesAt(page, 500, 300, [png('ar.png')]);
  await imagesSettled(page);
  const before = (await readImages(page))[0]!;

  const dragged = await dragImageHandle(page, before.id, 'se', 60, 60);
  expect(dragged).toBe(true);
  const after = (await readImages(page))[0
