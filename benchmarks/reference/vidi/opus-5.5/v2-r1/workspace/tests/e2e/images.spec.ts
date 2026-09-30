// Story 12 e2e: images dropped, picked, resized and retried in real browsers against the real
// Worker and local R2 (wrangler dev). TC-25 to TC-28.
import { type Page, expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';
import { getCamera, setCamera, waitForFrame } from './helpers/board';
import { dropFiles, fixture } from './helpers/drop-files';
import { LatencyLog, openParticipants, waitForConnected } from './helpers/participants';

test.describe.configure({ timeout: 60_000 });

async function images(page: Page): Promise<ImageSnap[]> {
  return page.evaluate(() =>
    (window.__vidi6!.getObjects!() as unknown as ImageSnap[]).filter((o) => o.type === 'image'),
  );
}

const imageEl = (page: Page, id: string) => page.locator(`[data-image-id="${id}"]`);

/** True when the image element has a loaded, decoded image. */
function loaded(page: Page, id: string) {
  return page.evaluate((imageId) => {
    const img = document.querySelector<HTMLImageElement>(`[data-image-id="${imageId}"] img`);
    return !!img && img.complete && img.naturalWidth > 0;
  }, id);
}

async function showCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await setCamera(page, cam);
  await expect.poll(() => getCamera(page)).toEqual(cam);
  await waitForFrame(page);
}

const toast = (page: Page) => page.locator('.toast-region[role="status"]');

test.describe('Workflow: Moodboard with a colleague', () => {
  test('TC-25 Leo drops three screenshots; Sam sees Uploading… placeholders, then the images', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium only (design)');
    const session = await openParticipants(browser, testInfo, ['Leo', 'Sam']);
    const [leo, sam] = session.participants;
    try {
      // Leo's uploads are held back a little so the placeholders are observable.
      await leo.page.route('**/api/boards/*/assets', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      for (const p of [leo.page, sam.page]) await showCamera(p, { x: 0, y: 0, zoom: 0.5 });
      const log = new LatencyLog();

      const files = [fixture('screenshot.png'), fixture('image.webp'), fixture('animated.gif')];
      await dropFiles(leo.page, files, { x: 200, y: 150 });
      const droppedAt = Date.now();

      await expect.poll(() => images(leo.page).then((i) => i.length)).toBe(3);
      const placed = (await images(leo.page)).sort((a, b) => a.x - b.x);
      // Top-left of the first at the drop point (camera (0,0) at 50%: page (200,150) → world (400,300)).
      expect(placed[0]).toMatchObject({ x: 400, y: 300, width: 800, height: 500, status: 'uploading' });
      expect(placed[1].x).toBeCloseTo(400 + 800 + IMAGE_LAYOUT_GAP_WORLD);
      expect(placed[2].x).toBeCloseTo(placed[1].x + 640 + IMAGE_LAYOUT_GAP_WORLD);
      expect(placed.map((p) => [p.width, p.height])).toEqual([
        [800, 500],
        [640, 480],
        [120, 80],
      ]);
      await expect(imageEl(leo.page, placed[0].id)).toContainText('%');

      // Sam: "Uploading…" placeholders of the same size and place.
      await log.expectEventually(
        'placeholders on Sam',
        async () =>
          (await sam.page.locator('.image-object', { hasText: 'Uploading…' }).count()) === 3,
        droppedAt,
      );
      const samPlaced = (await images(sam.page)).sort((a, b) => a.x - b.x);
      expect(samPlaced.map((p) => [p.x, p.y, p.width, p.height])).toEqual(
        placed.map((p) => [p.x, p.y, p.width, p.height]),
      );

      const served = sam.page.waitForResponse((r) => r.url().includes('/api/assets/') && r.status() === 200);
      for (const img of placed) {
        await log.expectEventually(`image ${img.id} on Sam`, () => loaded(sam.page, img.id), droppedAt);
        await expect.poll(() => loaded(leo.page, img.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
      }
      const response = await served;
      expect(response.headers()['cache-control']).toContain('immutable');
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      await expect(sam.page.getByRole('img', { name: 'Image' })).toHaveCount(3);
      log.report('TC-25 drop to visible (includes the 1.5 s held upload)');
      expect(leo.problems.concat(sam.problems).filter((p) => !p.includes('Failed to load resource'))).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Mixed picker batch', () => {
  test('TC-26 I opens the picker; a PNG, a renamed PDF and an 11 MB JPEG add one image with both messages', async ({
    browser,
  }, testInfo) => {
    const session = await openParticipants(browser, testInfo, ['Leo']);
    const [{ page }] = session.participants;
    try {
      await showCamera(page, { x: -640, y: -400, zoom: 1 });
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('i');
      const fc = await chooser;
      expect(fc.isMultiple()).toBe(true);
      await expect(page.getByRole('button', { name: 'Image (I)' })).toHaveAttribute('aria-pressed', 'true');
      const huge = Buffer.alloc(11 * 1024 * 1024);
      fixture('photo.jpg').buffer.copy(huge);
      expect(huge.length).toBeGreaterThan(IMAGE_MAX_BYTES);
      await fc.setFiles([
        fixture('screenshot.png'),
        { ...fixture('document-renamed.png'), mimeType: 'image/png' },
        { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: huge },
      ]);
      await expect(toast(page)).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
      await expect(toast(page)).toContainText('Images must be 10 MB or smaller.');
      await expect.poll(() => images(page).then((i) => i.length)).toBe(1);
      const [img] = await images(page);
      // Centred in view: camera (-640,-400) at 100% in a 1280×800 viewport → world (0,0).
      expect(img.x + img.width / 2).toBeCloseTo(0);
      expect(img.y + img.height / 2).toBeCloseTo(0);
      await expect.poll(() => loaded(page, img.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
      await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => images(page).then((i) => i.length)).toBe(1);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Resize and revisit', () => {
  test('TC-27 a corner resize keeps the proportions and stops at the minimum; the image is there after reload', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium only (design)');
    const session = await openParticipants(browser, testInfo, ['Leo']);
    const [{ page }] = session.participants;
    try {
      await showCamera(page, { x: 0, y: 0, zoom: 1 });
      await dropFiles(page, [fixture('image.webp')], { x: 100, y: 50 });
      await expect.poll(() => images(page).then((i) => i[0]?.status)).toBe('ready');
      const [img] = await images(page);
      expect([img.x, img.y, img.width, img.height]).toEqual([100, 50, 640, 480]);
      await expect.poll(() => loaded(page, img.id)).toBe(true);

      // Select, then drag the bottom-right corner mostly to the right.
      await page.mouse.click(500, 300);
      const handle = page.getByRole('button', { name: 'Resize bottom-right' });
      const box = (await handle.boundingBox())!;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 100, start.y + 20, { steps: 5 });
      await page.mouse.move(start.x + 200, start.y + 30, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await images(page))[0].width).toBeGreaterThan(640);
      let [now] = await images(page);
      expect(now.width / now.height).toBeGreaterThan((640 / 480) * 0.99);
      expect(now.width / now.height).toBeLessThan((640 / 480) * 1.01);

      // Onto the opposite corner: stops at the minimum size, still in proportion.
      const box2 = (await handle.boundingBox())!;
      const s2 = { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 };
      await page.mouse.move(s2.x, s2.y);
      await page.mouse.down();
      await page.mouse.move(s2.x - 400, s2.y - 300, { steps: 5 });
      await page.mouse.move(100, 50, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await images(page))[0].height).toBeLessThan(100);
      [now] = await images(page);
      expect(Math.min(now.width, now.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1e-6);
      expect(Math.min(now.width, now.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 3);
      expect(now.width / now.height).toBeCloseTo(640 / 480, 2);

      // Grow it back a bit, then revisit in a new context.
      const box3 = (await handle.boundingBox())!;
      const s3 = { x: box3.x + box3.width / 2, y: box3.y + box3.height / 2 };
      await page.mouse.move(s3.x, s3.y);
      await page.mouse.down();
      await page.mouse.move(s3.x + 150, s3.y + 150, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await images(page))[0].width).toBeGreaterThan(100);
      const [final] = await images(page);

      const later = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport });
      const visitor = await later.newPage();
      await visitor.goto(`/b/${session.boardId}`);
      await waitForConnected(visitor);
      await showCamera(visitor, { x: 0, y: 0, zoom: 1 });
      await expect.poll(() => images(visitor).then((i) => i.map((o) => [o.width, o.height, o.status]))).toEqual([
        [final.width, final.height, 'ready'],
      ]);
      await expect.poll(() => loaded(visitor, final.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
      await later.close();
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Flaky upload', () => {
  test('TC-28 an aborted upload shows Upload failed; Retry with the network back shows the image on both screens', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium only (design)');
    const session = await openParticipants(browser, testInfo, ['Leo', 'Sam']);
    const [leo, sam] = session.participants;
    try {
      await leo.page.route('**/api/boards/*/assets', (route) => route.abort('failed'));
      for (const p of [leo.page, sam.page]) await showCamera(p, { x: 0, y: 0, zoom: 1 });
      await dropFiles(leo.page, [fixture('image.webp')], { x: 200, y: 120 });
      await expect.poll(() => images(leo.page).then((i) => i[0]?.status)).toBe('failed');
      const [img] = await images(leo.page);
      const leoEl = imageEl(leo.page, img.id);
      await expect(leoEl).toContainText('Upload failed');
      await expect(leoEl.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(leoEl.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(imageEl(sam.page, img.id)).toHaveText('Image unavailable', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await leo.page.unroute('**/api/boards/*/assets');
      await leoEl.getByRole('button', { name: 'Retry' }).click();
      for (const p of [leo.page, sam.page]) {
        await expect.poll(() => loaded(p, img.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
      }
      // Still one image: the retry reused the placeholder.
      expect(await images(leo.page)).toHaveLength(1);
    } finally {
      await session.close();
    }
  });
});
