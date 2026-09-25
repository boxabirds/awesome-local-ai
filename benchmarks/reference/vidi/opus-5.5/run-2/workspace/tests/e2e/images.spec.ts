/**
 * Story 12 e2e (TC-25 to TC-28): images in real browsers against `wrangler dev` with local R2.
 * Workflows: "Moodboard with a colleague" (TC-25), "Mixed picker batch" (TC-26),
 * "Resize and revisit" (TC-27), "Flaky upload" (TC-28).
 */
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import type { Camera } from '../../src/client/canvas/camera';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { openBoard, setCamera } from './helpers/board';
import { centreOf, closeAll, expectWithin, openParticipant, openParticipants, type Participant } from './helpers/participants';
import { dropFiles, fixture, type FixtureFile } from './helpers/drop-files';

const CAM: Camera = { x: 0, y: 0, zoom: 1 };
const RATIO_TOLERANCE = 0.01;
/** Time allowed for a browser to download and decode a stored image from local R2. */
const IMAGE_LOAD_ALLOWANCE_MS = 5000;
const TYPE_MESSAGE = 'Only PNG, JPEG, GIF and WebP images can be added.';
const SIZE_MESSAGE = 'Images must be 10 MB or smaller.';
const UPLOAD_ROUTE = '**/api/boards/*/assets';

interface RenderedImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
}

function imageObjects(page: Page): Locator {
  return page.locator('.image-object');
}

async function renderedImages(page: Page): Promise<RenderedImage[]> {
  const all = await imageObjects(page).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
        status: h.dataset.status ?? '',
      };
    }),
  );
  return all.sort((a, b) => a.x - b.x);
}

/** Images that finished loading and decoded (naturalWidth > 0). */
async function loadedImages(page: Page): Promise<number> {
  return page
    .locator('.image-object img')
    .evaluateAll((els) => els.filter((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0).length);
}

async function statusCount(page: Page, status: string): Promise<number> {
  return page.locator(`.image-object[data-status="${status}"]`).count();
}

async function pickWithImageTool(page: Page, files: FixtureFile[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('i');
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  await fc.setFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })));
}

function bigJpeg(size: number): FixtureFile {
  const jpeg = fixture('photo-4032x3024.jpg').buffer;
  const buffer = Buffer.alloc(size);
  jpeg.copy(buffer, 0, 0, Math.min(jpeg.length, size));
  return { name: 'huge-photo.jpg', mimeType: 'image/jpeg', buffer };
}

test.describe('images', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(people);
    people = [];
  });

  test('TC-25 moodboard: Leo drops three images; Sam sees Uploading… placeholders, then the images', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    people = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = people as [Participant, Participant];
    await setCamera(leo.page, CAM);
    await setCamera(sam.page, CAM);

    // Hold Leo's uploads so both screens are seen mid-upload.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await leo.page.route(UPLOAD_ROUTE, async (route) => {
      await gate;
      await route.continue();
    });

    // Drop highlight while dragging, then the drop.
    await dropFiles(leo.page, [fixture('screenshot-1440x900.png')], { x: 200, y: 150 }, { drop: false });
    await expect(leo.page.getByTestId('drop-highlight')).toBeVisible();
    await dropFiles(
      leo.page,
      [fixture('screenshot-1440x900.png'), fixture('sketch-640x480.webp'), fixture('animated.gif')],
      { x: 200, y: 150 },
    );
    await expect(leo.page.getByTestId('drop-highlight')).toHaveCount(0);
    await expect(imageObjects(leo.page)).toHaveCount(3);
    await expect(leo.page.getByRole('progressbar')).toHaveCount(3);
    const placed = await renderedImages(leo.page);
    expect(placed.map((i) => [i.x, i.y, i.width, i.height])).toEqual([
      [200, 150, 800, 500],
      [200 + 800 + IMAGE_LAYOUT_GAP_WORLD, 150, 640, 480],
      [200 + 800 + 640 + 2 * IMAGE_LAYOUT_GAP_WORLD, 150, 160, 120],
    ]);

    await expectWithin(() => sam.page.getByText('Uploading…').count(), 'Sam sees the placeholders').toBe(3);
    expect((await renderedImages(sam.page)).map((i) => [i.x, i.y, i.width, i.height])).toEqual(
      placed.map((i) => [i.x, i.y, i.width, i.height]),
    );

    const served: Response[] = [];
    sam.page.on('response', (r) => {
      if (r.url().includes('/api/assets/')) served.push(r);
    });
    release();
    await expect.poll(() => statusCount(leo.page, 'ready'), { timeout: IMAGE_LOAD_ALLOWANCE_MS }).toBe(3);
    await expectWithin(() => statusCount(sam.page, 'ready'), 'ready reaches Sam').toBe(3);
    await expect.poll(() => loadedImages(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS }).toBe(3);
    await expect.poll(() => loadedImages(leo.page), { timeout: IMAGE_LOAD_ALLOWANCE_MS }).toBe(3);
    expect(served.length).toBeGreaterThanOrEqual(3);
    for (const r of served) {
      expect(r.status()).toBe(200);
      const headers = await r.allHeaders();
      expect(headers['cache-control']).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
      expect(headers['x-content-type-options']).toBe('nosniff');
    }
    expect(await sam.page.getByRole('img', { name: 'Image' }).count()).toBe(3);

    // One add action is one undo step.
    await leo.page.keyboard.press('ControlOrMeta+z');
    await expect(imageObjects(leo.page)).toHaveCount(0);
    await expectWithin(() => imageObjects(sam.page).count(), 'undo reaches Sam').toBe(0);
    expect(sam.errors).toEqual([]);
  });

  test('TC-26 mixed picker batch: I, a PNG, a PDF named .png and an 11 MB JPEG → one image, type and size messages', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await pickWithImageTool(page, [fixture('small-400x300.png'), fixture('document-renamed.png'), bigJpeg(IMAGE_MAX_BYTES + 1024 * 1024)]);
    const toast = page.getByTestId('toast');
    await expect(toast).toContainText(TYPE_MESSAGE);
    await expect(toast).toContainText(SIZE_MESSAGE);
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(imageObjects(page)).toHaveCount(1);
    await expect(page.locator('.image-object[data-status="ready"]')).toHaveCount(1);
    await expect.poll(() => loadedImages(page)).toBe(1);
    // Centred in the visible area.
    const box = await imageObjects(page).boundingBox();
    const view = page.viewportSize()!;
    expect(Math.abs(box!.x + box!.width / 2 - view.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - view.height / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-27 resize keeps the proportions with a minimum size; the image is there after a reload', async ({ page, browser }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await pickWithImageTool(page, [fixture('small-400x300.png')]);
    const el = imageObjects(page);
    await expect(el).toHaveAttribute('data-status', 'ready');
    const [i0] = await renderedImages(page);
    expect([i0!.width, i0!.height]).toEqual([400, 300]);

    const c = await centreOf(el);
    await page.mouse.click(c.x, c.y);
    await expect(el).toHaveAttribute('data-selected', 'true');
    const se = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move(se.x + 200, se.y + 30, { steps: 10 });
    await page.mouse.up();
    const [i1] = await renderedImages(page);
    expect(i1!.width).toBeGreaterThan(500);
    expect(Math.abs(i1!.width / i1!.height - 4 / 3) / (4 / 3)).toBeLessThanOrEqual(RATIO_TOLERANCE);

    // Far past the minimum: stops with the short side at IMAGE_MIN_SIZE_WORLD.
    const se2 = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await page.mouse.move(se2.x, se2.y);
    await page.mouse.down();
    await page.mouse.move(se2.x - 900, se2.y - 900, { steps: 12 });
    await page.mouse.up();
    const [i2] = await renderedImages(page);
    expect(i2!.height).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 3);
    expect(Math.abs(i2!.width / i2!.height - 4 / 3) / (4 / 3)).toBeLessThanOrEqual(RATIO_TOLERANCE);

    // Grow it back a little and revisit in a fresh context.
    const se3 = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await page.mouse.move(se3.x, se3.y);
    await page.mouse.down();
    await page.mouse.move(se3.x + 120, se3.y + 90, { steps: 8 });
    await page.mouse.up();
    const [i3] = await renderedImages(page);
    const boardId = new URL(page.url()).pathname.split('/').pop()!;
    const later = await openParticipant(browser, boardId, 'Later visitor');
    people = [later];
    await expect(imageObjects(later.page)).toHaveCount(1);
    await expect(imageObjects(later.page)).toHaveAttribute('data-status', 'ready');
    await expect.poll(() => loadedImages(later.page), { timeout: IMAGE_LOAD_ALLOWANCE_MS }).toBe(1);
    const [seen] = await renderedImages(later.page);
    expect(seen!.width).toBeCloseTo(i3!.width, 6);
    expect(seen!.height).toBeCloseTo(i3!.height, 6);
    expect(later.errors).toEqual([]);
  });

  test('TC-28 flaky upload: the network fails, Upload failed with Retry; Retry succeeds on both screens', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    people = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = people as [Participant, Participant];
    await setCamera(leo.page, CAM);
    await setCamera(sam.page, CAM);
    await leo.page.route(UPLOAD_ROUTE, (route) => route.abort('connectionfailed'));

    await dropFiles(leo.page, [fixture('small-400x300.png')], { x: 300, y: 200 });
    const mine = imageObjects(leo.page);
    await expect(mine.getByText('Upload failed')).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expectWithin(() => imageObjects(sam.page).getByText('Image unavailable').count(), 'Sam sees the failure').toBe(1);

    await leo.page.unroute(UPLOAD_ROUTE);
    await mine.getByRole('button', { name: 'Retry' }).click();
    await expect(mine).toHaveAttribute('data-status', 'ready', { timeout: IMAGE_LOAD_ALLOWANCE_MS });
    await expectWithin(() => statusCount(sam.page, 'ready'), 'ready reaches Sam').toBe(1);
    await expect.poll(() => loadedImages(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS }).toBe(1);
    await expect.poll(() => loadedImages(leo.page), { timeout: IMAGE_LOAD_ALLOWANCE_MS }).toBe(1);
    expect(sam.errors).toEqual([]);
  });
});
