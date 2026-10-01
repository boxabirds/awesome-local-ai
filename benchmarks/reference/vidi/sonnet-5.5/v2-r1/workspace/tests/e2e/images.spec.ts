import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { dropFiles, payload } from './helpers/drop-files';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';

const objects = (page: Page) => page.locator('[data-image-object]');
const loadedImages = (page: Page) =>
  page.locator('[data-image-object] img').evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length);

async function box(page: Page, index = 0) {
  return objects(page).nth(index).evaluate((el) => {
    const e = el as HTMLElement;
    return { left: parseFloat(e.style.left), top: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) };
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test.describe('images', () => {
  test('TC-25 moodboard: three dropped screenshots show as placeholders, then as images, for a colleague', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, 2);
    try {
      await setCamera(leo.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
      const immutable: string[] = [];
      sam.page.on('response', (r) => {
        if (r.url().includes('/api/assets/')) immutable.push(r.headers()['cache-control'] ?? '');
      });
      // Hold the uploads so the placeholders can be observed.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await leo.page.route('**/api/boards/*/assets', async (route) => {
        await gate;
        await route.continue();
      });
      const startedAt = Date.now();
      await dropFiles(leo.page, ['screenshot.png', 'photo.jpg', 'animated.gif'], { x: 300, y: 200 });
      await expect(objects(leo.page)).toHaveCount(3);
      const b0 = (await Promise.all([0, 1, 2].map((i) => box(leo.page, i)))).sort((p, q) => p.left - q.left)[0];
      expect(b0.left).toBe(300);
      expect(b0.top).toBe(200);
      await expect(leo.page.getByText('0%', { exact: true })).toHaveCount(3);
      await expectEventually('placeholders for Sam', async () => (await sam.page.getByText('Uploading…').count()) === 3, startedAt);
      release();
      await expectEventually('images for Sam', async () => (await loadedImages(sam.page)) === 3);
      await expect.poll(() => loadedImages(leo.page)).toBe(3);
      expect(immutable.length).toBeGreaterThan(0);
      expect(immutable.every((c) => c.includes('immutable'))).toBe(true);
      // 1440x900 is scaled to 800 wide; the gap between neighbours is 24.
      const sorted = [await box(leo.page, 0), await box(leo.page, 1), await box(leo.page, 2)].sort((p, q) => p.left - q.left);
      expect(sorted[1].left - (sorted[0].left + sorted[0].width)).toBeCloseTo(24, 0);
      expect(leo.errors).toEqual([]);
    } finally {
      await closeAll([leo, sam]);
    }
  });

  test('TC-26 mixed picker batch: the valid image is added and refusals are explained', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    try {
      const page = leo.page;
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('i');
      await (await chooser).setFiles([
        payload('small.png'),
        payload('fake.png'),
        { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(IMAGE_MAX_BYTES + 1000) },
      ]);
      await expect(objects(page)).toHaveCount(1);
      await expect(page.getByTestId('toast')).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
      await expect(page.getByTestId('toast')).toContainText('Images must be 10 MB or smaller.');
      await expect.poll(() => loadedImages(page)).toBe(1);
      // Centred in the visible area.
      const b = await box(page);
      const cam = await page.evaluate(() => window.__vidi6!.getCamera());
      const centre = { x: cam.x + 1280 / 2 / cam.zoom, y: cam.y + 800 / 2 / cam.zoom };
      expect(Math.abs(b.left + b.width / 2 - centre.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.top + b.height / 2 - centre.y)).toBeLessThanOrEqual(1);
    } finally {
      await closeAll([leo]);
    }
  });

  test('TC-27 resize keeps proportions down to the floor, and the image survives a reload', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    try {
      const page = leo.page;
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await dropFiles(page, ['photo.webp'], { x: 300, y: 200 });
      await expect.poll(() => loadedImages(page)).toBe(1);
      const before = await box(page);
      expect(before).toMatchObject({ left: 300, top: 200, width: 200, height: 150 });
      await page.mouse.click(400, 270);
      const handle = page.getByRole('button', { name: 'Resize bottom-right' });
      const hb = (await handle.boundingBox())!;
      const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
      await drag(page, start, { x: start.x + 200, y: start.y + 20 });
      const grown = await box(page);
      expect(Math.abs(grown.width / grown.height - 200 / 150) / (200 / 150)).toBeLessThan(0.01);
      expect(grown.width).toBeGreaterThan(300);

      const hb2 = (await handle.boundingBox())!;
      const s2 = { x: hb2.x + hb2.width / 2, y: hb2.y + hb2.height / 2 };
      await drag(page, s2, { x: 300, y: 200 });
      const small = await box(page);
      expect(Math.min(small.width, small.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 0);
      expect(Math.abs(small.width / small.height - 200 / 150) / (200 / 150)).toBeLessThan(0.01);

      const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: 'http://localhost:8787' });
      const page2 = await fresh.newPage();
      await page2.goto(page.url());
      await expect.poll(() => loadedImages(page2)).toBe(1);
      await fresh.close();
    } finally {
      await closeAll([leo]);
    }
  });

  test('TC-28 a failed upload shows Retry; retrying succeeds on both screens', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, 2);
    try {
      await setCamera(leo.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
      await leo.page.route('**/api/boards/*/assets', (route) => route.abort());
      await dropFiles(leo.page, ['small.png'], { x: 300, y: 200 });
      await expect(leo.page.getByText('Upload failed')).toBeVisible();
      await expect(sam.page.getByText('Image unavailable')).toBeVisible();
      await leo.page.unroute('**/api/boards/*/assets');
      await leo.page.getByRole('button', { name: 'Retry' }).click({ timeout: 3000 });
      await expect(leo.page.getByText('Upload failed')).toHaveCount(0, { timeout: 3000 });
      await expect.poll(() => loadedImages(leo.page)).toBe(1);
      await expect.poll(() => loadedImages(sam.page)).toBe(1);
    } finally {
      await closeAll([leo, sam]);
    }
  });

  test('a dashed highlight shows while files are dragged over the board', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    try {
      await dropFiles(leo.page, ['small.png'], { x: 300, y: 200 }, { dropEvent: false });
      await expect(leo.page.getByTestId('drop-highlight')).toBeVisible();
    } finally {
      await closeAll([leo]);
    }
  });
});
