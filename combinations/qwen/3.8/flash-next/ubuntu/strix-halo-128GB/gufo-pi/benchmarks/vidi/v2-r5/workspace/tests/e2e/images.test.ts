/**
 * E2E tests for image workflows (TC-25 to TC-28).
 * These run against wrangler dev with the test build.
 */

import { test, expect } from '@playwright/test';
import { openBoard, waitForSettled } from './helpers/board';

/**
 * Simulate a file drop on the board viewport.
 * Uses canvas to generate a real PNG that createImageBitmap can decode.
 */
async function dropImageOnBoard(
  page: import('@playwright/test').Page,
  opts: { name?: string; mimeType?: string; size?: number; x?: number; y?: number; width?: number; height?: number } = {},
) {
  const {
    name = 'test.png',
    mimeType = 'image/png',
    size,
    x = 640,
    y = 400,
    width = 4,
    height = 3,
  } = opts;
  await page.evaluate(
    async ({ name, mimeType, size, x, y, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, width, height);

      let blob: Blob;
      if (mimeType === 'image/jpeg') {
        blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg'));
      } else {
        blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      }

      // Pad to requested size (for size limit tests)
      let data: Blob | Uint8Array = blob;
      if (size && size > blob.size) {
        const buf = new Uint8Array(size);
        const src = new Uint8Array(await blob.arrayBuffer());
        buf.set(src);
        data = buf;
      }

      const file = new File([data as BlobPart], name, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);

      const viewport = document.querySelector('[data-testid="board-viewport"]')!;
      const dropEvt = new DragEvent('drop', {
        dataTransfer: dt,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      viewport.dispatchEvent(dropEvt);
    },
    { name, mimeType, size, x, y, width, height },
  );
  await page.waitForTimeout(500);
  await waitForSettled(page);
}

/**
 * Read image objects from the board model.
 */
async function readImages(page: import('@playwright/test').Page) {
  const all = await page.evaluate(() => window.__vidi6?.getAllObjects() ?? []);
  return all.filter((obj: any) => obj.type === 'image') as any[];
}

/** Wait for the connection to be established. */
async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(async () => {
    const state = await page.evaluate(() => window.__vidi6?.connectionState);
    expect(state).toBe('connected');
  }).toPass({ timeout: 10_000 });
}

test.describe('TC-25: drop image file → placeholder appears on board', () => {
  test('drop PNG creates an image object in uploading or ready status', async ({ page }) => {
    await openBoard(page);
    await waitForConnected(page);

    await dropImageOnBoard(page, { name: 'test.png', mimeType: 'image/png', width: 4, height: 3 });

    const images = await readImages(page);
    expect(images.length).toBe(1);
    expect(images[0].type).toBe('image');
    // Upload may complete quickly in local dev
    expect(['uploading', 'ready']).toContain(images[0].status);
    expect(images[0].naturalWidth).toBe(4);
    expect(images[0].naturalHeight).toBe(3);
    expect(images[0].width).toBeGreaterThan(0);
    expect(images[0].height).toBeGreaterThan(0);
  });
});

test.describe('TC-26: resize image → dimensions stay proportional', () => {
  test('image placed with aspect ratio from natural dimensions', async ({ page }) => {
    await openBoard(page);
    await waitForConnected(page);

    // Drop an 8x4 image → 2:1 aspect ratio
    await dropImageOnBoard(page, { width: 8, height: 4 });

    const images = await readImages(page);
    expect(images.length).toBe(1);
    const img = images[0];
    // The placed size should preserve aspect ratio
    const placedRatio = img.width / img.height;
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    expect(Math.abs(placedRatio - naturalRatio)).toBeLessThan(0.01);
  });
});

test.describe('TC-27: undo after image placement removes placeholder', () => {
  test('Ctrl+Z after drop removes image from model', async ({ page }) => {
    await openBoard(page);
    await waitForConnected(page);

    await dropImageOnBoard(page, { name: 'test.png' });

    // Verify image exists
    let images = await readImages(page);
    expect(images.length).toBe(1);

    // Undo
    await page.keyboard.press('Control+z');
    await waitForSettled(page);
    await page.waitForTimeout(200);

    // Image should be gone
    images = await readImages(page);
    expect(images.length).toBe(0);
  });
});

test.describe('TC-28: drop file too large → toast shown, no image created', () => {
  test('oversized file shows toast, no object in model', async ({ page }) => {
    await openBoard(page);
    await waitForConnected(page);

    // Drop a 12 MB file (over 10 MB limit)
    await dropImageOnBoard(page, { name: 'big.png', mimeType: 'image/png', size: 12 * 1024 * 1024 });

    // Should see a toast notification
    const toast = page.locator('.toast-notification');
    await expect(toast).toBeVisible({ timeout: 3000 });
    const text = await toast.textContent();
    expect(text).toContain('10 MB');

    // No image objects created
    const images = await readImages(page);
    expect(images.length).toBe(0);
  });
});
