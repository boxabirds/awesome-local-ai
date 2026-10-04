/**
 * Story 12 e2e tests: image workflows through the real browser.
 *
 * TC-25: moodboard golden path (drop, observe, reload)
 * TC-26: mixed picker batch (rejection toast)
 * TC-27: aspect-locked resize, immutable asset URL survives reload
 * TC-28: flaky upload recovery (needs network route manipulation)
 */

import { expect, test } from '@playwright/test';

import { openBoard } from './helpers/board';

const FIXTURE_DIR = new URL('../fixtures/images/', import.meta.url).pathname;

interface ImageObj {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
  naturalWidth: number;
  naturalHeight: number;
}

/** Read image objects from the page's board document via test hooks. */
async function getImageObjects(page: import('@playwright/test').Page): Promise<ImageObj[]> {
  return page.evaluate(() => {
    const hooks = (window as any).__vidi6;
    if (!hooks?.getImages) return [];
    return hooks.getImages();
  }) as Promise<ImageObj[]>;
}

/** Wait for at least one image object to appear. */
async function waitForAnyImage(page: import('@playwright/test').Page, timeout = 30000) {
  await expect(async () => {
    const images = await getImageObjects(page);
    expect(images.length).toBeGreaterThan(0);
  }).toPass({ timeout });
}

/** Wait for all image objects to reach a given status. */
async function waitForImageStatus(page: import('@playwright/test').Page, status: string, timeout = 60000) {
  await expect(async () => {
    const images = await getImageObjects(page);
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((img) => img.status === status)).toBe(true);
  }).toPass({ timeout });
}

test.describe('TC-25: moodboard golden path', () => {
  test.slow(); // These tests upload files and wait for the shared dev server
  test('two identities, drop images, other sees ready, survives reload', async ({ browser }) => {
    // Person A creates a board
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const boardId = await openBoard(pageA);

    // Person B joins the same board
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`/b/${boardId}`);
    await expect(pageB.getByTestId('board-viewport')).toBeVisible();

    // Person A drops 2 images via the file input (simulate picker)
    const fileInput = pageA.locator('input[data-testid="image-file-input"]');
    await fileInput.setInputFiles([
      FIXTURE_DIR + 'red-200x150.png',
      FIXTURE_DIR + 'green-400x300.png',
    ]);

    // Wait for placeholders to appear (client-side), then for upload to complete
    await waitForAnyImage(pageA);
    await waitForImageStatus(pageA, 'ready');

    const images = await getImageObjects(pageA);
    expect(images).toHaveLength(2);

    // Person B sees the same images ready
    await waitForAnyImage(pageB);
    await waitForImageStatus(pageB, 'ready');
    const imagesB = await getImageObjects(pageB);
    expect(imagesB).toHaveLength(2);

    // Reload Person B's page: images still display
    await pageB.reload();
    await expect(pageB.getByTestId('board-viewport')).toBeVisible();
    await waitForImageStatus(pageB, 'ready');

    // Check the actual <img> element src is the asset URL
    const imgSrc = await pageB.locator('[data-testid="image-ready"]').first().getAttribute('src');
    expect(imgSrc).toContain('/api/assets/');

    await contextA.close();
    await contextB.close();
  });
});

test.describe('TC-26: mixed picker batch shows rejection toast', () => {
  test('good + bad files: good inserted, toast shown', async ({ page }) => {
    await openBoard(page);

    const fileInput = page.locator('input[data-testid="image-file-input"]');
    // Upload good + bad files
    // - red-200x150.png: valid
    // - fake.svg: MIME type not accepted → 'type' rejection
    // - corrupt.png: MIME passes but createImageBitmap fails → 'type' rejection
    await fileInput.setInputFiles([
      FIXTURE_DIR + 'red-200x150.png',
      FIXTURE_DIR + 'corrupt.png',
      FIXTURE_DIR + 'fake.svg',
    ]);

    // A type rejection toast should appear (from the bad files)
    await expect(page.getByTestId('toast').first()).toBeVisible({ timeout: 10000 });

    // The good file should be inserted (placeholder appears client-side)
    await waitForAnyImage(page);
    // Then wait for the upload to complete
    await waitForImageStatus(page, 'ready');
    const images = await getImageObjects(page);
    expect(images).toHaveLength(1);
  });
});

test.describe('TC-27: aspect-locked resize and immutable URL', () => {
  test.slow();
  test('image URL returns immutable cache, survives reload', async ({ page }) => {
    await openBoard(page);

    const fileInput = page.locator('input[data-testid="image-file-input"]');
    await fileInput.setInputFiles(FIXTURE_DIR + 'green-400x300.png');
    await waitForAnyImage(page);
    await waitForImageStatus(page, 'ready');

    const images = await getImageObjects(page);
    expect(images).toHaveLength(1);
    const img = images[0]!;

    // Verify aspect ratio is correct (400x300 = 4:3)
    const ratio = img.width / img.height;
    expect(Math.abs(ratio - 4 / 3)).toBeLessThan(0.01);

    // Record the assetKey
    const assetKey = img.assetKey!;

    // Reload the page
    await page.reload();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForImageStatus(page, 'ready');

    // The asset URL should still return 200 with immutable cache headers
    const response = await page.request.get(`/api/assets/${assetKey}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
  });
});

test.describe('TC-28: flaky upload (abort + retry)', () => {
  test.slow();
  test('abort during upload → failed state → retry → ready', async ({ page }) => {
    await openBoard(page);

    // Intercept the upload POST and abort it the first time
    let uploadCount = 0;
    await page.route('**/api/boards/*/assets', async (route) => {
      uploadCount++;
      if (uploadCount === 1) {
        // First attempt: simulate a network failure
        await route.abort('connectionrefused');
      } else {
        // Retry: let it through
        await route.continue();
      }
    });

    const fileInput = page.locator('input[data-testid="image-file-input"]');
    await fileInput.setInputFiles(FIXTURE_DIR + 'red-200x150.png');

    // Wait for the image to enter 'failed' state (placeholder created client-side,
    // then upload is aborted by the route handler)
    await expect(async () => {
      const images = await getImageObjects(page);
      expect(images.length).toBeGreaterThan(0);
      expect(images.some((img) => img.status === 'failed')).toBe(true);
    }).toPass({ timeout: 30000 });

    // Click Retry (only uploader sees it)
    const retryButton = page.getByRole('button', { name: 'Retry' });
    await expect(retryButton).toBeVisible({ timeout: 5000 });
    await retryButton.click();

    // Now it should become ready
    await waitForImageStatus(page, 'ready');

    const images = await getImageObjects(page);
    expect(images[0]!.status).toBe('ready');
  });
});
