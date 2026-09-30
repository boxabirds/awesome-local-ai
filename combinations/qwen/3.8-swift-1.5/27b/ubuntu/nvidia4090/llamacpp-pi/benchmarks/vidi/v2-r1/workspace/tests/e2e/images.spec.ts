/**
 * Story 12: Drop images onto the board — e2e.
 *
 * TC-25: real drag-and-drop of three fixture images → placeholders → all visible.
 * TC-26: picker with a valid image + renamed PDF + 11 MB file → one added,
 *        type and size toasts.
 * TC-27: aspect-locked resize + persistence after reload.
 * TC-28: upload failure (route abort) → Retry recovers the image.
 */
import { test, expect } from '@playwright/test';
import { openNewBoard } from './helpers/board';
import { dropFilesOn, canvasPngBase64, getBoardObjects } from './helpers/drop-files';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function imageStatuses(objects: any[]): string[] {
  return objects.filter((o) => o.type === 'image').map((o) => o.status);
}

async function waitImagesReady(page: import('@playwright/test').Page, count: number) {
  await expect
    .poll(
      async () => (await getBoardObjects(page)).filter((o: { type: string; status: string }) => o.type === 'image' && o.status === 'ready').length,
      { timeout: 20_000 },
    )
    .toBe(count);
}

test.describe('Story 12: images', () => {
  test('TC-25: drop three PNGs → all three become ready', async ({ page }) => {
    const boardId = await openNewBoard(page);
    const b1 = await canvasPngBase64(page, 40, 20, '#ff0000');
    const b2 = await canvasPngBase64(page, 30, 30, '#00ff00');
    const b3 = await canvasPngBase64(page, 20, 40, '#0000ff');

    const t0 = Date.now();
    await dropFilesOn(page, '[data-testid="board-viewport"]', [
      { name: 'a.png', type: 'image/png', base64: b1 },
      { name: 'b.png', type: 'image/png', base64: b2 },
      { name: 'c.png', type: 'image/png', base64: b3 },
    ]);

    // Placeholders appear immediately.
    await expect
      .poll(async () => (await getBoardObjects(page)).filter((o: { type: string }) => o.type === 'image').length)
      .toBe(3);

    // All three uploads complete.
    await waitImagesReady(page, 3);
    // Drop-to-visible time is logged, not asserted (LIVE_UPDATE_LATENCY_BUDGET_MS).
    console.log(`[TC-25] drop-to-visible: ${Date.now() - t0}ms (board ${boardId})`);

    // All three are rendered as <img> with asset URLs.
    const imgs = page.locator('[data-vidi-object="image"] img');
    expect(await imgs.count()).toBe(3);
    for (let i = 0; i < 3; i++) {
      await expect(imgs.nth(i)).toHaveAttribute('src', new RegExp(`^/api/assets/${boardId}/`));
    }
  });

  test('TC-26: picker with valid + renamed PDF + 11 MB → one added, type and size toasts', async ({ page }) => {
    await openNewBoard(page);
    const b1 = await canvasPngBase64(page, 40, 20, '#ff0000');

    // Open the picker via the Image tool.
    await page.getByTestId('tool-image').click();
    const input = page.getByTestId('image-file-input');
    await input.waitFor({ state: 'attached' });

    const pngBytes = Buffer.from(b1, 'base64');
    const pdfDisguised = Buffer.from('%PDF-1.4 fake pdf bytes that are not a PNG');
    const tooBig = Buffer.alloc(11 * 1024 * 1024, 1);

    await input.setInputFiles([
      { name: 'photo.png', mimeType: 'image/png', buffer: pngBytes },
      { name: 'renamed.pdf.png', mimeType: 'image/png', buffer: pdfDisguised },
      { name: 'huge.png', mimeType: 'image/png', buffer: tooBig },
    ]);

    // Exactly one image is added and becomes ready.
    await waitImagesReady(page, 1);

    // Both rejection toasts are shown.
    await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
  });

  test('TC-27: aspect-locked resize is preserved after reload', async ({ page }) => {
    const boardId = await openNewBoard(page);
    const b1 = await canvasPngBase64(page, 40, 20, '#ff0000'); // 2:1

    await dropFilesOn(page, '[data-testid="board-viewport"]', [
      { name: 'a.png', type: 'image/png', base64: b1 },
    ]);
    await waitImagesReady(page, 1);

    const before = (await getBoardObjects(page)).find((o: { type: string }) => o.type === 'image');
    const ratioBefore = before.width / before.height;
    expect(ratioBefore).toBeCloseTo(2, 1);

    // Select the image, then drag its bottom-right resize handle.
    await page.locator('[data-vidi-object="image"]').click();
    const handle = page.getByTestId('resize-handle-se');
    await handle.waitFor();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 10, { steps: 5 });
    await page.mouse.up();

    const after = (await getBoardObjects(page)).find((o: { type: string }) => o.type === 'image');
    const ratioAfter = after.width / after.height;
    // Aspect ratio preserved within 1%.
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);
    // It actually grew.
    expect(after.width).toBeGreaterThan(before.width);

    // Reload → the image persists with the same (resized) dimensions.
    await page.reload();
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await waitImagesReady(page, 1);
    const persisted = (await getBoardObjects(page)).find((o: { type: string }) => o.type === 'image');
    expect(persisted.width).toBeCloseTo(after.width, 0);
    expect(persisted.height).toBeCloseTo(after.height, 0);
    await expect(page.locator(`[data-vidi-object="image"] img`)).toHaveAttribute('src', new RegExp(`^/api/assets/${boardId}/`));
  });

  test('TC-28: upload failure → Retry recovers the image', async ({ page }) => {
    const boardId = await openNewBoard(page);
    const b1 = await canvasPngBase64(page, 40, 20, '#ff0000');

    // Block the upload route.
    await page.route(`**/api/boards/${boardId}/assets`, (route) => route.abort());

    await dropFilesOn(page, '[data-testid="board-viewport"]', [
      { name: 'a.png', type: 'image/png', base64: b1 },
    ]);

    // The upload fails → "Upload failed" with a Retry button.
    await expect(page.getByText('Upload failed')).toBeVisible({ timeout: 20_000 });
    expect(await imageStatuses(await getBoardObjects(page))).toEqual(['failed']);

    // Restore the route and retry.
    await page.unroute(`**/api/boards/${boardId}/assets`);
    await page.getByTestId('image-retry').click();

    await waitImagesReady(page, 1);
    await expect(page.locator('[data-vidi-object="image"] img')).toBeVisible();
  });
});
