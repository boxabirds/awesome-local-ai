import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { dropFilesAt } from './drop-files';
import { getObjects, type ObjectSnapshot } from './helpers/board';
import {
  closeAll,
  expectWithin,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  newBoardId,
  openBoard,
  setCamera,
  waitForSynced,
  type Participant,
} from './participants';

/**
 * Story 12 e2e (chromium): dropping / picking / pasting images against the
 * real server (upload → R2 → serve). The camera is pinned to the identity
 * (world == screen) for deterministic geometry.
 */
const FIX = (name: string): string => path.join(process.cwd(), 'tests', 'fixtures', 'images', name);

async function images(page: Page): Promise<ObjectSnapshot[]> {
  return (await getObjects(page)).filter((o) => o.type === 'image');
}

/**
 * Opens the Image picker (the one-shot Image button) and hands the given file
 * paths to the file chooser it opens. The picker centres the new images in the
 * current view.
 */
async function addFilesViaPicker(page: Page, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="image-button"]'),
  ]);
  await chooser.setFiles(files);
}

/** Clicks the centre of an image (world pos + size, identity camera) to select it. */
async function selectImage(page: Page, img: ObjectSnapshot): Promise<void> {
  await page.mouse.click(img.x + img.width! / 2, img.y + img.height! / 2);
}

test.describe('story 12: images (e2e)', () => {
  // TC-26 is cross-browser (validation + toasts are pure UI).
  test.describe('cross-browser: validation toasts', () => {
  test('TC-26: a mixed picker batch — valid GIF added, 11 MB and renamed PDF rejected with toasts', async ({ browser }) => {
    const dana: Participant = await openBoard(browser, newBoardId());
    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });

      await addFilesViaPicker(dana.page, [FIX('too-large.jpg'), FIX('valid.gif'), FIX('renamed.pdf')]);

      // Exactly one image is added (the GIF) and it loads.
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'only the GIF is added and ready', async () => {
        const imgs = await images(dana.page);
        return imgs.length === 1 && imgs[0].status === 'ready' && imgs[0].contentType === 'image/gif';
      });

      // Both rejections surface as toasts.
      const toasts = await dana.page.locator('[data-testid="toast-message"]').allTextContents();
      expect(toasts.some((t) => t.includes('10 MB'))).toBe(true);
      expect(toasts.some((t) => t.includes('Only PNG, JPEG, GIF and WebP'))).toBe(true);
    } finally {
      await closeAll(dana);
    }
  });
  });

  // Chromium-only image workflows (real DataTransfer drop, mouse resize drag, retry).
  test.describe('chromium-only workflows', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only workflow');

  test('TC-25: moodboard with a colleague — shared placeholders, then loaded images, immutable GET', async ({ browser }) => {
    const board = newBoardId();
    const leo: Participant = await openBoard(browser, board);
    const sam: Participant = await openBoard(browser, board);
    try {
      await setCamera(leo.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });

      // Leo drops three screenshots at once (real DataTransfer drag).
      await dropFilesAt(leo.page, [FIX('screenshot-a.png'), FIX('screenshot-b.png'), FIX('screenshot-c.png')], 400, 300);

      // Sam's context sees the shared placeholders appear, then all three
      // images loaded, within the live-update budget.
      let samImgs: ObjectSnapshot[] = [];
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Sam sees three image objects appear', async () => {
        samImgs = await images(sam.page);
        return samImgs.length === 3;
      });
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Sam sees all three images ready', async () => {
        samImgs = await images(sam.page);
        return samImgs.length === 3 && samImgs.every((o) => o.status === 'ready');
      });
      expect(samImgs.every((o) => o.status === 'ready')).toBe(true);
      // Leo also sees all three ready.
      const leoImgs = await images(leo.page);
      expect(leoImgs.length).toBe(3);
      expect(leoImgs.every((o) => o.status === 'ready')).toBe(true);

      // The serve endpoint carries immutable long-term caching.
      const key = leoImgs[0].assetKey as string;
      const cc = await leo.page.evaluate(async (k: string) => (await fetch(`/api/assets/${k}`)).headers.get('cache-control'), key);
      expect(cc).toMatch(/immutable/);
    } finally {
      await closeAll(leo, sam);
    }
  });

  test('TC-27: resize keeps the aspect ratio and the new size survives a reload', async ({ browser }) => {
    const dana: Participant = await openBoard(browser, newBoardId());
    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });

      await addFilesViaPicker(dana.page, [FIX('resizable.png')]);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'image ready', async () => {
        const imgs = await images(dana.page);
        return imgs.length === 1 && imgs[0].status === 'ready';
      });
      const before = (await images(dana.page))[0];
      const id = before.id;

      // Select the image and drag its SE handle to grow it.
      await selectImage(dana.page, before);
      const handle = dana.page.locator('[data-testid="selection-overlay"] [data-handle="se"]');
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      const hx = box!.x + box!.width / 2;
      const hy = box!.y + box!.height / 2;
      await dana.page.mouse.move(hx, hy);
      await dana.page.mouse.down();
      await dana.page.mouse.move(hx + 80, hy + 60, { steps: 6 });
      await dana.page.mouse.up();

      const after = (await getObjects(dana.page)).find((o) => o.id === id)!;
      expect(after.width!).toBeGreaterThan(before.width!);
      expect(after.height!).toBeGreaterThan(before.height!);
      // Aspect ratio is preserved.
      expect(Math.abs(before.width! / before.height! - after.width! / after.height!)).toBeLessThan(0.02);

      // A reload shows the same image, still ready at the same size (no re-upload).
      await dana.page.reload();
      await waitForSynced(dana.page);
      const reloaded = (await images(dana.page)).find((o) => o.id === id)!;
      expect(reloaded.status).toBe('ready');
      expect(reloaded.width!).toBeCloseTo(after.width!, 0);
      expect(reloaded.height!).toBeCloseTo(after.height!, 0);
    } finally {
      await closeAll(dana);
    }
  });

  test('TC-28: a failed upload shows the failed box; Retry uploads and succeeds', async ({ browser }) => {
    const dana: Participant = await openBoard(browser, newBoardId());
    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });

      // Make the next storage PUT fail once (worker x-test-fail-asset-put hook).
      await dana.page.evaluate(() => (window as unknown as { __vidi6: { setNextAssetPutFailure: (on: boolean) => void } }).__vidi6.setNextAssetPutFailure(true));

      await addFilesViaPicker(dana.page, [FIX('retry.png')]);
      // Wait until the single image settles to 'failed' (the injected PUT failure).
      await expect
        .poll(async () => (await images(dana.page))[0]?.status, { timeout: 15_000 })
        .toBe('failed');
      const failed = (await images(dana.page))[0];
      const id = failed.id;
      expect(failed.status).toBe('failed');

      // The failed box exposes a Retry button; clicking it re-uploads and the
      // second PUT succeeds → ready with a visible <img>.
      await dana.page.click(`[data-id="${id}"] [data-testid="image-retry"]`);
      await expectWithin(15_000, 'image ready after retry', async () => {
        const imgs = await images(dana.page);
        return imgs.length === 1 && imgs[0].status === 'ready';
      });
      await expect(dana.page.locator(`[data-id="${id}"] [data-testid="image-ready"]`)).toBeVisible();
    } finally {
      await closeAll(dana);
    }
  });
  });
});
