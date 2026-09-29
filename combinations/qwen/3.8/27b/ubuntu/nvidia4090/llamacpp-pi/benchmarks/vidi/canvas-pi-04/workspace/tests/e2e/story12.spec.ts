// Story 12, e2e (TC-25..TC-28): a real three-file drop renders and syncs to a
// second participant; the picker skips a PDF and an oversized file (with
// toasts); an aspect-locked resize persists after a reload; and a failed
// upload offers a retry that succeeds once the network recovers.
// Runs against `wrangler dev`.

import { expect, test, type Page } from '@playwright/test';
import {
  newBoard,
  openParticipant,
  closeParticipant,
  type Participant,
} from './participants';
import { setCamera } from './helpers/board';
import { IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

// Camera with the origin at the viewport top-left (world == screen at zoom 1).
const ZOOM1 = { x: 0, y: 0, zoom: 1 };

/** Wait until the page's board has first synced (connection state "connected"). */
async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6?.connectionState?.() ===
      'connected',
    undefined,
    { timeout: 15_000, polling: 100 },
  );
}
import {
  RED_PNG,
  BLUE_PNG,
  GREEN_PNG,
  DOC_PDF,
  oversizedFile,
  dropFilesAtCenter,
  pickFiles,
  expectImages,
  expectAllStatus,
  firstImageBox,
  dragImageHandle,
  selectFirstImage,
  IMAGE,
  IMAGE_READY,
  IMAGE_FAILED,
  IMAGE_RETRY,
  TOAST,
  IMAGE_UPLOADING,
} from './helpers/story12';

const UPLOAD_ROUTE = /\/api\/boards\/[^/]+\/assets$/;

test('TC-25: drop three files -> they render, sync, and are served immutable', async ({ browser, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  const sam: Participant = await openParticipant(browser, boardId);
  const dana: Participant = await openParticipant(browser, boardId);
  try {
    await setCamera(sam.page, ZOOM1);
    await setCamera(dana.page, ZOOM1);

    // Record the Cache-Control of every asset Dana's browser fetches.
    const cacheHeaders: string[] = [];
    dana.page.on('response', (res) => {
      if (!/\/api\/assets\//.test(res.url())) return;
      void res.headerValue('cache-control').then((v) => {
        if (v !== null) cacheHeaders.push(v);
      });
    });

    // Delay Sam's uploads so Dana observes the "Uploading…" placeholders
    // before the images land (design TC-25).
    await sam.page.route(UPLOAD_ROUTE, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });

    await dropFilesAtCenter(sam.page, [RED_PNG, BLUE_PNG, GREEN_PNG]);

    // Dana (a second participant) sees the "Uploading…" placeholders within
    // the live-update budget...
    await expect(dana.page.locator(IMAGE_UPLOADING)).toHaveCount(3, {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });

    // ...then the same three ready images (and so does Sam).
    await expectImages(dana.page, 3);
    await expectAllStatus(dana.page, 'ready');
    await expect(dana.page.locator(IMAGE_READY)).toHaveCount(3);

    // Sam's own placeholders resolve to ready images.
    await expectImages(sam.page, 3);
    await expectAllStatus(sam.page, 'ready');

    // Every served asset carries the long immutable cache.
    await expect
      .poll(async () => cacheHeaders.filter((c) => /immutable/.test(c)).length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(3);
  } finally {
    await closeParticipant(sam);
    await closeParticipant(dana);
  }
});

test('TC-26: the picker adds only valid files and toasts the rejections', async ({ page, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6?.connectionState?.() === 'connected',
    undefined,
    { timeout: 15_000, polling: 100 },
  );
  await setCamera(page, ZOOM1);

  // A valid PNG, a PDF, and an 11 MB file in one pick.
  await pickFiles(page, [RED_PNG, DOC_PDF, oversizedFile()]);

  // Only the PNG is added.
  await expectImages(page, 1);
  await expectAllStatus(page, 'ready');

  // The two rejections surface as toasts (type + size).
  const toasts = async () => page.locator(TOAST).allTextContents();
  await expect
    .poll(async () => (await toasts()).some((t) => /Only PNG, JPEG, GIF and WebP/.test(t)), { timeout: 5000 })
    .toBe(true);
  await expect
    .poll(async () => (await toasts()).some((t) => /Images must be 10 MB or smaller/.test(t)), { timeout: 5000 })
    .toBe(true);
});

test('TC-27: aspect-locked resize respects the floor and persists on revisit', async ({ page, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  await page.goto(`/b/${boardId}`);
  await waitForConnected(page);
  await setCamera(page, ZOOM1);

  await pickFiles(page, [RED_PNG]); // 240x160 (aspect 1.5)
  await expectAllStatus(page, 'ready');

  const before = await firstImageBox(page);
  const aspectBefore = before.width / before.height;

  // Aspect-locked grow: drag the SE corner wider (aspect stays within 1%).
  await selectFirstImage(page);
  await dragImageHandle(page, 'se', 120, 0, 1);
  const grown = await firstImageBox(page);
  expect(grown.width).toBeGreaterThan(before.width);
  expect(Math.abs(grown.width / grown.height - aspectBefore)).toBeLessThan(0.01);

  // Revisit: the grown size survives a reload.
  await page.waitForTimeout(300); // let the resize sync to the server
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForConnected(page);
  await setCamera(page, ZOOM1);
  await expectAllStatus(page, 'ready');
  const reloaded = await firstImageBox(page);
  expect(Math.abs(reloaded.width - grown.width)).toBeLessThan(4);
  expect(Math.abs(reloaded.height - grown.height)).toBeLessThan(4);

  // Floor: drag far below IMAGE_MIN_SIZE_WORLD -> it stops at the floor.
  await selectFirstImage(page);
  await dragImageHandle(page, 'se', -600, 0, 1);
  const floored = await firstImageBox(page);
  expect(floored.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
  expect(floored.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
  expect(floored.width).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 6);
  expect(floored.height).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 6);
});

test('TC-28: a failed upload shows a retry that succeeds once the network recovers', async ({ page, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6?.connectionState?.() === 'connected',
    undefined,
    { timeout: 15_000, polling: 100 },
  );
  await setCamera(page, ZOOM1);

  // Abort every upload until the retry.
  let blocked = true;
  await page.route(UPLOAD_ROUTE, (route) => (blocked ? route.abort() : route.continue()));

  await pickFiles(page, [RED_PNG]);

  // The image lands in the failed state (no <img>; the asset was never stored).
  await expect(page.locator(IMAGE_FAILED)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(IMAGE_READY)).toHaveCount(0);
  await expect(page.locator(IMAGE_RETRY)).toBeVisible();

  // The network recovers and the uploader retries.
  blocked = false;
  await page.locator(IMAGE_RETRY).click();
  await expectAllStatus(page, 'ready');
  await expect(page.locator(IMAGE_READY)).toBeVisible();
});
