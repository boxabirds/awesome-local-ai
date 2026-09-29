/**
 * Story 12 e2e — image workflows (TC-25 to TC-28): real uploads to local R2
 * via wrangler dev, live sync to a colleague, validation toasts,
 * aspect-locked resize, persistence after reload, and flaky-upload retry.
 *
 * Viewport: Desktop Chrome 1280x720; the default camera is (0,0,1), so
 * screen coordinates equal world coordinates. TC-26 runs in chromium,
 * firefox and webkit (per tasks.md); the others are chromium-only.
 */
import { test, expect } from '@playwright/test';
import { createBoardIdForPage, setCamera } from './helpers/board';
import { openParticipants, BUDGET } from './helpers/participants';
import { dropFilesAt, fixtures, type E2eFile } from './helpers/drop-files';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from 'src/shared/config';

interface DocImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

async function getImages(page: import('@playwright/test').Page): Promise<DocImage[]> {
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    return [...objects.keys()]
      .map((key: string) => {
        const o: any = objects.get(key);
        return {
          id: key,
          x: o.get('x'),
          y: o.get('y'),
          width: o.get('width'),
          height: o.get('height'),
          status: o.get('status') ?? '',
          assetKey: o.get('assetKey') ?? null,
        };
      })
      .filter((i: DocImage) => i.status !== '' && i.id);
  });
}

const imagesOf = (images: DocImage[]): DocImage[] => images;

/** Opens a single context on a fresh board, fully connected. */
async function openBoard(page: import('@playwright/test').Page): Promise<string> {
  const id = await createBoardIdForPage(page);
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 15000 });
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    null,
    { timeout: 15000 },
  );
  return id;
}

const readyCount = (page: import('@playwright/test').Page) =>
  getImages(page).then((imgs) => imgs.filter((i) => i.status === 'ready').length);

test.describe('image workflows (e2e)', () => {
  test('TC-25: moodboard with a colleague (chromium)', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'chromium-only');
    const [leo, sam] = await openParticipants(browser, 2);

    // Slow Leo's uploads so the colleague's "Uploading…" state is observable
    // within the live-update budget (the placeholder syncs instantly; the
    // completion is what lags).
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    const files: E2eFile[] = [
      fixtures.png('mood-a.png', 1440, 900, [226, 119, 60]),
      fixtures.png('mood-b.png', 1440, 900, [26, 115, 232]),
      fixtures.png('mood-c.png', 1440, 900, [52, 168, 83]),
    ];
    // Drop at world (100,100): the default camera puts world (0,0) at
    // screen (640,360), so the screen point is (740,460).
    
    await dropFilesAt(leo.page, files, 740, 460);

    // Sam: the placeholders sync as "Uploading…" while Leo's (delayed)
    // uploads are in flight.
    await expect(sam.page.getByText('Uploading…').first(), { timeout: 3000 }).toBeVisible();

    // Leo: three placeholders → all three ready (upload + sync budget).
    await expect.poll(() => readyCount(leo.page), { timeout: BUDGET + 10_000 }).toBe(3);
    const imgs = (await getImages(leo.page)).sort((a, b) => a.x - b.x);
    expect(imgs).toHaveLength(3);
    expect(imgs[0].x).toBe(100);
    expect(imgs[0].y).toBe(100);
    expect(imgs[0].width).toBe(800);
    expect(imgs[0].height).toBe(500);
    expect(imgs[1].x).toBe(100 + 800 + 24);
    expect(imgs[2].x).toBe(100 + 2 * (800 + 24));

    // Sam: all three images ready (budget + load).
    await expect.poll(() => readyCount(sam.page), { timeout: BUDGET + 10_000 }).toBe(3);
    await expect(sam.page.getByTestId('image-ready'), { timeout: 5000 }).toHaveCount(3);

    // GET responses carry immutable cache headers.
    const resp = await leo.page.request.get(`/api/assets/${imgs[0].assetKey}`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['cache-control']).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
  });

  test('TC-26: mixed picker batch (chromium + firefox + webkit)', async ({ page }) => {
    await openBoard(page);

    // I opens the picker (a hidden input appears and is clicked).
    await page.keyboard.press('i');
    const input = page.locator('input[data-testid="image-file-input"]');
    await input.waitFor({ state: 'attached', timeout: 5000 });

    const valid = fixtures.png('pick-valid.png', 400, 300, [10, 200, 30]);
    const disguised = fixtures.pdf('disguised.png'); // PDF content, .png name
    const tooBig = fixtures.jpegOfSize('huge.jpg', IMAGE_MAX_BYTES + 1);
    await input.setInputFiles([valid.path, disguised.path, tooBig.path]);

    // Exactly one image is added (the valid PNG).
    await expect.poll(() => readyCount(page), { timeout: BUDGET + 10_000 }).toBe(1);
    const [img] = await getImages(page);
    expect(img.width).toBe(400);
    expect(img.height).toBe(300);

    // Both toasts, exact wording (type + size).
    await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
  });

  test('TC-27: resize keeps aspect, min size floor, persists after reload (chromium)', async ({ browser, browserName, page }) => {
    test.skip(browserName !== 'chromium', 'chromium-only');
    const boardId = await openBoard(page);

    const imgFile = fixtures.png('resize-me.png', 1440, 900, [200, 30, 60]);
    await dropFilesAt(page, [imgFile], 740, 460);
    await expect.poll(() => readyCount(page), { timeout: BUDGET + 10_000 }).toBe(1);
    const [img] = await getImages(page);
    expect(img.width).toBe(800);
    expect(img.height).toBe(500);

    // Zoom out so the whole 800x500 image (and its SE handle) fits the view:
    // camera (0,0,0.5) puts world (100,100)-(900,600) at screen (50,50)-(450,300).
    await setCamera(page, 0, 0, 0.5);

    // Select the image (click its centre) → SE resize handle appears.
    const box = await page.locator(`[data-image-id="${img.id}"]`).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.getByTestId('selection-overlay')).toBeVisible();
    const handle = page.locator('[data-testid="resize-handle"][data-handle="se"]');
    await expect(handle).toBeVisible();

    // Drag the SE corner +100 px: the image scales uniformly (aspect 800:500).
    const hb = await handle.boundingBox();
    expect(hb).not.toBeNull();
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb!.x + hb!.width / 2 + 100, hb!.y + hb!.height / 2 + 100, { steps: 8 });
    await page.mouse.up();

    const resized = (await getImages(page))[0];
    const ratio = resized.width / resized.height;
    expect(Math.abs(ratio - 1.6) / 1.6).toBeLessThan(0.01);

    // Drag far past the minimum: the box stops at the IMAGE_MIN_SIZE_WORLD
    // (16) floor on both sides (the generic clampScale behaviour).
    const hb2 = await handle.boundingBox();
    expect(hb2).not.toBeNull();
    await page.mouse.move(hb2!.x + hb2!.width / 2, hb2!.y + hb2!.height / 2);
    await page.mouse.down();
    // Drag up-left beyond the object's top-left corner → clamps at the floor.
    await page.mouse.move(hb2!.x + hb2!.width / 2 - 1500, hb2!.y + hb2!.height / 2 - 1500, { steps: 8 });
    await page.mouse.up();

    const floored = (await getImages(page))[0];
    expect(floored.width).toBeGreaterThanOrEqual(15.9);
    expect(floored.width).toBeLessThanOrEqual(16.1);
    expect(floored.height).toBeGreaterThanOrEqual(15.9);
    expect(floored.height).toBeLessThanOrEqual(16.1);

    // Reload in a NEW context: the image is still there and ready.
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await fresh.goto(`/b/${boardId}`);
    await fresh.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 15000 });
    await expect.poll(() => readyCount(fresh), { timeout: BUDGET + 10_000 }).toBe(1);
    const persisted = (await getImages(fresh))[0];
    expect(persisted.id).toBe(img.id);
    expect(persisted.assetKey).not.toBeNull();
    expect(persisted.width).toBe(floored.width);
    await expect(fresh.getByTestId('image-ready')).toBeVisible();
    await context.close();
  });

  test('TC-28: flaky upload → failed + retry restores it on both screens (chromium)', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'chromium-only');
    const [leo, sam] = await openParticipants(browser, 2);

    // Kill the upload network path on Leo's tab.
    await leo.page.route('**/api/boards/*/assets', (route) => route.abort());
    const imgFile = fixtures.png('flaky.png', 400, 300, [200, 30, 60]);
    await dropFilesAt(leo.page, [imgFile], 740, 460);

    // Leo: failed with Retry; Sam: "Image unavailable".
    await expect(leo.page.getByText('Upload failed'), { timeout: BUDGET + 5000 }).toBeVisible();
    await expect(leo.page.getByTestId('image-retry')).toBeVisible();
    await expect(sam.page.getByText('Image unavailable'), { timeout: BUDGET + 5000 }).toBeVisible();

    // Restore the network and retry.
    await leo.page.unroute('**/api/boards/*/assets');
    await leo.page.getByTestId('image-retry').click();

    // Ready on both screens (upload + sync budget).
    await expect.poll(() => readyCount(leo.page), { timeout: BUDGET + 10_000 }).toBe(1);
    await expect.poll(() => readyCount(sam.page), { timeout: BUDGET + 10_000 }).toBe(1);
    await expect(sam.page.getByTestId('image-ready'), { timeout: 5000 }).toBeVisible();
  });
});
