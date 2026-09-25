import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { fixturePath, IMAGE_FIXTURES } from '../fixtures/images';
import { openBoard } from './helpers/board';
import { dropFiles, fixtureDropFile } from './helpers/drop-files';
import {
  boardUrl,
  closeParticipants,
  expectWithin,
  openParticipants,
  waitConnected,
} from './helpers/participants';
import { centreOf, dragBetween, worldToPage } from './helpers/shapes';

/**
 * Story 12 e2e (assets.api, image.insert, image.object) in a real browser against the real
 * Worker, local R2 and the sync server: "Moodboard with a colleague" (TC-25), "Mixed picker
 * batch" (TC-26), "Resize and revisit" (TC-27) and "Flaky upload" (TC-28).
 */

const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Downloading and decoding an image after it is shared (local server); added to the live budget. */
const IMAGE_LOAD_ALLOWANCE_MS = 5000;
const ASPECT_TOLERANCE = 0.01;
const RESIZE_BY_PX = 150;
/** The corner is dragged to this far (screen px) from the opposite corner: below IMAGE_MIN_SIZE_WORLD at 100%. */
const SHRINK_TO_PX = 4;
const UPLOAD_ROUTE = '**/api/boards/*/assets';
const DROP_AT = { x: 300, y: 150 } as const;
/** Slightly over the limit (11 MB): refused before uploading. */
const OVERSIZE_BYTES = IMAGE_MAX_BYTES + 1024 * 1024;
const JPEG_START = [0xff, 0xd8, 0xff, 0xe0];
/** Floating-point slack when comparing sizes clamped to the minimum. */
const SIZE_EPSILON = 1e-6;

interface ImageState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

async function images(page: Page): Promise<ImageState[]> {
  // [] while the board is still opening (the test hooks are installed with it).
  return page.evaluate(() =>
    (window.__vidi6?.getObjects() ?? [])
      .filter((o) => o.type === 'image')
      .map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        width: o.width ?? 0,
        height: o.height ?? 0,
        status: o.status ?? '',
        assetKey: o.assetKey ?? null,
      })),
  );
}

/** How the images look on this screen: state and whether a picture has actually loaded. */
async function shown(page: Page): Promise<{ text: string; loaded: boolean }[]> {
  return page.getByTestId('image-object').evaluateAll((els) =>
    els.map((el) => {
      const img = el.querySelector('img');
      return { text: el.textContent ?? '', loaded: !!img && img.complete && img.naturalWidth > 0 };
    }),
  );
}

function toast(page: Page) {
  return page.getByRole('status', { name: 'Messages' });
}

/** Holds uploads until released (so the placeholders can be observed). */
async function gateUploads(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route(UPLOAD_ROUTE, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test.describe('images', () => {
  test('TC-25 moodboard with a colleague: Sam sees Uploading… placeholders, then all three images', async ({
    browser,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const participants = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = participants as [(typeof participants)[0], (typeof participants)[0]];
    try {
      const release = await gateUploads(leo.page);
      const cacheHeaders: string[] = [];
      sam.page.on('response', (res) => {
        if (res.url().includes('/api/assets/')) cacheHeaders.push(res.headers()['cache-control'] ?? '');
      });

      await dropFiles(leo.page, [fixtureDropFile('shotA'), fixtureDropFile('shotB'), fixtureDropFile('shotC')], DROP_AT);
      await expect.poll(async () => (await images(leo.page)).length).toBe(3);
      // Leo: placeholders of the final size, in a row from the drop point, with progress.
      const placed = [...(await images(leo.page))].sort((a, b) => a.x - b.x);
      expect(placed.map((i) => [i.width, i.height])).toEqual([
        [IMAGE_FIXTURES.shotA.width, IMAGE_FIXTURES.shotA.height],
        [IMAGE_FIXTURES.shotB.width, IMAGE_FIXTURES.shotB.height],
        [IMAGE_FIXTURES.shotC.width, IMAGE_FIXTURES.shotC.height],
      ]);
      const dropWorldTopLeft = await worldToPage(leo.page, { x: placed[0]!.x, y: placed[0]!.y });
      expect(dropWorldTopLeft.x).toBeCloseTo(DROP_AT.x, 0);
      expect(dropWorldTopLeft.y).toBeCloseTo(DROP_AT.y, 0);
      await expect(leo.page.getByTestId('image-progress')).toHaveCount(3);

      // Sam: "Uploading…" placeholders in the same places within the live budget.
      await expectWithin(async () => (await shown(sam.page)).map((s) => s.text)).toEqual([
        'Uploading…',
        'Uploading…',
        'Uploading…',
      ]);
      const samPlaced = [...(await images(sam.page))].sort((a, b) => a.x - b.x);
      expect(samPlaced.map((i) => [i.x, i.y, i.width, i.height])).toEqual(
        placed.map((i) => [i.x, i.y, i.width, i.height]),
      );

      release();
      await expect
        .poll(async () => (await shown(sam.page)).map((s) => s.loaded), {
          timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS,
        })
        .toEqual([true, true, true]);
      await expect.poll(async () => (await shown(leo.page)).every((s) => s.loaded)).toBe(true);
      expect(cacheHeaders.length).toBeGreaterThan(0);
      for (const h of cacheHeaders) expect(h).toContain('immutable');
      expect(leo.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-26 mixed picker batch: I opens the picker; one image added, type and size refused', async ({ page }) => {
    await openBoard(page);
    await waitConnected(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('i');
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    const oversize = Buffer.alloc(OVERSIZE_BYTES);
    oversize.set(JPEG_START);
    // A browser reports the renamed PDF as image/png, from its name.
    await picker.setFiles([
      { name: 'screenshot.png', mimeType: 'image/png', buffer: readFileSync(fixturePath('screenshot')) },
      { name: 'document-renamed.png', mimeType: 'image/png', buffer: readFileSync(fixturePath('renamedPdf')) },
      { name: 'huge-photo.jpg', mimeType: 'image/jpeg', buffer: oversize },
    ]);
    await expect(toast(page)).toContainText('Only PNG, JPEG, GIF and WebP images can be added.');
    await expect(toast(page)).toContainText('Images must be 10 MB or smaller.');
    await expect.poll(async () => (await images(page)).map((i) => i.status)).toEqual(['ready']);
    const [img] = await images(page);
    // 1440 × 900 placed with its longest side at 800.
    expect([img!.width, img!.height]).toEqual([800, 500]);
    await expect.poll(async () => (await shown(page))[0]?.loaded).toBe(true);
  });

  test('TC-27 resize and revisit: proportional resize with a minimum; the image is there after reload', async ({
    page,
    browser,
  }) => {
    await openBoard(page);
    await waitConnected(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Image (I)' }).click();
    await (await chooser).setFiles(fixturePath('screenshot'));
    await expect.poll(async () => (await images(page))[0]?.status).toBe('ready');
    const start = (await images(page))[0]!;
    const ratio = start.width / start.height;

    await page.getByTestId('image-object').click();
    await expect.poll(() => page.evaluate(() => window.__vidi6!.getSelection())).toEqual([start.id]);
    const corner = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await dragBetween(page, corner, { x: corner.x + RESIZE_BY_PX, y: corner.y + RESIZE_BY_PX / 3 });
    const grown = (await images(page))[0]!;
    expect(grown.width).toBeGreaterThan(start.width);
    expect(Math.abs(grown.width / grown.height - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);

    // Drag the top-left corner to just inside the opposite corner: far smaller than the minimum.
    // (The bottom-right corner now sits under the zoom controls.)
    const corner2 = await centreOf(page.getByRole('button', { name: 'Resize top-left' }));
    const bottomRight = await worldToPage(page, { x: grown.x + grown.width, y: grown.y + grown.height });
    await dragBetween(page, corner2, { x: bottomRight.x - SHRINK_TO_PX, y: bottomRight.y - SHRINK_TO_PX });
    const smallest = (await images(page))[0]!;
    expect(Math.min(smallest.width, smallest.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - SIZE_EPSILON);
    expect(Math.min(smallest.width, smallest.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 3);
    expect(Math.abs(smallest.width / smallest.height - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);

    const url = page.url();
    const { baseURL, viewport } = test.info().project.use;
    const later = await browser.newContext({ baseURL, viewport });
    try {
      const visitor = await later.newPage();
      await visitor.goto(url.startsWith('http') ? url : boardUrl(url));
      await expect.poll(async () => (await images(visitor)).length, { timeout: 15_000 }).toBe(1);
      const seen = (await images(visitor))[0]!;
      expect(seen).toMatchObject({ status: 'ready', width: smallest.width, height: smallest.height });
      await expect.poll(async () => (await shown(visitor))[0]?.loaded).toBe(true);
    } finally {
      await later.close();
    }
  });

  test('TC-28 flaky upload: Upload failed with Retry; after the network is back, Retry shows the image on both screens', async ({
    browser,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const participants = await openParticipants(browser, ['Leo', 'Sam']);
    const [leo, sam] = participants as [(typeof participants)[0], (typeof participants)[0]];
    try {
      await leo.page.route(UPLOAD_ROUTE, (route) => route.abort('connectionfailed'));
      await dropFiles(leo.page, [fixtureDropFile('shotC')], DROP_AT);
      const leoImage = leo.page.getByTestId('image-object');
      await expect(leoImage).toContainText('Upload failed');
      await expect(leoImage.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(leoImage.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expectWithin(async () => (await shown(sam.page)).map((s) => s.text)).toEqual(['Image unavailable']);

      await leo.page.unroute(UPLOAD_ROUTE);
      await leoImage.getByRole('button', { name: 'Retry' }).click();
      await expect.poll(async () => (await shown(leo.page))[0]?.loaded).toBe(true);
      await expect
        .poll(async () => (await shown(sam.page))[0]?.loaded, {
          timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + IMAGE_LOAD_ALLOWANCE_MS,
        })
        .toBe(true);
      expect((await images(leo.page)).map((i) => i.status)).toEqual(['ready']);
    } finally {
      await closeParticipants(participants);
    }
  });
});
