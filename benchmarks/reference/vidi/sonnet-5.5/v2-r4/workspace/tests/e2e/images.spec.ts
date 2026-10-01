import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { openNewBoard, setCamera } from './helpers/board';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';
import { dropFiles, fixturePath } from './helpers/drop-files';

const loadedImages = (page: Page) =>
  page.locator('img[alt="Image"]').evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0).length);
const imageBoxes = (page: Page) => page.getByRole('group', { name: 'Image' });

test.describe('images', () => {
  test('TC-25 moodboard: three dropped screenshots show as placeholders, then images, for a colleague', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [leo, sam] = people;
    await setCamera(leo.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);
    // Keep the uploads in flight long enough to observe the placeholders.
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const cache: string[] = [];
    sam.page.on('response', (r) => {
      if (r.url().includes('/api/assets/')) cache.push(r.headers()['cache-control'] ?? '');
    });
    const start = Date.now();
    await dropFiles(leo.page, ['screenshot.png', 'photo.jpg', 'picture.webp'], 300, 200);
    await expect(imageBoxes(leo.page)).toHaveCount(3);
    await expect(leo.page.getByTestId('image-progress')).toHaveCount(3);
    await expect(sam.page.getByText('Uploading…')).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    console.log(`[latency] drop to placeholders on colleague: ${Date.now() - start} ms`);
    await expectEventually('images visible for colleague', () => loadedImages(sam.page), 3);
    await expect.poll(() => loadedImages(leo.page)).toBe(3);
    expect(cache.length).toBeGreaterThan(0);
    expect(cache.every((c) => c.includes('immutable'))).toBe(true);
    // The first image starts at the drop point.
    const first = (await imageBoxes(leo.page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left))).sort((a, b) => a - b)[0];
    expect(Math.round(first)).toBe(300);
    expect(leo.consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-26 mixed picker batch: only the valid image is added and refusals are explained', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('i');
    const fc = await chooser;
    expect(fc.isMultiple()).toBe(true);
    const huge = Buffer.alloc(IMAGE_MAX_BYTES + 1024 * 1024);
    huge.set([0xff, 0xd8, 0xff]);
    await fc.setFiles([
      { name: 'small.png', mimeType: 'image/png', buffer: readFileSync(fixturePath('small.png')) },
      { name: 'renamed-pdf.png', mimeType: 'image/png', buffer: readFileSync(fixturePath('renamed-pdf.png')) },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: huge },
    ]);
    await expect(imageBoxes(page)).toHaveCount(1);
    await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
    await expect.poll(() => loadedImages(page)).toBe(1);
    // Centred in the visible area (small.png is 400x300).
    const box = (await imageBoxes(page).boundingBox())!;
    expect(Math.round(box.x + box.width / 2)).toBe(640);
    expect(Math.round(box.y + box.height / 2)).toBe(400);
  });

  test('TC-27 resize keeps proportions with a floor, and the image survives a reload', async ({ page, browser }) => {
    const boardId = await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await dropFiles(page, ['small.png'], 500, 300);
    await expect.poll(() => loadedImages(page)).toBe(1);
    await imageBoxes(page).click();
    const before = (await imageBoxes(page).boundingBox())!;
    const handle = (await page.getByRole('button', { name: 'Resize bottom-right', exact: true }).boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 200, hy + 10, { steps: 8 });
    await page.mouse.up();
    const grown = (await imageBoxes(page).boundingBox())!;
    expect(grown.width).toBeGreaterThan(before.width + 100);
    expect(Math.abs(grown.width / grown.height - before.width / before.height) / (before.width / before.height)).toBeLessThan(0.01);

    const h2 = (await page.getByRole('button', { name: 'Resize bottom-right', exact: true }).boundingBox())!;
    const x2 = h2.x + h2.width / 2;
    const y2 = h2.y + h2.height / 2;
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    await page.mouse.move(grown.x - 300, grown.y - 300, { steps: 8 });
    await page.mouse.up();
    const small = (await imageBoxes(page).boundingBox())!;
    expect(Math.min(small.width, small.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(Math.min(small.width, small.height)).toBeLessThanOrEqual(IMAGE_MIN_SIZE_WORLD + 1);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await context.newPage();
    await page2.goto(`/b/${boardId}`);
    await page2.getByTestId('board-viewport').waitFor();
    await expect(imageBoxes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect.poll(() => loadedImages(page2), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await context.close();
  });

  test('TC-28 flaky upload: failure shows Retry, retry succeeds', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await page.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFiles(page, ['small.png'], 400, 300);
    await expect(page.getByText('Upload failed')).toBeVisible();
    await page.unroute('**/api/boards/*/assets');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => loadedImages(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await expect(page.getByText('Upload failed')).toHaveCount(0);
  });

  test('a dropped file shows the dashed highlight while dragging over the board', async ({ page }) => {
    await openNewBoard(page);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
      document.querySelector('[data-testid=board-viewport]')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.getByTestId('drop-highlight')).toBeVisible();
  });
});
