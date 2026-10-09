import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { E2E_EVENTUAL_TIMEOUT_MS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { jpegBytes, pdfBytes, solidPng } from '../fixtures/images';
import { dropFilesAt } from './drop-files';
import { apiCreateBoard, logLatency, openBoard, setCamera } from './helpers';

/**
 * Story 12 e2e (images.spec.ts): the real image workflows against
 * `wrangler dev` with a local (in-memory) R2 bucket — drop via DataTransfer,
 * the picker via setInputFiles, upload failure + retry, aspect-locked resize,
 * persistence across contexts, and immutable serving.
 *
 * Every camera is pinned to (0,0,1) so world units equal screen pixels.
 */

interface DocImage {
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

const readyImages = (page: import('@playwright/test').Page) => page.locator('img[data-image-ready]');

/** Image objects from the board doc (ids are the objects-map keys). */
async function docImages(page: import('@playwright/test').Page): Promise<DocImage[]> {
  return page.evaluate(() => {
    const out: DocImage[] = [];
    (window as any).__vidi6.doc.getMap('objects').forEach((v: { get(k: string): unknown }) => {
      if (v.get('type') !== 'image') return;
      out.push({
        x: v.get('x') as number,
        y: v.get('y') as number,
        width: v.get('width') as number,
        height: v.get('height') as number,
        status: String(v.get('status')),
        assetKey: (v.get('assetKey') as string | null) ?? null,
      });
    });
    return out;
  });
}

test.describe('images (real browser + wrangler dev + local R2)', () => {
  test('TC-25: moodboard with a colleague — placeholders, then images on both screens; immutable GETs', async ({
    page,
    request,
    browser,
  }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board); // Leo
    await setCamera(page, 0, 0, 1); // screen == world
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await openBoard(sam, board); // Sam
    await setCamera(sam, 0, 0, 1);

    const t0 = Date.now();
    await dropFilesAt(
      page,
      [
        { name: 'shot-a.png', type: 'image/png', bytes: solidPng(1440, 900, [200, 60, 60]) },
        { name: 'shot-b.png', type: 'image/png', bytes: solidPng(1440, 900, [60, 200, 120]) },
        { name: 'shot-c.png', type: 'image/png', bytes: solidPng(1440, 900, [80, 90, 220]) },
      ],
      100,
      100,
    );

    // Sam sees placeholders while the uploads are in flight. The
    // drop-to-visible time is logged, never asserted (design decision).
    await logLatency('moodboard drop-to-placeholder (colleague)', t0, async () =>
      (await sam.getByText('Uploading…').count()) >= 1,
    );

    // Then all three images render on both screens.
    await expect(readyImages(page)).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(readyImages(sam)).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // 1440x900 screenshots are placed scaled to IMAGE_MAX_PLACE_SIZE_WORLD
    // (800 on the longest side → 800x500) in a row from the drop point.
    const imgs = await docImages(page);
    expect(imgs).toHaveLength(3);
    expect(imgs[0].x).toBe(100);
    expect(imgs[0].y).toBe(100);
    expect(imgs[0].width).toBe(800);
    expect(imgs[0].height).toBe(500);
    expect(imgs[1].x).toBe(100 + 800 + 24);
    expect(imgs[2].x).toBe(100 + (800 + 24) * 2);

    // Serving is immutable: every asset GET carries a long max-age + immutable.
    for (const img of imgs) {
      const res = await request.get(`/api/assets/${img.assetKey}`);
      expect(res.status()).toBe(200);
      const cc = res.headers()['cache-control'] ?? '';
      expect(cc).toContain('immutable');
      expect(cc).toMatch(/max-age=\d{6,}/);
    }
    await samCtx.close();
  });

  test('TC-26: mixed picker batch — one image added, exact type + size toasts', async ({ page, request }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidi6-e2e-img-'));
    try {
      const pngPath = path.join(dir, 'valid.png');
      const pdfPath = path.join(dir, 'renamed.png'); // PDF bytes behind a .png name
      const bigPath = path.join(dir, 'big.jpg'); // 10 MB + 1 byte
      fs.writeFileSync(pngPath, solidPng(64, 48, [10, 120, 200]));
      fs.writeFileSync(pdfPath, pdfBytes);
      fs.writeFileSync(bigPath, jpegBytes(IMAGE_MAX_BYTES + 1));

      const board = await apiCreateBoard(request);
      await openBoard(page, board);
      await setCamera(page, 0, 0, 1); // screen == world
      await page.keyboard.press('i'); // Image picker
      await page.setInputFiles('input[type="file"]', [pngPath, pdfPath, bigPath]);

      // Only the valid PNG becomes an image (placed at its natural size).
      await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const imgs = await docImages(page);
      expect(imgs).toHaveLength(1);
      expect(imgs[0].width).toBe(64);
      expect(imgs[0].height).toBe(48);

      // The rejection toasts carry the exact PRD wording.
      await expect(page.getByText(REJECTION_MESSAGES.type)).toBeVisible();
      await expect(page.getByText(REJECTION_MESSAGES.size)).toBeVisible();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC-27: aspect-locked resize, min-size floor, and the image survives a revisit', async ({
    page,
    request,
    browser,
  }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board);
    await setCamera(page, 0, 0, 1); // screen == world
    await dropFilesAt(page, [{ name: 'pic.png', type: 'image/png', bytes: solidPng(800, 600, [12, 34, 56]) }], 100, 100);
    await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    let imgs = await docImages(page);
    expect(imgs[0].width).toBe(800);
    expect(imgs[0].height).toBe(600);

    // Select the image and drag the bottom-right corner from (900,700) to
    // (700,550): the width delta dominates → scale 0.75 → 600x450 (4:3 kept).
    await page.mouse.click(500, 400);
    await expect(page.getByRole('button', { name: 'Resize bottom-right' })).toBeVisible();
    await page.mouse.move(900, 700);
    await page.mouse.down();
    await page.mouse.move(700, 550, { steps: 8 });
    await page.mouse.up();

    imgs = await docImages(page);
    const ratio = imgs[0].width / imgs[0].height;
    expect(Math.abs(ratio - 800 / 600) / (800 / 600)).toBeLessThan(0.01);
    expect(imgs[0].width).toBeCloseTo(600, 0);
    expect(imgs[0].height).toBeCloseTo(450, 0);

    // Drag far smaller than IMAGE_MIN_SIZE_WORLD (16): the resize stops at
    // the floor instead of collapsing.
    await page.mouse.move(700, 550);
    await page.mouse.down();
    await page.mouse.move(100.5, 100.5, { steps: 8 });
    await page.mouse.up();

    imgs = await docImages(page);
    expect(imgs[0].width).toBeGreaterThanOrEqual(15.5);
    expect(imgs[0].width).toBeLessThanOrEqual(16.5);
    expect(imgs[0].height).toBeGreaterThanOrEqual(15.5);
    expect(imgs[0].height).toBeLessThanOrEqual(16.5);

    // A fresh context revisits the board: the image is there, ready.
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await openBoard(p2, board);
    await setCamera(p2, 0, 0, 1);
    await expect(readyImages(p2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const imgs2 = await docImages(p2);
    expect(imgs2[0].status).toBe('ready');
    expect(imgs2[0].assetKey).toBe(imgs[0].assetKey);
    await ctx.close();
  });

  test('TC-28: flaky upload — the failure is visible on both screens, Retry recovers', async ({
    page,
    request,
    browser,
  }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board); // Leo (uploader)
    await setCamera(page, 0, 0, 1); // screen == world
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await openBoard(sam, board); // Sam
    await setCamera(sam, 0, 0, 1);

    // Break the upload endpoint for Leo only.
    const route = `**/api/boards/${board}/assets`;
    await page.route(route, (r) => r.abort());
    // 320x240: large enough that the failed-state controls (icon, text,
    // Retry + Remove) fit inside the object box and stay clickable.
    await dropFilesAt(page, [{ name: 'flaky.png', type: 'image/png', bytes: solidPng(320, 240, [9, 9, 9]) }], 200, 150);

    // Leo: "Upload failed" with a Retry (the file is still in memory).
    await expect(page.getByText('Upload failed')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    // Sam: the failed status syncs → "Image unavailable" (no controls for others).
    await expect(sam.getByText('Image unavailable')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Restore the endpoint and retry: the image becomes ready on both screens.
    await page.unroute(route);
    await retry.click();
    await expect(readyImages(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(readyImages(sam)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // The retried upload really landed in R2.
    const imgs = await docImages(page);
    const res = await request.get(`/api/assets/${imgs[0].assetKey}`);
    expect(res.status()).toBe(200);
    await samCtx.close();
  });
});
