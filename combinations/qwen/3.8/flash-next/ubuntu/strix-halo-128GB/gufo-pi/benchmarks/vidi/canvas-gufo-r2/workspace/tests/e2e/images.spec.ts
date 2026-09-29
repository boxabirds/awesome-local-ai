/**
 * E2E image workflows (story 12, TC-25 to TC-28) against `wrangler dev`:
 * real uploads into local R2, immutable serving, live placeholders for a
 * colleague, aspect-locked resize, persistence and a flaky upload that is
 * retried.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createBoard,
  dragCorner,
  dropFiles,
  fixtureBuffer,
  fixturePath,
  imageBoxes,
  loadedImages,
  openBoard,
  type ImageBox,
} from './helpers/drop-files';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

const images = (page: Page): ReturnType<Page['locator']> => page.locator('[data-image-id]');

test.describe('TC-25: a moodboard with a colleague', () => {
  test('three dropped screenshots appear for both people, served immutably', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const boardId = await createBoard(request);

    const leoContext = await browser.newContext();
    const samContext = await browser.newContext();
    const leo = await leoContext.newPage();
    const sam = await samContext.newPage();

    await openBoard(leo, boardId);
    // Hold the uploads briefly so Sam's "Uploading…" state is observable rather
    // than a race against a local disk write.
    await leo.route('**/api/boards/*/assets', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await openBoard(sam, boardId);

    const assetResponse = leo.waitForResponse((res) => res.url().includes('/api/assets/'), {
      timeout: 30_000,
    });

    // The board highlights while files are over it, and drops a row of three.
    await dropFiles(
      leo,
      [fixturePath('screenshot.png'), fixturePath('drawing.png'), fixturePath('tiny.png')],
      { x: 340, y: 300 },
    );

    await expect(images(leo)).toHaveCount(3);
    await expect(leo.getByTestId('image-uploading')).toHaveCount(3);
    await expect(leo.getByTestId('drop-highlight')).toHaveCount(0);

    // Sam sees the same three placeholders — as somebody else's uploads, so no
    // progress bar.
    await expect(images(sam)).toHaveCount(3);
    await expect(sam.getByTestId('image-uploading-other')).toHaveCount(3);
    await expect(sam.getByTestId('image-uploading')).toHaveCount(0);

    await expect
      .poll(() => loadedImages(leo), { timeout: 30_000 })
      .toBe(3);
    // Live: the finished images reach Sam inside the collaboration budget.
    await expect
      .poll(() => loadedImages(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + 20_000 })
      .toBe(3);

    const boxes = await imageBoxes(leo);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[2].x).toBeGreaterThan(boxes[1].x);
    expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0);
    // The screenshot keeps its proportions at the placement cap (800 world units).
    expect(boxes[0].width / boxes[0].height).toBeCloseTo(1440 / 900, 2);

    const res = await assetResponse;
    expect(res.status()).toBe(200);
    const cacheControl = res.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('immutable');
    expect(cacheControl).toContain(`max-age=${ASSET_CACHE_MAX_AGE_SECONDS}`);
    expect(res.headers()['content-type']).toContain('image/png');

    await leoContext.close();
    await samContext.close();
  });
});

test.describe('TC-26: a mixed batch from the picker', () => {
  test('only the supported, in-limit file is added; the rest are explained', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const boardId = await createBoard(request);
    await openBoard(page, boardId);

    // `I` opens the picker (Playwright intercepts the native dialog).
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('i');
    const chooser = await chooserPromise;
    // The picker itself only offers the supported image types.
    const fileInput = page.locator('[data-testid="image-file-input"]');
    await expect(fileInput).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/gif,image/webp',
    );
    await expect(fileInput).toHaveAttribute('multiple', '');

    // A JPEG that is one byte over the limit: the bytes after the image are
    // never read, the client refuses it by size alone.
    const photo = fixtureBuffer('photo.jpg');
    const oversized = Buffer.concat([
      photo,
      Buffer.alloc(IMAGE_MAX_BYTES + 1 - photo.length, 0x20),
    ]);

    await chooser.setFiles([
      { name: 'drawing.png', mimeType: 'image/png', buffer: fixtureBuffer('drawing.png') },
      { name: 'deck.pdf', mimeType: 'application/pdf', buffer: fixtureBuffer('renamed-pdf.png') },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: oversized },
    ]);

    await expect(page.getByText(REJECTION_MESSAGES.type)).toBeVisible();
    await expect(page.getByText(REJECTION_MESSAGES.size)).toBeVisible();

    await expect(images(page)).toHaveCount(1);
    await expect
      .poll(() => loadedImages(page), { timeout: 30_000 })
      .toBe(1);

    // Still on Select: the Image tool is only a picker.
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('TC-27: resize an image and come back later', () => {
  test('proportions are locked, the floor holds, a revisit shows the image', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const boardId = await createBoard(request);

    const context = await browser.newContext();
    const page = await context.newPage();
    await openBoard(page, boardId);

    await dropFiles(page, [fixturePath('drawing.png')], { x: 420, y: 260 });
    await expect
      .poll(() => loadedImages(page), { timeout: 30_000 })
      .toBe(1);

    const before = (await imageBoxes(page))[0] as ImageBox;
    const ratio = before.width / before.height;

    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
    await dragCorner(page, 'se', 140, 105);

    const grown = (await imageBoxes(page))[0] as ImageBox;
    expect(grown.width).toBeGreaterThan(before.width);
    expect(Math.abs(grown.width / grown.height - ratio)).toBeLessThan(ratio * 0.01);

    // Dragging far past the floor stops there instead of collapsing the image.
    const grownBox = await page.locator('[data-image-id]').boundingBox();
    if (!grownBox) throw new Error('image vanished between assertions');
    await dragCorner(page, 'nw', -(grownBox.width - 4), -(grownBox.height - 4));

    const shrunk = (await imageBoxes(page))[0] as ImageBox;
    expect(Math.min(shrunk.width, shrunk.height)).toBeLessThanOrEqual(IMAGE_MIN_SIZE_WORLD + 0.5);
    expect(shrunk.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(shrunk.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(Math.abs(shrunk.width / shrunk.height - ratio)).toBeLessThan(ratio * 0.01);

    // A brand-new visitor (new context, nothing cached) finds the image, where
    // they left it.
    const later = await browser.newContext();
    const revisited = await later.newPage();
    await openBoard(revisited, boardId);
    await expect
      .poll(() => loadedImages(revisited), { timeout: 30_000 })
      .toBe(1);
    const found = (await imageBoxes(revisited))[0] as ImageBox;
    expect(Math.abs(found.width - shrunk.width)).toBeLessThan(2);
    expect(Math.abs(found.height - shrunk.height)).toBeLessThan(2);
    expect(found.status).toBe('ready');

    await context.close();
    await later.close();
  });
});

test.describe('TC-28: an upload that fails and is retried', () => {
  test('failure is explained, Retry uploads the same file, both see the image', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const boardId = await createBoard(request);

    const leoContext = await browser.newContext();
    const samContext = await browser.newContext();
    const leo = await leoContext.newPage();
    const sam = await samContext.newPage();
    await openBoard(leo, boardId);
    await openBoard(sam, boardId);

    // The network gives up on the way to the asset route.
    await leo.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFiles(leo, [fixturePath('tiny.png')], { x: 360, y: 320 });

    await expect(leo.getByTestId('image-failed')).toBeVisible();
    await expect(leo.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(leo.getByRole('button', { name: 'Remove' })).toBeVisible();
    // Sam is only told the image is not available.
    await expect(sam.getByTestId('image-unavailable')).toBeVisible();
    await expect(sam.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    await leo.unroute('**/api/boards/*/assets');
    await leo.getByRole('button', { name: 'Retry' }).click();

    await expect
      .poll(() => loadedImages(leo), { timeout: 30_000 })
      .toBe(1);
    await expect
      .poll(() => loadedImages(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + 20_000 })
      .toBe(1);
    expect((await imageBoxes(leo))[0]?.status).toBe('ready');

    await leoContext.close();
    await samContext.close();
  });
});
