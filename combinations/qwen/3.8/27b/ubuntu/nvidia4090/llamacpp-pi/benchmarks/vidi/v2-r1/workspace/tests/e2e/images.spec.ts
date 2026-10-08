// Story 12 e2e (images config): drop images onto the board.
//
//   TC-25  a real (synthetic-DataTransfer) drop of three fixture PNGs on
//          Priya's screen: Priya sees three grey placeholders with progress,
//          Sam sees three "Uploading…" boxes; when the uploads finish all
//          three images are ready on both screens, in a row at the drop
//          point. The drop-to-visible time on Sam is logged against
//          LIVE_UPDATE_LATENCY_BUDGET_MS (reported, not asserted — shared
//          machine). Chromium + firefox.
//   TC-26  the Image tool picker with a mixed batch (valid PNG + PDF renamed
//          .png + 11 MB JPEG): one image is added; the type and size toasts
//          appear. Chromium-only.
//   TC-27  a picked 800x600 image resized from the corner keeps its aspect
//          ratio (±1%) and never shrinks below IMAGE_MIN_SIZE_WORLD; the
//          resized image survives a reload in a new context. Chromium-only.
//   TC-28  a drop whose upload is aborted (route abort) shows "Upload
//          failed" with Retry; with the route restored, Retry re-sends the
//          file and the image becomes ready. Chromium-only.
//
// Each test runs its own `wrangler dev` (tests/e2e/wrangler-process.ts) and
// pins the camera to the origin at 100% (screen == world). (webkit is not in
// the matrix on this host — it needs the system library `libavif13`; see
// NOTES.md.)

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import {
  jpegBytes,
  pdfBytes,
  pngBytes,
} from '../fixtures/images';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';
import { createBoard, openBoard, objectsOf, setCamera } from './shape-helpers';
import { dropFilesAt, type DropFile } from './drop-files';

function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium-only');
}

/** Three small fixture PNGs (all under the 800-unit placement cap). */
function fixtureDropFiles(): DropFile[] {
  return [
    { name: 'a.png', type: 'image/png', bytes: pngBytes(400, 300) },
    { name: 'b.png', type: 'image/png', bytes: pngBytes(200, 100) },
    { name: 'c.png', type: 'image/png', bytes: pngBytes(300, 450) },
  ];
}

/** Delay the upload responses on `ctx` (the requests still reach wrangler). */
async function delayUploads(ctx: BrowserContext, ms: number): Promise<void> {
  await ctx.route('**/api/boards/*/assets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const resp = await route.fetch();
    const body = await resp.text();
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ status: resp.status(), contentType: 'application/json', body });
  });
}

const readyImages = (page: Page) =>
  page.locator('[data-testid="image-object"][data-status="ready"]');

test.describe('story 12: drop images onto the board (wrangler)', () => {
  test('TC-25: a drop of 3 images shows placeholders to the uploader and Uploading to Sam, then all ready on both screens', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);

      const priyaCtx = await browser.newContext();
      ctxs.push(priyaCtx);
      const priya = await priyaCtx.newPage();
      await openBoard(priya, boardId);
      await setCamera(priya, { x: 0, y: 0, zoom: 1 });

      const samCtx = await browser.newContext();
      ctxs.push(samCtx);
      const sam = await samCtx.newPage();
      await openBoard(sam, boardId);
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });

      // Slow the uploads down so the uploading states are observable.
      await delayUploads(priyaCtx, 2500);

      const dropStart = Date.now();
      await dropFilesAt(priya, fixtureDropFiles(), 100, 50);

      // The uploader sees three placeholders (grey box + progress bar).
      await expect(priya.locator('[data-testid="image-placeholder"]')).toHaveCount(3, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      await expect(priya.locator('[data-testid="image-progress"]')).toHaveCount(3);

      // Sam sees the same three objects as "Uploading…" boxes.
      await expect(sam.locator('[data-testid="image-object"]')).toHaveCount(3, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      await expect(sam.locator('[data-testid="image-uploading-label"]')).toHaveCount(3, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });

      // The uploads finish: all three images are ready (and loaded) on both
      // screens. Log the delivery time against the budget (reported only).
      await expect(readyImages(sam)).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const dropToVisibleMs = Date.now() - dropStart;
      console.log(
        `TC-25: drop-to-visible on Sam ${dropToVisibleMs} ms ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, reported not asserted)`,
      );
      await expect(readyImages(priya)).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Row layout: first image's top-left at the drop point, 24-unit gaps.
      const priyaImgs = (await objectsOf(priya, 'image')).sort((a, b) => a.x - b.x);
      expect(priyaImgs).toHaveLength(3);
      expect(priyaImgs[0]!.x).toBeCloseTo(100, 0);
      expect(priyaImgs[0]!.y).toBeCloseTo(50, 0);
      expect(priyaImgs[0]!.width).toBeCloseTo(400, 0);
      expect(priyaImgs[0]!.height).toBeCloseTo(300, 0);
      expect(priyaImgs[1]!.x).toBeCloseTo(100 + 400 + IMAGE_LAYOUT_GAP_WORLD, 0);
      expect(priyaImgs[2]!.x).toBeCloseTo(
        100 + 400 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD,
        0,
      );
      expect(priyaImgs[1]!.y).toBeCloseTo(50, 0);
      expect(priyaImgs[2]!.y).toBeCloseTo(50, 0);

      // The images actually load from the asset route (not blank).
      await expect
        .poll(async () =>
          priya
            .locator('[data-testid="image-img"]')
            .first()
            .evaluate((el) => (el as HTMLImageElement).naturalWidth),
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBeGreaterThan(0);
    } finally {
      for (const c of ctxs) await c.close();
      await wrangler.dispose();
    }
  });

  test('TC-26: picker with a valid PNG, a renamed PDF and an 11 MB JPEG adds one image and shows the type and size toasts', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);
      await setCamera(page, { x: 0, y: 0, zoom: 1 });

      // The Image tool: the I key opens the (hidden) picker input.
      await page.keyboard.press('i');
      const picker = page.locator('[data-testid="image-picker"]');
      await picker.setInputFiles([
        { name: 'valid.png', mimeType: 'image/png', buffer: Buffer.from(pngBytes(300, 200)) },
        { name: 'document.png', mimeType: 'image/png', buffer: Buffer.from(pdfBytes()) },
        { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBytes(11 * 1024 * 1024)) },
      ]);

      // Exactly one image is added (the valid PNG).
      await expect(async () => {
        expect(await objectsOf(page, 'image')).toHaveLength(1);
      }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const img = (await objectsOf(page, 'image'))[0]!;
      expect(img.width).toBeCloseTo(300, 0);
      expect(img.height).toBeCloseTo(200, 0);
      await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // The rejections are reported with the exact PRD messages.
      await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
      await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
    } finally {
      for (const c of ctxs) await c.close();
      await wrangler.dispose();
    }
  });

  test('TC-27: resizing keeps the aspect ratio (±1%) and enforces the minimum size; the image survives a reload', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);
      await setCamera(page, { x: 0, y: 0, zoom: 1 });

      // Pick an 800x600 image: centred in the 1280x800 viewport it lands at
      // (240, 100) and occupies (640, 400) at its centre.
      await page.keyboard.press('i');
      await page
        .locator('[data-testid="image-picker"]')
        .setInputFiles([
          { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(pngBytes(800, 600)) },
        ]);
      await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Select it and enlarge from the bottom-right corner.
      await page.mouse.click(640, 400);
      const handle = page.getByRole('button', { name: 'Resize bottom-right' });
      const box = await handle.boundingBox();
      if (!box) throw new Error('Resize bottom-right handle not found');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 75, { steps: 10 });
      await page.mouse.up();

      let img = (await objectsOf(page, 'image'))[0]!;
      expect(img.width).toBeGreaterThan(800);
      const ratio = img.width / img.height;
      expect(Math.abs(ratio - 800 / 600) / (800 / 600)).toBeLessThan(0.01);

      // Shrink far below the minimum: the sides clamp at IMAGE_MIN_SIZE_WORLD.
      const handle2 = page.getByRole('button', { name: 'Resize bottom-right' });
      const box2 = await handle2.boundingBox();
      if (!box2) throw new Error('Resize bottom-right handle not found (2)');
      await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
      await page.mouse.down();
      await page.mouse.move(box2.x + box2.width / 2 - 800, box2.y + box2.height / 2 - 600, {
        steps: 10,
      });
      await page.mouse.up();

      img = (await objectsOf(page, 'image'))[0]!;
      expect(img.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
      expect(img.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
      expect(img.width).toBeLessThan(800);

      // Reload in a new context: the (resized) image is still there and its
      // bytes still load from the asset route.
      const ctx2 = await browser.newContext();
      ctxs.push(ctx2);
      const page2 = await ctx2.newPage();
      await openBoard(page2, boardId);
      await setCamera(page2, { x: 0, y: 0, zoom: 1 });
      await expect(readyImages(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const reloaded = (await objectsOf(page2, 'image'))[0]!;
      expect(reloaded.id).toBe(img.id);
      expect(reloaded.width).toBeCloseTo(img.width, 0);
      expect(reloaded.height).toBeCloseTo(img.height, 0);
    } finally {
      for (const c of ctxs) await c.close();
      await wrangler.dispose();
    }
  });

  test('TC-28: an aborted upload shows Upload failed; Retry with the route restored makes the image ready', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);
      await setCamera(page, { x: 0, y: 0, zoom: 1 });

      // Abort the upload: the placeholder goes to "Upload failed" with Retry.
      await ctx.route('**/api/boards/*/assets', (route) => route.abort());
      await dropFilesAt(page, [fixtureDropFiles()[0]!], 60, 60);
      await expect(page.locator('[data-testid="image-failed"]')).toHaveCount(1, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      await expect(page.getByText('Upload failed')).toBeVisible();

      // Restore the route and Retry: the same file is re-sent and the image
      // becomes ready.
      await ctx.unroute('**/api/boards/*/assets');
      await page.getByTestId('image-retry').click();
      await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      // The ready image's bytes load from the asset route.
      await expect
        .poll(async () =>
          page
            .locator('[data-testid="image-img"]')
            .evaluate((el) => (el as HTMLImageElement).naturalWidth),
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBeGreaterThan(0);
    } finally {
      for (const c of ctxs) await c.close();
      await wrangler.dispose();
    }
  });
});
