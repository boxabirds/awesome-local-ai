import { type Page, type Route, expect, test } from '@playwright/test';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { dropFiles, fixtureImage } from './helpers/drop-files';
import { nextFrames, openBoard, setCamera } from './helpers/board';
import { LatencyLog, closeParticipants, expectEventually, openParticipants } from './helpers/participants';

// Camera at world (0, 0), 100%: page pixels = world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };
const TYPE_MESSAGE = 'Only PNG, JPEG, GIF and WebP images can be added.';
const SIZE_MESSAGE = 'Images must be 10 MB or smaller.';
const UPLOAD_ROUTE = '**/api/boards/*/assets';

async function images(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getObjects?.() ?? [])].filter((o) => o.type === 'image'));
}

function imageLocator(page: Page, id: string) {
  return page.locator(`[data-image-object][data-id="${id}"]`);
}

/** Ids of images whose <img> has loaded and decoded (really visible). */
async function loadedImageIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-image-object]')]
      .filter((el) => {
        const img = el.querySelector('img');
        return img !== null && img.complete && img.naturalWidth > 0;
      })
      .map((el) => el.dataset.id!)
      .sort(),
  );
}

async function pickFiles(page: Page, files: Parameters<import('@playwright/test').FileChooser['setFiles']>[0]) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('i');
  await (await chooser).setFiles(files);
}

test.describe('Moodboard with a colleague', () => {
  test('TC-25 dropped screenshots show as "Uploading…" for Sam, then as images for both', async ({ browser }, testInfo) => {
    const [leo, sam] = await openParticipants(browser, 2);
    const log = new LatencyLog();
    try {
      for (const p of [leo!, sam!]) await setCamera(p.page, CAMERA);
      // Hold Leo's uploads until Sam has seen the placeholders.
      const held: Route[] = [];
      await leo!.page.route(UPLOAD_ROUTE, (route) => {
        held.push(route);
      });
      const cacheHeaders: string[] = [];
      sam!.page.on('response', (r) => {
        if (r.url().includes('/api/assets/')) cacheHeaders.push(r.headers()['cache-control'] ?? '');
      });
      const files = [fixtureImage('screenshot.png'), fixtureImage('image.webp'), fixtureImage('animated.gif')];
      await dropFiles(leo!.page, files, { x: 100, y: 120 }, async () => {
        await expect(leo!.page.getByTestId('drop-highlight')).toBeVisible();
      });
      const droppedAt = Date.now();
      await expect(leo!.page.getByTestId('drop-highlight')).toHaveCount(0);

      // Leo: three placeholders side by side from the drop point, each at its final size, with progress.
      await expect.poll(async () => (await images(leo!.page)).length).toBe(3);
      const placed = (await images(leo!.page)).sort((a, b) => a.x - b.x);
      expect(placed.map((i) => [i.width, i.height])).toEqual([
        [800, 500],
        [640, 480],
        [120, 80],
      ]);
      expect(placed.map((i) => i.y)).toEqual([120, 120, 120]);
      expect(placed[0]!.x).toBe(100);
      await expect(leo!.page.getByRole('progressbar')).toHaveCount(3);

      // Sam: "Uploading…" placeholders of the same size and position.
      await expectEventually(log, 'placeholders', [sam!], async (page) => (await images(page)).length, 3, droppedAt);
      await expect(sam!.page.getByText('Uploading…')).toHaveCount(3);
      const samPlaced = (await images(sam!.page)).sort((a, b) => a.x - b.x);
      expect(samPlaced.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
        placed.map(({ x, y, width, height }) => ({ x, y, width, height })),
      );

      await expect.poll(() => held.length).toBe(3);
      const releasedAt = Date.now();
      for (const route of held) await route.continue();
      const ids = placed.map((i) => i.id).sort();
      await expectEventually(log, 'images visible', [leo!, sam!], loadedImageIds, ids, releasedAt);
      expect(cacheHeaders.length).toBeGreaterThan(0);
      for (const h of cacheHeaders) expect(h).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
      await expect(sam!.page.getByRole('img', { name: 'Image' })).toHaveCount(3);
      console.log(`[latency] budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms plus download time (reported, not asserted)`);
      await log.report(testInfo);
      expect(leo!.problems).toEqual([]);
      expect(sam!.problems).toEqual([]);
    } finally {
      await closeParticipants([leo!, sam!]);
    }
  });
});

test.describe('Mixed picker batch', () => {
  test('TC-26 press I and pick a PNG, a renamed PDF and an 11 MB JPEG: one image, type and size messages', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    const eleven = Buffer.alloc(11 * 1024 * 1024);
    fixtureImage('photo.jpg').buffer.copy(eleven);
    expect(eleven.length).toBeGreaterThan(IMAGE_MAX_BYTES);
    await pickFiles(page, [
      fixtureImage('small.png'),
      fixtureImage('document-renamed.png'),
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: eleven },
    ]);
    const toast = page.getByTestId('toast');
    await expect(toast).toContainText(TYPE_MESSAGE);
    await expect(toast).toContainText(SIZE_MESSAGE);
    await expect(toast).toHaveAttribute('role', 'status');
    await expect.poll(async () => (await images(page)).length).toBe(1);
    const [image] = await images(page);
    // Centred in the visible area (1280×800 at this camera).
    expect(image!.x + image!.width / 2).toBeCloseTo(640, 0);
    expect(image!.y + image!.height / 2).toBeCloseTo(400, 0);
    await expect.poll(() => loadedImageIds(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual([image!.id]);
    // The tool is Select again.
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    // Only one object was added.
    expect(await images(page)).toHaveLength(1);
  });
});

test.describe('Resize and revisit', () => {
  test('TC-27 corner resize keeps proportions and stops at the minimum; the image is there after a reload', async ({ page, browser }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    await pickFiles(page, [fixtureImage('screenshot.png')]);
    await expect.poll(async () => (await images(page)).length).toBe(1);
    const [start] = await images(page);
    expect([start!.width, start!.height]).toEqual([800, 500]);
    await expect.poll(() => loadedImageIds(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual([start!.id]);

    const el = imageLocator(page, start!.id);
    const box = (await el.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByRole('button', { name: 'Resize bottom-right' })).toBeVisible();

    // Mostly-horizontal drag: the height follows in proportion.
    const handle = (await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 300, hy - 40, { steps: 10 });
    await page.mouse.up();
    await nextFrames(page);
    const [resized] = await images(page);
    expect(resized!.width).toBeLessThan(start!.width);
    expect(Math.abs(resized!.width / resized!.height - 1.6) / 1.6).toBeLessThan(0.01);

    // Far past the minimum: stops with the shorter side at IMAGE_MIN_SIZE_WORLD, still in proportion.
    const handle2 = (await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox())!;
    await page.mouse.move(handle2.x + handle2.width / 2, handle2.y + handle2.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle2.x - 2000, handle2.y - 2000, { steps: 10 });
    await page.mouse.up();
    await nextFrames(page);
    const [tiny] = await images(page);
    expect(Math.min(tiny!.width, tiny!.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 5);
    expect(Math.abs(tiny!.width / tiny!.height - 1.6) / 1.6).toBeLessThan(0.01);

    // A later visitor (new context) sees the image at its final size.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const visitor = await context.newPage();
      await openBoard(visitor, new URL(page.url()).pathname);
      await setCamera(visitor, CAMERA);
      await expect.poll(async () => (await images(visitor)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      const [seen] = await images(visitor);
      expect(seen).toMatchObject({ id: tiny!.id, width: tiny!.width, height: tiny!.height, status: 'ready' });
      await expect.poll(() => loadedImageIds(visitor), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual([tiny!.id]);
    } finally {
      await context.close();
    }
  });
});

test.describe('Flaky upload', () => {
  test('TC-28 an aborted upload shows "Upload failed"; Retry with the network back shows the image on both screens', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, 2);
    try {
      for (const p of [leo!, sam!]) await setCamera(p.page, CAMERA);
      await leo!.page.route(UPLOAD_ROUTE, (route) => route.abort('failed'));
      await dropFiles(leo!.page, [fixtureImage('small.png')], { x: 200, y: 200 });
      await expect(leo!.page.getByText('Upload failed')).toBeVisible();
      await expect(leo!.page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(leo!.page.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(sam!.page.getByText('Image unavailable')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await leo!.page.unroute(UPLOAD_ROUTE);
      await leo!.page.getByRole('button', { name: 'Retry' }).click();
      const [image] = await images(leo!.page);
      for (const p of [leo!, sam!]) {
        await expect.poll(() => loadedImageIds(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual([image!.id]);
      }
      await expect(leo!.page.getByText('Upload failed')).toHaveCount(0);
      // Undo removes the image in one step (the completion is not its own step).
      await leo!.page.getByTestId('board-viewport').click({ position: { x: 900, y: 700 } });
      await leo!.page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await images(leo!.page)).length).toBe(0);
      await expect.poll(async () => (await images(sam!.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    } finally {
      await closeParticipants([leo!, sam!]);
    }
  });
});
