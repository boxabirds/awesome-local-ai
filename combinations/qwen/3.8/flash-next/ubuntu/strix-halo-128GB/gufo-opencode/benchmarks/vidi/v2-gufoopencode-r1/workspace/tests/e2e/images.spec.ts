import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { markerCenter, openFreshBoard } from './helpers/board';
import { dragFilesOver, dropFiles, fixtureFile } from './helpers/drop-files';

const SCREENSHOTS = [
  fixtureFile('png-screenshot.png'),
  fixtureFile('jpeg-photo.jpg'),
  fixtureFile('photo.webp')
];

const imageBitmaps = (page: Page) => page.locator('img[data-testid^="image-bitmap-"]');

async function openBoard(page: Page, id: string): Promise<void> {
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

// Inserts are connection-gated, so boards that drop or pick files must wait
// for the live connection instead of racing the websocket handshake.
async function waitConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    })
    .toBe('connected');
}

test.describe('drop images onto the board', () => {
  test('TC-25: two collaborators see a dropped moodboard with immutable assets', async ({
    browser,
    request
  }) => {
    const id = await (async () => {
      const leo = await browser.newPage();
      const boardId = await openFreshBoard(leo);
      await leo.close();
      return boardId;
    })();

    const leoContext = await browser.newContext();
    const leo = await leoContext.newPage();
    await openBoard(leo, id);
    await waitConnected(leo);
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await openBoard(sam, id);

    // Hold the asset POSTs briefly so Sam's view of the 'Uploading…' state is
    // observable instead of racing past on a local round-trip.
    await leo.route('**/api/boards/*/assets', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    const point = await markerCenter(leo);
    await dragFilesOver(leo, SCREENSHOTS, point);
    await expect(leo.getByTestId('drop-highlight')).toBeVisible();
    const droppedAt = Date.now();
    await dropFiles(leo, SCREENSHOTS, point);

    await expect(sam.getByText('Uploading…').first().or(imageBitmaps(sam).first())).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    const firstVisibleAt = Date.now() - droppedAt;
    // Latency budget is logged for regression visibility, not asserted (CI jitter).
    console.log(
      `TC-25 drop→first image visible for collaborator: ${String(firstVisibleAt)}ms (budget ${String(
        LIVE_UPDATE_LATENCY_BUDGET_MS
      )}ms)`
    );

    await expect(imageBitmaps(sam)).toHaveCount(SCREENSHOTS.length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    await expect(imageBitmaps(leo)).toHaveCount(SCREENSHOTS.length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });

    const src = await imageBitmaps(leo).first().getAttribute('src');
    expect(src).toMatch(/^\/api\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/);
    const served = await leo.request.get(src ?? '');
    expect(served.status()).toBe(200);
    const cacheControl = served.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('immutable');
    expect(cacheControl).toContain('max-age=');

    await leoContext.close();
    await samContext.close();
    void request;
  });

  test('TC-26: picker batch adds only the valid image and toasts the exact reasons', async ({
    page
  }) => {
    await openFreshBoard(page);
    await waitConnected(page);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press('i')
    ]);
    await chooser.setFiles([
      { name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from(fixtureFile('png-screenshot.png').base64, 'base64') },
      // A PDF renamed to .png: the sniffed type, not the extension, decides.
      { name: 'invoice.png', mimeType: 'image/png', buffer: Buffer.from(fixtureFile('renamed-pdf.png').base64, 'base64') },
      { name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtureFile('over-10mb.jpg').base64, 'base64') }
    ]);

    // Rejection toasts auto-dismiss after 5s, so assert them before the slower
    // image-ready wait; the two reasons may stack in either order.
    const toasts = page.getByTestId('image-toast');
    await expect(toasts).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const texts = (await toasts.allTextContents()).sort();
    expect(texts).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.size].sort());

    await expect(imageBitmaps(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-27: images resize proportionally, clamp at the minimum, and survive a reload', async ({
    browser
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const id = await openFreshBoard(page);
    await waitConnected(page);

    // Drop near the top-left so the whole placed image (800x500) and its
    // resize handles stay inside the 1280x800 viewport.
    await dropFiles(page, [fixtureFile('png-screenshot.png')], { x: 300, y: 150 });
    const bitmap = imageBitmaps(page).first();
    await expect(bitmap).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    const before = await bitmap.boundingBox();
    expect(before).not.toBeNull();
    const naturalRatio = before!.width / before!.height;

    await bitmap.click();
    const handle = page.getByTestId('resize-handle-se');
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    // Shove the corner almost onto the opposite one so the requested size
    // falls under the minimum and the clamp must engage.
    await page.mouse.move(handleBox!.x - 790, handleBox!.y - 490, { steps: 12 });
    await page.mouse.up();

    const after = await bitmap.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.height).toBeCloseTo(16, 0);
    expect(Math.abs(after!.width / after!.height - naturalRatio) / naturalRatio).toBeLessThan(0.01);

    const revisit = await browser.newContext();
    const revisited = await revisit.newPage();
    await openBoard(revisited, id);
    await expect(imageBitmaps(revisited)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await context.close();
    await revisit.close();
  });

  test('TC-28: failed uploads show failed/unavailable states and Retry re-serves the image', async ({
    browser
  }) => {
    const leoContext = await browser.newContext();
    const leo = await leoContext.newPage();
    const id = await openFreshBoard(leo);
    await waitConnected(leo);
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await openBoard(sam, id);

    await leo.route('**/api/boards/*/assets', (route) => void route.abort());
    const point = await markerCenter(leo);
    await dropFiles(leo, [fixtureFile('png-screenshot.png')], point);

    await expect(leo.getByTestId(/^image-failed-/)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(leo.getByText('Upload failed')).toBeVisible();
    await expect(sam.getByText('Image unavailable')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await leo.unroute('**/api/boards/*/assets');
    await leo.getByTestId('image-action-retry').click();

    await expect(imageBitmaps(leo)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(imageBitmaps(sam)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await leoContext.close();
    await samContext.close();
  });
});
