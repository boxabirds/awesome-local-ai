// Story 12 in real browsers against wrangler dev (local R2): dropping images with a colleague watching, a mixed
// picker batch, proportional resizing that survives a reload, and a failed upload retried.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getCamera, setCamera, settle } from './helpers/board';
import { randomVisitorIp } from './helpers/boards-api';
import { dropFiles, fixtureFile, FIXTURE_DIR } from './helpers/drop-files';
import { closeAll, openParticipants, waitConnected } from './helpers/participants';
import { handleCentre } from './helpers/selection';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';

const CAM = { x: 0, y: 0, zoom: 1 };
/** Generous allowance for the image download on top of the live-update budget. */
const IMAGE_LOAD_ALLOWANCE_MS = 5000;

async function images(page: Page): Promise<ImageSnap[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'image') as unknown as ImageSnap[],
  );
}

async function view(page: Page) {
  await page.waitForFunction(() => window.__vidi6?.setCamera !== undefined);
  await setCamera(page, CAM);
  await settle(page);
}

/** Each context uploads as its own visitor, so parallel tests never share an upload rate-limit bucket. */
async function ownVisitor(context: BrowserContext) {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': randomVisitorIp() });
}

/** A fixture as a file-chooser payload (Playwright cannot mix paths and buffers in one setFiles). */
function fixturePayload(name: string) {
  const f = fixtureFile(name);
  return { name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.base64, 'base64') };
}

/** How many images on the page have finished loading their stored file. */
function loadedImages(page: Page) {
  return page
    .locator('[data-image-id] img')
    .evaluateAll((els) => els.filter((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0).length);
}

test.describe('images', () => {
  test('TC-25 moodboard with a colleague: Sam sees uploading placeholders, then the three images', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = people;
    try {
      await Promise.all(people.map((p) => ownVisitor(p.context)));
      await Promise.all(people.map((p) => view(p.page)));
      // Hold Leo's uploads briefly so the uploading state is visible to Sam before they finish.
      await leo.page.route('**/api/boards/*/assets', async (route) => {
        await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
      });
      const cacheHeaders: string[] = [];
      sam.page.on('response', (res) => {
        if (res.url().includes('/api/assets/')) cacheHeaders.push(res.headers()['cache-control'] ?? '');
      });

      const files = [fixtureFile('screenshot.png'), fixtureFile('picture.webp'), fixtureFile('animated.gif')];
      await dropFiles(leo.page, files, { x: 100, y: 120 }, { hoverOnly: true });
      await expect(leo.page.getByTestId('drop-highlight')).toBeVisible();
      await dropFiles(leo.page, files, { x: 100, y: 120 });
      await expect(leo.page.getByTestId('drop-highlight')).toHaveCount(0);

      // Leo: three placeholders in a row from the drop point, each already its final size, with progress.
      await expect.poll(async () => (await images(leo.page)).length).toBe(3);
      const placed = (await images(leo.page)).sort((a, b) => a.x - b.x);
      const at = screenToWorld(await getCamera(leo.page), { x: 100, y: 120 });
      expect(placed.map((i) => [i.width, i.height])).toEqual([
        [800, 500],
        [640, 480],
        [120, 80],
      ]);
      expect(placed[0].x).toBeCloseTo(at.x);
      expect(placed[0].y).toBeCloseTo(at.y);
      expect(placed[1].x).toBeCloseTo(at.x + 800 + IMAGE_LAYOUT_GAP_WORLD);
      expect(placed[2].x).toBeCloseTo(at.x + 800 + 640 + 2 * IMAGE_LAYOUT_GAP_WORLD);
      expect(placed.every((i) => i.y === placed[0].y)).toBe(true);
      await expect(leo.page.locator('[data-image-id] [role="progressbar"]')).toHaveCount(3);

      // Sam: "Uploading…" placeholders at the same places within the live-update budget.
      await expect(sam.page.getByText('Uploading…')).toHaveCount(3, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS });
      const samSees = (await images(sam.page)).sort((a, b) => a.x - b.x);
      expect(samSees.map((i) => [i.x, i.y, i.width, i.height])).toEqual(placed.map((i) => [i.x, i.y, i.width, i.height]));

      // Then the images on both screens.
      for (const p of [leo.page, sam.page]) {
        await expect.poll(() => loadedImages(p), { timeout: 2000 + LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS }).toBe(3);
        await expect(p.getByRole('img', { name: 'Image' })).toHaveCount(3);
      }
      expect(cacheHeaders.length).toBeGreaterThan(0);
      for (const h of cacheHeaders) expect(h).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
      expect(leo.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });

  test('TC-26 mixed picker batch: one image added; type and size refusals explained', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Leo']);
    const [leo] = people;
    try {
      await ownVisitor(leo.context);
      await view(leo.page);
      const chooser = leo.page.waitForEvent('filechooser');
      await leo.page.keyboard.press('i');
      const picker = await chooser;
      expect(picker.isMultiple()).toBe(true);
      await picker.setFiles([
        fixturePayload('screenshot.png'),
        fixturePayload('document-renamed.png'),
        { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024, 0xff) },
      ]);
      const toast = leo.page.getByTestId('toast');
      await expect(toast).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
      await expect(toast).toContainText('Images must be 10 MB or smaller.');
      await expect.poll(() => loadedImages(leo.page), { timeout: 10_000 }).toBe(1);
      const [img] = await images(leo.page);
      expect(img.status).toBe('ready');
      expect([img.width, img.height]).toEqual([800, 500]);
      // Centred in the visible area.
      const centre = screenToWorld(await getCamera(leo.page), { x: 640, y: 400 });
      expect(img.x + img.width / 2).toBeCloseTo(centre.x);
      expect(img.y + img.height / 2).toBeCloseTo(centre.y);
      // The tool is back to Select.
      await expect(leo.page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await closeAll(people);
    }
  });

  test('TC-27 resize and revisit: proportional resize with a minimum size; the image is there after a reload', async ({ browser }) => {
    const { boardId, people } = await openParticipants(browser, ['Leo']);
    const [leo] = people;
    try {
      await ownVisitor(leo.context);
      await view(leo.page);
      const chooser = leo.page.waitForEvent('filechooser');
      await leo.page.getByRole('button', { name: 'Image (I)' }).click();
      await (await chooser).setFiles(`${FIXTURE_DIR}/screenshot.png`);
      await expect.poll(() => loadedImages(leo.page), { timeout: 10_000 }).toBe(1);
      const [before] = await images(leo.page);
      const ratio = before.width / before.height;

      // Select it and drag the bottom-right corner.
      await leo.page.mouse.click(640, 400);
      const corner = await handleCentre(leo.page, 'bottom-right');
      await leo.page.mouse.move(corner.x, corner.y);
      await leo.page.mouse.down();
      await leo.page.mouse.move(corner.x + 120, corner.y + 20, { steps: 6 });
      await leo.page.mouse.up();
      const [grown] = await images(leo.page);
      expect(grown.width).toBeGreaterThan(before.width);
      expect(Math.abs(grown.width / grown.height - ratio) / ratio).toBeLessThan(0.01);

      // Dragging far past the opposite corner stops at the minimum size, still in proportion.
      const again = await handleCentre(leo.page, 'bottom-right');
      await leo.page.mouse.move(again.x, again.y);
      await leo.page.mouse.down();
      await leo.page.mouse.move(again.x - 2000, again.y - 2000, { steps: 8 });
      await leo.page.mouse.up();
      const [small] = await images(leo.page);
      expect(Math.min(small.width, small.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 5);
      expect(Math.abs(small.width / small.height - ratio) / ratio).toBeLessThan(0.01);

      // A later visitor (new context) finds it, with the same size, loaded.
      const later = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const page = await later.newPage();
        await page.goto(`/b/${boardId}`);
        await waitConnected(page);
        await expect.poll(async () => (await images(page)).map((i) => [i.id, i.width, i.height, i.status])).toEqual([
          [small.id, small.width, small.height, 'ready'],
        ]);
        await expect.poll(() => loadedImages(page), { timeout: 10_000 }).toBe(1);
      } finally {
        await later.close();
      }
    } finally {
      await closeAll(people);
    }
  });

  test('TC-28 flaky upload: Upload failed with Retry; Sam sees Image unavailable; Retry succeeds for both', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = people;
    try {
      await Promise.all(people.map((p) => ownVisitor(p.context)));
      await Promise.all(people.map((p) => view(p.page)));
      await leo.page.route('**/api/boards/*/assets', (route) => route.abort('connectionfailed'));
      await dropFiles(leo.page, [fixtureFile('picture.webp')], { x: 200, y: 200 });

      const leoImage = leo.page.locator('[data-image-id]');
      await expect(leoImage.getByText('Upload failed')).toBeVisible();
      await expect(leoImage.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(sam.page.locator('[data-image-id]').getByText('Image unavailable')).toBeVisible({
        timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
      });

      await leo.page.unroute('**/api/boards/*/assets');
      await leoImage.getByRole('button', { name: 'Retry' }).click();
      for (const p of [leo.page, sam.page]) {
        await expect.poll(() => loadedImages(p), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS }).toBe(1);
      }
      const [img] = await images(sam.page);
      expect(img.status).toBe('ready');
      // The failed request is the only console error.
      expect(sam.errors).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});
