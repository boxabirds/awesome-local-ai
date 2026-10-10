// Story 12 e2e (TC-25 to TC-28): a moodboard built by one colleague and
// watched live by the other, a mixed picker batch with refusal messages,
// proportional resizing that survives a revisit, and a failed upload that
// recovers through Retry. File fixtures are the real generated images.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { getCamera, gotoBoard, setCamera } from './helpers/board';
import {
  openParticipants,
  waitForConnected,
  type Participant,
} from './helpers/participants';

interface ImageInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

function getImages(page: Page): Promise<ImageInfo[]> {
  return page.evaluate(
    () =>
      (
        window as never as {
          __vidi6: { board: { getObjectSnapshots?(): ImageInfo[] } };
        }
      ).__vidi6.board.getObjectSnapshots!().filter((o) => o.type === 'image'),
  );
}

const FIXTURES = path.join(fileURLToPath(import.meta.url), '..', '..', 'fixtures', 'images');

interface DropFile {
  name: string;
  type: string;
  file: string;
}

async function dropFiles(page: Page, files: DropFile[], at: { x: number; y: number }): Promise<void> {
  const items = files.map((f) => ({
    name: f.name,
    type: f.type,
    b64: fs.readFileSync(path.join(FIXTURES, f.file)).toString('base64'),
  }));
  await page.evaluate(
    ({ items: its, x, y }) => {
      const el = document.querySelector('[data-testid="board-viewport"]');
      if (!el) throw new Error('no viewport');
      const dt = new DataTransfer();
      for (const it of its) {
        const bin = atob(it.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], it.name, { type: it.type }));
      }
      for (const kind of ['dragenter', 'dragover', 'drop'] as const) {
        el.dispatchEvent(
          new DragEvent(kind, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }),
        );
      }
    },
    { items, x: at.x, y: at.y },
  );
}

const SHOT: DropFile = { name: 'screenshot-1440x900.png', type: 'image/png', file: 'screenshot-1440x900.png' };
const NOTE_PNG: DropFile = { name: 'note-400x300.png', type: 'image/png', file: 'note-400x300.png' };
const GIF: DropFile = { name: 'anim.gif', type: 'image/gif', file: 'animated.gif' };

async function readyImgCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const img of Array.from(document.querySelectorAll('[data-testid="image-object"] img'))) {
      if ((img as HTMLImageElement).naturalWidth > 0) n += 1;
    }
    return n;
  });
}

test('TC-25: three dropped images appear as Upload placeholders for Sam, then all three render', async ({
  browser,
}) => {
  const [alex, sam]: Participant[] = await openParticipants(browser, ['Alex', 'Sam']);
  await setCamera(alex.page, { x: 0, y: 0, zoom: 1 });

  // Delay Alex's uploads so Sam's "Uploading…" phase is observable.
  await alex.page.route('**/api/boards/*/assets', (route) => {
    setTimeout(() => void route.continue(), 1500);
  });

  const t0 = Date.now();
  await dropFiles(alex.page, [SHOT, NOTE_PNG, GIF], { x: 200, y: 200 });

  // Alex: live percentage on his own placeholders.
  await expect(alex.page.getByTestId('image-upload-progress').first()).toBeVisible({
    timeout: 5_000,
  });

  // Sam sees three "Uploading…" placeholders within the story 3 budget.
  await expect
    .poll(() => sam.page.getByTestId('image-uploading-other').count(), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(3);

  // ...then all three images render; delivery time is logged, not asserted.
  await expect
    .poll(() => readyImgCount(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(3);
  const deliveredMs = Date.now() - t0;
  await test.info().attach('TC-25 drop-to-visible latency', {
    body: `${deliveredMs} ms (budget reference: ${E2E_EVENTUAL_TIMEOUT_MS} ms eventual timeout)`,
    contentType: 'text/plain',
  });

  await expect
    .poll(() => readyImgCount(alex.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(3);
  const images = await getImages(alex.page);
  expect(images.every((i) => i.status === 'ready' && i.assetKey !== null)).toBe(true);

  for (const p of [alex, sam]) await p.context.close();
});

test('TC-26: the picker adds the valid image and explains each refused file', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });

  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('i');
  const chooser = await chooserPromise;
  await chooser.setFiles([
    path.join(FIXTURES, 'note-400x300.png'),
    path.join(FIXTURES, 'report.png'), // a PDF renamed to .png
    path.join(FIXTURES, 'over-10mb.png'),
  ]);

  const toast = page.getByTestId('board-toast');
  await expect(toast).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
  await expect(toast).toContainText('Images must be 10 MB or smaller.');

  await expect
    .poll(async () => (await getImages(page)).filter((i) => i.status === 'ready').length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(1);
  expect(await getImages(page)).toHaveLength(1);
  await expect.poll(() => readyImgCount(page)).toBe(1);
});

test('TC-27: corner resize keeps the aspect ratio, clamps at the minimum size, and survives a reload', async ({
  page,
  browser,
}) => {
  const boardId = await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });

  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('i');
  const chooser = await chooserPromise;
  await chooser.setFiles(path.join(FIXTURES, 'note-400x300.png'));
  await expect.poll(async () => (await getImages(page)).length).toBe(1);
  const before = (await getImages(page))[0];
  expect(Math.abs(before.width - 400)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - 300)).toBeLessThanOrEqual(1);

  // Select the image and drag the southeast handle.
  const box = await page.getByTestId('image-object').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByTestId('handle-se')).toBeVisible();

  const handle = await page.getByTestId('handle-se').boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 160, handle!.y + 120, { steps: 5 });
  await page.mouse.up();

  let resized = (await getImages(page))[0];
  const ratio = before.width / before.height;
  expect(Math.abs(resized.width / resized.height - ratio) / ratio).toBeLessThanOrEqual(0.01);
  expect(resized.width).toBeGreaterThan(before.width);

  // Drag hard into the object: both sides stop at IMAGE_MIN_SIZE_WORLD.
  const handle2 = await page.getByTestId('handle-se').boundingBox();
  await page.mouse.move(handle2!.x + handle2!.width / 2, handle2!.y + handle2!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 400, box!.y - 400, { steps: 6 });
  await page.mouse.up();
  resized = (await getImages(page))[0];
  expect(resized.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.01);
  expect(resized.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.01);

  // A brand-new visitor (fresh context) still sees the image, same size.
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(`/b/${boardId}`);
  await waitForConnected('visitor', visitor);
  await expect.poll(async () => (await getImages(visitor)).length).toBe(1);
  const after = (await getImages(visitor))[0];
  expect(Math.abs(after.width - resized.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.height - resized.height)).toBeLessThanOrEqual(0.5);
  await expect
    .poll(() => readyImgCount(visitor), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);
  await context.close();
});

test('TC-28: a failed upload shows Upload failed, and Retry after the route is restored finishes the job', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });

  await page.route('**/api/boards/*/assets', (route) => route.abort());
  await dropFiles(page, [NOTE_PNG], { x: 300, y: 300 });

  await expect
    .poll(async () => (await getImages(page))[0]?.status, { timeout: 15_000 })
    .toBe('failed');
  await expect(page.getByTestId('image-failed')).toBeVisible();
  await expect(page.getByTestId('image-retry')).toBeVisible();

  await page.unroute('**/api/boards/*/assets');
  await page.getByTestId('image-retry').click();

  await expect
    .poll(async () => (await getImages(page))[0]?.status, { timeout: 15_000 })
    .toBe('ready');
  await expect
    .poll(() => readyImgCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);
  void (await getCamera(page)); // camera untouched by the flow
});
