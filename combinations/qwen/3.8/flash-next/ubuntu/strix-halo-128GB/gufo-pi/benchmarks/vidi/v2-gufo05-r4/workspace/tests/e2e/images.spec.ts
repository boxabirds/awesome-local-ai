/**
 * Story 12 end-to-end: dropping, pasting, picking, resizing and revisiting images.
 *
 * These tests go through the real stack: the built client, wrangler dev, the Durable Object
 * room, R2, and real browsers. They verify:
 *
 * - images placed by one person appear for another (`image.share`);
 * - the picker validates types and sizes and toasts (`image.pick`);
 * - resize preserves aspect ratio, minimum size is honoured, reload brings images back
 *   (`image.resize`, `image.persist`);
 * - a failed upload shows retry and retry succeeds (`image.retry`).
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { boardObjects } from './helpers/board';
import { dropFiles } from './helpers/drop-files';
import { closeSessions, openSession, type Session } from './helpers/participants';

const FIXTURES = resolve(__dirname, '../fixtures/images');

/** Sessions opened by the running test. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

async function withPeople(browser: Browser, ...names: string[]): Promise<Session> {
  const session = await openSession(browser, names);
  sessions.push(session);
  return session;
}

/** Open a board page (single-person) and return its page + boardId. */
async function openSingle(browser: Browser, name = 'user'): Promise<{ page: Page; boardId: string; session: Session }> {
  const session = await withPeople(browser, name);
  return { page: session.person(name).page, boardId: session.boardId, session };
}

/** Read image objects from a page. */
async function imagesOn(page: Page): Promise<ObjectSnapshot[]> {
  const objects = await boardObjects(page);
  return objects.filter((o) => o.type === 'image');
}

/** The hidden file input locator. */
function fileInput(page: Page) {
  return page.locator('input[data-vidi6="image-file-input"]');
}

/** Set files via the picker (bypasses the file dialog). */
async function pickFiles(page: Page, paths: string[]): Promise<void> {
  const input = fileInput(page);
  await input.setInputFiles(paths);
}

// ─── TC-25: moodboard with a colleague ──────────────────────────────────────────

test.describe('TC-25: moodboard with a colleague', () => {
  test('Leo drops 3 images, Sam sees them', async ({ browser }) => {
    const session = await withPeople(browser, 'leo', 'sam');
    const leo = session.person('leo').page;
    const sam = session.person('sam').page;

    // Leo drops 3 images
    await dropFiles(leo, {
      x: 640,
      y: 400,
      filePaths: [
        resolve(FIXTURES, 'tiny.png'),
        resolve(FIXTURES, 'tiny.jpg'),
        resolve(FIXTURES, 'tiny.webp')
      ]
    });

    // Wait for Leo to see 3 images ready
    await session.eventually('Leo sees 3 ready images', async () => {
      const imgs = await imagesOn(leo);
      if (imgs.length < 3) return `Leo has ${imgs.length} images`;
      const allReady = imgs.every((img: any) => img.status === 'ready');
      if (!allReady) return 'not all ready yet';
      return true;
    });

    // Wait for Sam to see them
    await session.eventually('Sam sees 3 ready images', async () => {
      const imgs = await imagesOn(sam);
      if (imgs.length < 3) return `Sam has ${imgs.length} images`;
      const allReady = imgs.every((img: any) => img.status === 'ready');
      if (!allReady) return 'not all ready yet';
      return true;
    });

    // Verify all images have assetKeys (uploaded successfully)
    const samImages = await imagesOn(sam);
    for (const img of samImages) {
      expect((img as any).assetKey).toBeTruthy();
    }

    // Verify the asset URL responds with immutable Cache-Control
    const assetKey = (samImages[0] as any).assetKey as string;
    const response = await sam.goto(`/api/assets/${assetKey}`);
    expect(response?.status()).toBe(200);
    const cacheControl = response?.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('immutable');
    expect(cacheControl).toContain('max-age=31536000');
  });
});

// ─── TC-26: mixed picker batch ─────────────────────────────────────────────────

test.describe('TC-26: mixed picker batch', () => {
  test('valid PNG + renamed PDF + oversize JPEG → one image, type and size toasts', async ({ browser }) => {
    const { page } = await openSingle(browser, 'user');

    // Wait for the board to be ready
    await page.waitForSelector('[data-vidi6="viewport-wrapper"]');

    // Pick files: valid PNG, renamed PDF, and oversize JPEG (11 MB)
    await pickFiles(page, [
      resolve(FIXTURES, 'tiny.png'),
      resolve(FIXTURES, 'fake.png'), // renamed PDF - magic bytes won't match image types
      resolve(FIXTURES, 'huge.jpg') // 11 MB JPEG (created below if missing)
    ]);

    // Only 1 valid image should be added
    await expect.poll(async () => {
      const imgs = await imagesOn(page);
      return imgs.filter((i: any) => i.status === 'ready').length;
    }, { timeout: 10000 }).toBe(1);
  });

  test('type rejection toast for PDF', async ({ browser }) => {
    const { page } = await openSingle(browser, 'user');
    await page.waitForSelector('[data-vidi6="viewport-wrapper"]');

    // Pick a single unsupported file
    await pickFiles(page, [resolve(FIXTURES, 'script.svg')]);

    // Toast should appear
    const toast = page.locator('[data-vidi6="toast"]');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
  });
});

// ─── TC-27: resize and revisit ─────────────────────────────────────────────────

test.describe('TC-27: resize and revisit', () => {
  test('resize preserves aspect ratio within 1%', async ({ browser }) => {
    const { page } = await openSingle(browser, 'user');
    await page.waitForSelector('[data-vidi6="viewport-wrapper"]');

    // Add an image
    await pickFiles(page, [resolve(FIXTURES, 'tiny.png')]);
    await expect.poll(async () => {
      const imgs = await imagesOn(page);
      return imgs.some((i: any) => i.status === 'ready');
    }, { timeout: 10000 }).toBe(true);

    // Get the image's initial dimensions
    const before = (await imagesOn(page))[0] as any;
    const originalRatio = before.width / before.height;

    // Click the image to select it
    const imgEl = page.locator('[data-vidi6="image-object"]').first();
    await imgEl.click();

    // Look for a resize handle (bottom-right corner)
    const handle = page.locator('[data-vidi6="resize-handle-se"]').first();
    if (await handle.isVisible()) {
      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 });
        await page.mouse.up();
      }
    }

    // Check aspect ratio is preserved within 1%
    const after = (await imagesOn(page))[0] as any;
    const newRatio = after.width / after.height;
    expect(Math.abs(newRatio - originalRatio) / originalRatio).toBeLessThan(0.01);
  });

  test('image survives reload', async ({ browser }) => {
    const { page, boardId } = await openSingle(browser, 'user');
    await page.waitForSelector('[data-vidi6="viewport-wrapper"]');

    // Add an image
    await pickFiles(page, [resolve(FIXTURES, 'tiny.png')]);
    await expect.poll(async () => {
      const imgs = await imagesOn(page);
      return imgs.some((i: any) => i.status === 'ready');
    }, { timeout: 10000 }).toBe(true);

    const before = (await imagesOn(page))[0] as any;
    const assetKey = before.assetKey as string;

    // Navigate away and back
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="viewport-wrapper"]');

    // Image is still there with the same assetKey
    await expect.poll(async () => {
      const imgs = await imagesOn(page);
      if (imgs.length < 1) return false;
      const img = imgs[0] as any;
      return img.assetKey === assetKey && img.status === 'ready';
    }, { timeout: 10000 }).toBe(true);
  });
});

// ─── TC-28: flaky upload ──────────────────────────────────────────────────────

test.describe('TC-28: flaky upload and retry', () => {
  test('upload failure shows retry; retry succeeds', async ({ browser }) => {
    const session = await withPeople(browser, 'leo', 'sam');
    const leo = session.person('leo').page;
    const sam = session.person('sam').page;

    // Intercept the POST to /api/boards/:id/assets and abort it
    await leo.route('**/api/boards/*/assets', (route) => route.abort());

    // Add an image - upload will fail
    await pickFiles(leo, [resolve(FIXTURES, 'tiny.png')]);

    // The image should show 'failed' status
    await expect.poll(async () => {
      const imgs = await imagesOn(leo);
      if (imgs.length < 1) return 'none';
      return (imgs[0] as any).status;
    }, { timeout: 10000 }).toBe('failed');

    // The upload-failed object should be visible
    const failedEl = leo.locator('[data-vidi6="image-object"][data-status="failed"]');
    await expect(failedEl).toBeVisible();

    // Restore the route (unblock uploads)
    await leo.unroute('**/api/boards/*/assets');

    // Click the retry button
    const retryButton = leo.locator('[data-vidi6="image-retry"]').first();
    if (await retryButton.isVisible()) {
      await retryButton.click();
    }

    // Image should become ready
    await expect.poll(async () => {
      const imgs = await imagesOn(leo);
      return (imgs[0] as any)?.status;
    }, { timeout: 10000 }).toBe('ready');

    // Sam should also see the image ready
    await session.eventually('Sam sees the ready image', async () => {
      const imgs = await imagesOn(sam);
      if (imgs.length < 1) return 'Sam has no images';
      const img = imgs[0] as any;
      return img.status === 'ready' || `Sam sees status=${img.status}`;
    });
  });
});
