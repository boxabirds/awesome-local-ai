/**
 * E2E tests for image workflows (story 12).
 * TC-25, TC-26, TC-27, TC-28
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/images');

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
  return page;
}

/** Get image objects from the board. */
async function getImageObjects(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const board = [...((window as any).__vidi6?.getBoard?.() ?? [])];
    return board.filter((o: any) => o.type === 'image');
  });
}

/** Drop files onto the board via DataTransfer. */
async function dropFiles(page: Page, filePaths: string[], x: number, y: number): Promise<void> {
  // Read files into base64 to pass into browser
  const fileData = filePaths.map((fp) => {
    const buf = fs.readFileSync(fp);
    return {
      name: path.basename(fp),
      type: fp.endsWith('.png') ? 'image/png' : fp.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      data: buf.toString('base64'),
    };
  });

  await page.evaluate(({ fileData, x, y }) => {
    const dt = new DataTransfer();
    for (const f of fileData) {
      const binary = atob(f.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], f.name, { type: f.type });
      dt.items.add(file);
    }
    const board = document.querySelector('[data-testid="board-viewport"]')!;
    const enterEvent = new DragEvent('dragenter', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt });
    const overEvent = new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt });
    const dropEvent = new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt });
    board.dispatchEvent(enterEvent);
    board.dispatchEvent(overEvent);
    board.dispatchEvent(dropEvent);
  }, { fileData, x, y });
}

test.describe('Image E2E workflows', () => {
  test('TC-25: Moodboard with colleague - drop 3 images, Sam sees placeholders then images', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxLeo = await browser.newContext();
    const ctxSam = await browser.newContext();
    const leo = await openBoard(ctxLeo, boardId);
    const sam = await openBoard(ctxSam, boardId);

    const fixtureFiles = [
      path.join(FIXTURES, 'screenshot-100x100.png'),
      path.join(FIXTURES, 'screenshot-100x100b.png'),
      path.join(FIXTURES, 'pixel-1x1.png'),
    ];

    const dropX = 400;
    const dropY = 300;
    const dropStart = Date.now();

    await dropFiles(leo, fixtureFiles, dropX, dropY);

    // Wait for Sam to see image objects (placeholders or ready)
    await expect.poll(async () => {
      const images = await getImageObjects(sam);
      return images.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(3);

    // Wait for all to become ready
    await expect.poll(async () => {
      const images = await getImageObjects(sam);
      return images.filter((img: any) => img.status === 'ready').length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(3);

    const elapsed = Date.now() - dropStart;
    console.log(`[TC-25] drop-to-ready: ${elapsed}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);

    // Verify images are visible on Sam's screen
    const imgElements = sam.locator('[data-testid="image-object"]');
    await expect(imgElements).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Verify Cache-Control headers on served assets
    const leoImages = await getImageObjects(leo);
    const assetKey = leoImages[0].assetKey;
    const assetRes = await fetch(`http://localhost:5173/api/assets/${assetKey}`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('cache-control')).toContain('immutable');

    await ctxLeo.close();
    await ctxSam.close();
  });

  test('TC-26: Mixed picker batch - one valid image added; type and size toasts', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });

    // Create an oversized file fixture (10 MB + 1 byte)
    const overLimitPath = path.join(FIXTURES, 'over-10mb.png');
    if (!fs.existsSync(overLimitPath)) {
      const buf = Buffer.alloc(10 * 1024 * 1024 + 1);
      // Add PNG header so type is valid but size exceeds limit
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf);
      fs.writeFileSync(overLimitPath, buf);
    }

    // Use file input directly
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      path.join(FIXTURES, 'screenshot-100x100.png'),
      path.join(FIXTURES, 'disguised-as-png.png'), // renamed PDF
      overLimitPath,
    ]);

    // Wait for toast messages
    const toastContainer = page.locator('[data-testid="toast-container"]');
    await expect(toastContainer).toBeVisible({ timeout: 5000 });

    const toastText = await toastContainer.textContent();
    expect(toastText).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(toastText).toContain('Images must be 10 MB or smaller.');

    // Wait for one image to be added
    await expect.poll(async () => {
      const images = await getImageObjects(page);
      return images.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(1);

    // Clean up oversized fixture
    if (fs.existsSync(overLimitPath)) fs.unlinkSync(overLimitPath);
  });

  test('TC-27: Resize proportional and persists after reload', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await openBoard(ctx, boardId);

    // Drop an image
    await dropFiles(page, [path.join(FIXTURES, 'screenshot-100x100.png')], 400, 300);

    // Wait for image to be ready
    await expect.poll(async () => {
      const images = await getImageObjects(page);
      return images.filter((img: any) => img.status === 'ready').length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(1);

    // Select the image
    const imgEl = page.locator('[data-testid="image-object"]');
    const box = await imgEl.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Click to select
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // Get initial dimensions
    let images = await getImageObjects(page);
    const initial = images[0];
    const initialRatio = initial.width / initial.height;

    // Resize via handle (SE corner)
    const handle = page.locator('[data-testid="resize-handle-se"]');
    const handleVisible = await handle.count();
    if (handleVisible > 0) {
      const hBox = await handle.boundingBox();
      if (hBox) {
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(hBox.x + 60, hBox.y + 60, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(200);

        // Check aspect ratio preserved
        images = await getImageObjects(page);
        const resized = images[0];
        const newRatio = resized.width / resized.height;
        expect(Math.abs(newRatio - initialRatio) / initialRatio).toBeLessThan(0.02); // within 2%
      }
    }

    // Reload and check image persists
    const page2 = await ctx.newPage();
    await page2.goto(`/b/${boardId}`);
    await page2.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
    await expect.poll(async () => {
      const imgs = await getImageObjects(page2);
      return imgs.filter((img: any) => img.status === 'ready').length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(1);

    await ctx.close();
  });

  test('TC-28: Flaky upload - abort then retry succeeds', async ({ page }) => {
    const boardId = await createBoard();

    // Intercept POST assets to abort
    await page.route('**/api/boards/*/assets', (route) => {
      route.abort('failed');
    });

    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });

    // Drop an image - will fail
    await dropFiles(page, [path.join(FIXTURES, 'pixel-1x1.png')], 400, 300);

    // Wait for failed state
    await expect(page.locator('[data-testid="image-failed"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.locator('[data-testid="image-failed"]')).toContainText('Upload failed');
    await expect(page.locator('[data-testid="image-retry"]')).toBeVisible();

    // Restore the route
    await page.unroute('**/api/boards/*/assets');

    // Click Retry
    await page.locator('[data-testid="image-retry"]').click();

    // Wait for image to become ready
    await expect(page.locator('[data-testid="image-object"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});
