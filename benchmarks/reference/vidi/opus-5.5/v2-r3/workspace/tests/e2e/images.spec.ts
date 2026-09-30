// Story 12 — drop images onto the board (workflows "Moodboard with a colleague"
// TC-25, "Mixed picker batch" TC-26, "Resize and revisit" TC-27, "Flaky upload" TC-28).
import { expect, test, type Page } from '@playwright/test';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { getCamera, setCamera, viewport } from './helpers/board';
import { dragFilesOver, dropDraggedFiles, dropFiles, fixtureFile } from './helpers/drop-files';
import { closeAll, openParticipant, openParticipants, printLatencyReport, recordLatency } from './helpers/participants';
import { createBoardId } from './helpers/server';

const CAMERA = { x: 0, y: 0, zoom: 1 };
const TYPE_MESSAGE = 'Only PNG, JPEG, GIF and WebP images can be added.';
const SIZE_MESSAGE = 'Images must be 10 MB or smaller.';

interface ImageState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

async function imageStates(page: Page): Promise<ImageState[]> {
  return page.evaluate(() => {
    const out: ImageState[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      if (m.get('type') !== 'image') return;
      out.push({
        id,
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: m.get('width') as number,
        height: m.get('height') as number,
        status: m.get('status') as string,
        assetKey: (m.get('assetKey') as string | null) ?? null,
      });
    });
    return out.sort((a, b) => a.x - b.x);
  });
}

function imageEls(page: Page) {
  return page.locator('[data-image-id]');
}

/** Rendered images whose bitmap actually loaded. */
async function loadedImages(page: Page): Promise<number> {
  return page.locator('[data-image-id] img').evaluateAll((imgs) =>
    imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length,
  );
}

/** Board point → page coordinates. */
async function toPage(page: Page, p: { x: number; y: number }) {
  const vp = (await viewport(page).boundingBox())!;
  const cam = await getCamera(page);
  return { x: vp.x + (p.x - cam.x) * cam.zoom, y: vp.y + (p.y - cam.y) * cam.zoom };
}

test.describe('images', () => {
  test('TC-25 moodboard with a colleague: Sam sees Uploading… placeholders, then all three images', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, ['Leo', 'Sam']);
    try {
      await setCamera(leo.page, CAMERA);
      await setCamera(sam.page, CAMERA);
      // Slow Leo's uploads down so the placeholders stay long enough to be seen.
      await leo.page.route('**/api/boards/*/assets', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      const cacheHeaders: string[] = [];
      sam.page.on('response', (r) => {
        if (r.url().includes('/api/assets/')) cacheHeaders.push(r.headers()['cache-control'] ?? '');
      });

      const files = ['screenshot.png', 'screenshot-2.png', 'screenshot-3.png'].map(fixtureFile);
      const at = await toPage(leo.page, { x: 300, y: 200 });
      await dragFilesOver(leo.page, files, at);
      await expect(leo.page.getByTestId('drop-highlight')).toBeVisible();
      const droppedAt = await leo.page.evaluate(() => Date.now());
      await dropDraggedFiles(leo.page, at);
      await expect(leo.page.getByTestId('drop-highlight')).toBeHidden();

      // Leo: three placeholders of the final size, side by side from the drop point, with progress.
      await expect(imageEls(leo.page)).toHaveCount(3);
      await expect(leo.page.locator('[data-image-id] [role="progressbar"]')).toHaveCount(3);
      const placed = await imageStates(leo.page);
      // 1440x900 → 800x500; 1200x600 → 800x400; 600x900 → 533.3x800; 24-unit gaps.
      expect(placed.map((i) => [i.x, i.y, Math.round(i.width * 10) / 10, i.height])).toEqual([
        [300, 200, 800, 500],
        [1124, 200, 800, 400],
        [1948, 200, 533.3, 800],
      ]);

      // Sam: "Uploading…" placeholders in the same places.
      await expect(sam.page.getByText('Uploading…')).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const seenAt = await sam.page.evaluate(() => Date.now());
      recordLatency('drop → placeholders on Sam', Math.max(0, seenAt - droppedAt));
      expect((await imageStates(sam.page)).map((i) => [i.x, i.y, i.width, i.height])).toEqual(
        placed.map((i) => [i.x, i.y, i.width, i.height]),
      );

      // Uploads finish: images replace the placeholders on both screens.
      await expect.poll(() => loadedImages(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      recordLatency('drop → images visible on Sam (incl. upload and download)', (await sam.page.evaluate(() => Date.now())) - droppedAt, true);
      await expect.poll(() => loadedImages(leo.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      await expect(sam.page.getByText('Uploading…')).toHaveCount(0);
      expect((await imageStates(sam.page)).every((i) => i.status === 'ready' && i.assetKey)).toBe(true);
      expect(cacheHeaders.length).toBeGreaterThan(0);
      for (const h of cacheHeaders) expect(h).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
      await expect(sam.page.getByRole('group', { name: 'Image' })).toHaveCount(3);
      console.log(`[latency] budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms is reported, not asserted`);
      printLatencyReport('TC-25 images');
      expect(leo.consoleErrors.concat(sam.consoleErrors)).toEqual([]);
    } finally {
      await closeAll([leo, sam]);
    }
  });

  test('TC-26 mixed picker batch: I opens the picker; the PNG is added, the others explained', async ({ page }) => {
    await page.goto(`/b/${await createBoardId()}`);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await setCamera(page, CAMERA);
    const photo = fixtureFile('photo.jpg');
    const huge = {
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.concat([photo.buffer, Buffer.alloc(IMAGE_MAX_BYTES + 1024 * 1024 - photo.buffer.length)]),
    };
    const renamed = { ...fixtureFile('document-renamed.png'), mimeType: 'image/png' };

    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('i');
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    await picker.setFiles([fixtureFile('sample.webp'), renamed, huge]);

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText(TYPE_MESSAGE);
    await expect(toast).toContainText(SIZE_MESSAGE);
    await expect(toast).toHaveAttribute('role', 'status');
    await expect.poll(() => loadedImages(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    const [img] = await imageStates(page);
    expect(await imageStates(page)).toHaveLength(1);
    // Centred in the visible board area.
    const vp = (await viewport(page).boundingBox())!;
    expect(img.x + img.width / 2).toBeCloseTo(vp.width / 2, 5);
    expect(img.y + img.height / 2).toBeCloseTo(vp.height / 2, 5);
    expect([img.width, img.height]).toEqual([640, 480]);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-27 resize and revisit: proportions kept, minimum size enforced, image still there after reload', async ({
    page,
    browser,
  }) => {
    const boardId = await createBoardId();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await setCamera(page, CAMERA);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Image (I)' }).click();
    await (await chooser).setFiles([fixtureFile('sample.webp')]);
    await expect.poll(() => loadedImages(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    const [before] = await imageStates(page);
    const ratio = before.width / before.height;

    await imageEls(page).first().click();
    const handle = page.getByRole('button', { name: 'Resize bottom-right' });
    let box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 10, { steps: 8 }); // stays clear of the zoom controls
    await page.mouse.up();
    const [grown] = await imageStates(page);
    expect(grown.width).toBeGreaterThan(before.width);
    expect(Math.abs(grown.width / grown.height - ratio) / ratio).toBeLessThan(0.01);
    expect([grown.x, grown.y]).toEqual([before.x, before.y]);

    // Drag the corner almost onto the opposite one: the image stops at the minimum size.
    box = (await handle.boundingBox())!;
    const topLeft = await toPage(page, { x: grown.x, y: grown.y });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(topLeft.x + 2, topLeft.y + 2, { steps: 10 });
    await page.mouse.up();
    const [shrunk] = await imageStates(page);
    expect(Math.min(shrunk.width, shrunk.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1e-6);
    expect(Math.min(shrunk.width, shrunk.height)).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 1);
    expect(Math.abs(shrunk.width / shrunk.height - ratio) / ratio).toBeLessThan(0.01);

    // A later visitor, in a new context, sees the image at its new size.
    const later = await openParticipant(browser, 'Later', boardId);
    try {
      await expect.poll(() => loadedImages(later.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      const [seen] = await imageStates(later.page);
      expect([seen.width, seen.height]).toEqual([shrunk.width, shrunk.height]);
      await expect(later.page.locator('[data-image-id] img')).toHaveAttribute('alt', 'Image');
    } finally {
      await closeAll([later]);
    }
  });

  test('TC-28 flaky upload: Upload failed with Retry; Retry after the network recovers shows the image everywhere', async ({
    browser,
  }) => {
    const [leo, sam] = await openParticipants(browser, ['Leo', 'Sam']);
    try {
      await setCamera(leo.page, CAMERA);
      await leo.page.route('**/api/boards/*/assets', (route) => route.abort('failed'));
      await dropFiles(leo.page, [fixtureFile('animated.gif')], await toPage(leo.page, { x: 500, y: 300 }));

      const mine = imageEls(leo.page).first();
      await expect(mine).toContainText('Upload failed');
      await expect(mine.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(mine.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(imageEls(sam.page).first()).toContainText('Image unavailable', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await leo.page.unroute('**/api/boards/*/assets');
      await mine.getByRole('button', { name: 'Retry' }).click();
      await expect.poll(() => loadedImages(leo.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      await expect.poll(() => loadedImages(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      const [img] = await imageStates(sam.page);
      expect(img.status).toBe('ready');
      expect([img.width, img.height]).toEqual([40, 30]); // the animated GIF's natural size
      await expect(imageEls(leo.page).first()).not.toContainText('Upload failed');
    } finally {
      await closeAll([leo, sam]);
    }
  });
});
