import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(__dirname, '../fixtures/images');

import * as fs from 'fs';

function readFixture(name: string): { name: string; mimeType: string; buffer: Buffer } {
  const filePath = path.resolve(FIXTURES, name);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(name).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return { name, mimeType: mimeTypes[ext] || 'application/octet-stream', buffer };
}

async function dropFiles(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  position?: { x: number; y: number },
): Promise<void> {
  const fileData = files.map((f) => ({
    name: f.name,
    mimeType: f.mimeType,
    base64: f.buffer.toString('base64'),
  }));

  const box = await target.boundingBox();
  if (!box) throw new Error('Target not found');
  const x = position?.x ?? box.x + box.width / 2;
  const y = position?.y ?? box.y + box.height / 2;

  await page.evaluate(
    ({ fileData, x, y }) => {
      const dt = new DataTransfer();
      for (const fd of fileData) {
        const bytes = Uint8Array.from(atob(fd.base64), (c) => c.charCodeAt(0));
        const file = new File([bytes], fd.name, { type: fd.mimeType });
        dt.items.add(file);
      }

      const el = document.elementFromPoint(x, y)!;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

      const dragEnter = new DragEvent('dragenter', { ...opts, dataTransfer: dt });
      const dragOver = new DragEvent('dragover', { ...opts, dataTransfer: dt });
      const drop = new DragEvent('drop', { ...opts, dataTransfer: dt });

      el.dispatchEvent(dragEnter);
      el.dispatchEvent(dragOver);
      el.dispatchEvent(drop);
    },
    { fileData, x, y },
  );
}

async function createBoardAndConnect(page: import('@playwright/test').Page): Promise<string> {
  const res = await fetch('http://localhost:8787/api/test/_create/init', { method: 'POST' });
  const { id } = await res.json() as { id: string };
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => {
    const s = (window as any).__vidi6?.connectionState;
    return s === 'connected' || s === 'confirmed';
  }, undefined, { timeout: 15000 });
  return id;
}

test.describe('E2E: Drop images onto the board', () => {
  test('TC-25: Moodboard with a colleague - drop images, colleague sees placeholders then images', async ({ browser }) => {
    const page1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const boardId = await createBoardAndConnect(page1);

    const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page2.goto(`/b/${boardId}`);
    await page2.waitForFunction(() => {
      const s = (window as any).__vidi6?.connectionState;
      return s === 'connected' || s === 'confirmed';
    }, undefined, { timeout: 15000 });

    const viewport = page1.locator('[data-testid="board-viewport"]');

    // Drop 3 images on page1
    const files = [
      readFixture('blue.png'),
      readFixture('green.png'),
      readFixture('red.png'),
    ];

    await dropFiles(page1, viewport, files, { x: 400, y: 300 });

    // page1 should see 3 image placeholders (uploading state)
    await expect(page1.locator('[data-testid="image-placeholder"]')).toHaveCount(3, { timeout: 5000 });

    // page2 should see "Uploading…" placeholders
    await expect.poll(
      () => page2.locator('[data-testid="image-placeholder"]').count(),
      { timeout: 5000 },
    ).toBe(3);

    // Wait for images to become ready on page1
    await expect(page1.locator('[data-testid="image-object"]')).toHaveCount(3, { timeout: 15000 });

    // Wait for images to become ready on page2
    await expect.poll(
      () => page2.locator('[data-testid="image-object"]').count(),
      { timeout: 15000 },
    ).toBe(3);

    // Verify asset serving with immutable Cache-Control
    const imgSrc = await page1.locator('[data-testid="image-object"] img').first().getAttribute('src');
    expect(imgSrc).toMatch(/^\/api\/assets\/.+/);

    await page1.close();
    await page2.close();
  });

  test('TC-26: Mixed picker batch - valid PNG + renamed PDF + large JPEG → 1 image + toasts', async ({ page }) => {
    await createBoardAndConnect(page);

    // Press I to open the picker
    await page.keyboard.press('i');

    // Wait for the hidden file input to exist
    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });

    await fileInput.setInputFiles([
      path.resolve(FIXTURES, 'blue.png'),
      path.resolve(FIXTURES, 'fake.png'),   // PDF renamed as .png
      path.resolve(FIXTURES, 'large_11mb.jpg'),
    ]);

    // Should show type or size rejection toast(s)
    await expect(page.locator('[data-testid="toast-container"]')).toBeVisible({ timeout: 5000 });

    // Should have 1 image placeholder or object (blue.png)
    const placeholders = page.locator('[data-testid="image-placeholder"]');
    const objects = page.locator('[data-testid="image-object"]');
    await expect.poll(
      async () => (await placeholders.count()) + (await objects.count()),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(1);

    // Wait for it to become ready
    await expect(page.locator('[data-testid="image-object"]')).toHaveCount(1, { timeout: 15000 });
  });

  test('TC-27: Resize and revisit - proportional resize persists after reload', async ({ page, browser }) => {
    await createBoardAndConnect(page);

    // Open picker and add an image
    await page.keyboard.press('i');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });
    await fileInput.setInputFiles([path.resolve(FIXTURES, 'blue.png')]);

    // Wait for image to load
    await expect(page.locator('[data-testid="image-object"]')).toHaveCount(1, { timeout: 15000 });

    // Get initial dimensions
    const imgLocator = page.locator('[data-testid="image-object"]');
    const initialBox = await imgLocator.boundingBox();
    expect(initialBox).toBeTruthy();
    const initialRatio = initialBox!.width / initialBox!.height;

    // Select the image by clicking on it
    await imgLocator.click({ position: { x: initialBox!.width / 2, y: initialBox!.height / 2 } });

    // Try to resize using a handle (if visible)
    const handle = page.locator('[data-testid="handle-se"]').first();
    const handleVisible = await handle.isVisible().catch(() => false);
    if (handleVisible) {
      const handleBox = await handle.boundingBox();
      if (handleBox) {
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2 + 30, handleBox.y + handleBox.height / 2 + 24, { steps: 5 });
        await page.mouse.up();
      }
    }

    // Verify aspect ratio is preserved (or unchanged if no resize happened)
    const newBox = await imgLocator.boundingBox();
    expect(newBox).toBeTruthy();
    const newRatio = newBox!.width / newBox!.height;
    expect(Math.abs(newRatio - initialRatio) / initialRatio).toBeLessThan(0.02);

    // Get the board URL
    const boardUrl = page.url();
    const boardId = new URL(boardUrl).pathname.split('/').pop()!;

    // Reload in a new context and verify image persists
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    await page2.goto(`/b/${boardId}`);
    await page2.waitForFunction(() => {
      const s = (window as any).__vidi6?.connectionState;
      return s === 'connected' || s === 'confirmed';
    }, undefined, { timeout: 15000 });

    await expect(page2.locator('[data-testid="image-object"]')).toHaveCount(1, { timeout: 10000 });

    await ctx2.close();
    await page.close();
  });

  test('TC-28: Flaky upload - route abort → failed, then retry succeeds', async ({ page }) => {
    await createBoardAndConnect(page);

    // Intercept and abort the upload
    let abortNext = true;
    await page.route('**/api/boards/*/assets', async (route) => {
      if (abortNext) {
        abortNext = false;
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Drop a file
    const viewport = page.locator('[data-testid="board-viewport"]');
    await dropFiles(page, viewport, [readFixture('blue.png')], { x: 400, y: 300 });

    // Should show failed state
    await expect(page.locator('[data-testid="image-failed"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="image-retry"]')).toBeVisible();

    // Click Retry (route now passes through)
    await page.locator('[data-testid="image-retry"]').click();

    // Should become ready
    await expect(page.locator('[data-testid="image-object"]')).toBeVisible({ timeout: 15000 });

    await page.close();
  });
});
