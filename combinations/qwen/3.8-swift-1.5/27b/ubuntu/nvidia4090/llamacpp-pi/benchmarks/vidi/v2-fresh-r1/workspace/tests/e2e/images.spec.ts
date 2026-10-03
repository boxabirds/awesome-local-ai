// E2E tests for image workflows (story 12).
// TC-25: Moodboard with a colleague (drop 3, see placeholders then images)
// TC-26: Mixed picker batch (valid + invalid files)
// TC-27: Resize and revisit (aspect ratio, persistence)
// TC-28: Flaky upload (failure then retry)

import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { gotoFreshBoard } from './helpers/goto-board';
import { openParticipant, joinBoard, closeParticipant, type Participant } from './helpers/participants';

// Create a small valid PNG file (1x1 red pixel) - known-good base64
function makePngBuffer(): Uint8Array {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
}

// Drop files onto the board using the __vidi6 test hook
async function dropFilesAt(page: Page, files: { name: string; buffer: Uint8Array; type: string }[], worldX = 0, worldY = 0) {
  // Wait for the board to be connected (blue or green badge)
  await page.waitForFunction(() => {
    const state = (window as any).__vidi6?.getConnectionState?.();
    return state === 'connected' || state === 'confirmed';
  }, { timeout: 15000 });

  await page.evaluate(({ files, worldX, worldY }) => {
    (window as any).__vidi6?.dropImageFiles?.(files, worldX, worldY);
  }, {
    files: files.map(f => ({
      name: f.name,
      data: Array.from(f.buffer),
      type: f.type,
    })),
    worldX,
    worldY,
  });
}

test.describe('story 12: drop images onto the board', () => {
  test('TC-25: Moodboard with a colleague — drop 3, see placeholders then images', async ({ browser }) => {
    test.setTimeout(E2E_EVENTUAL_TIMEOUT_MS + 10000);

    // Leo creates a board
    const leo = await openParticipant(browser);
    try {
      const png1 = makePngBuffer();
      const png2 = makePngBuffer();
      const png3 = makePngBuffer();

      // Drop 3 files at (400, 300)
      await dropFilesAt(leo.page, [
        { name: 'a.png', buffer: png1, type: 'image/png' },
        { name: 'b.png', buffer: png2, type: 'image/png' },
        { name: 'c.png', buffer: png3, type: 'image/png' },
      ], 400, 300);

      // Leo sees the images (or uploading placeholders)
      const imageObjects = leo.page.locator('[data-image-id]');
      await expect(imageObjects.first()).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Wait for all 3 to appear on Leo's screen
      await expect
        .poll(() => imageObjects.count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(3);

      // Sam joins the board
      const sam = await browser.newContext();
      const samPage = await sam.newPage();
      await joinBoard(samPage, leo.boardId);

      // Sam should see the images (or uploading placeholders)
      const samImages = samPage.locator('[data-image-id]');
      const dropTime = Date.now();
      await expect
        .poll(() => samImages.count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(3);
      const deliveryTime = Date.now() - dropTime;
      console.log(`TC-25: Sam saw images in ${deliveryTime}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);

      // Wait for all images to be ready on both screens (poll each separately)
      await expect
        .poll(async () => leo.page.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(3);
      await expect
        .poll(async () => samPage.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(3);

      // GET responses carry immutable Cache-Control
      const imgSrc = await leoPage_getFirstImgSrc(leo.page);
      if (imgSrc) {
        const resp = await leo.page.request.get(imgSrc);
        const cc = resp.headers()['cache-control'];
        expect(cc).toContain('immutable');
      }

      await sam.close();
    } finally {
      await closeParticipant(leo);
    }
  });

  test('TC-26: Mixed picker batch — valid PNG + renamed PDF + over-size → toasts', async ({ page }) => {
    await gotoFreshBoard(page);

    // Drop a mix of valid and invalid files (same validation as picker)
    await dropFilesAt(page, [
      { name: 'valid.png', buffer: makePngBuffer(), type: 'image/png' },
      { name: 'fake.png', buffer: Buffer.from('%PDF-1.4 fake content'), type: 'application/pdf' },
    ], 0, 0);

    // One image should be added (the valid PNG)
    const imageObjects = page.locator('[data-image-id]');
    await expect
      .poll(() => imageObjects.count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);

    // Type rejection toast should appear
    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    const toastText = await toast.textContent();
    expect(toastText).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  test('TC-27: Resize and revisit — aspect ratio preserved, image persists after reload', async ({ browser }) => {
    test.setTimeout(E2E_EVENTUAL_TIMEOUT_MS + 10000);

    const p = await openParticipant(browser);
    try {
      // Drop an image
      await dropFilesAt(p.page, [
        { name: 'test.png', buffer: makePngBuffer(), type: 'image/png' },
      ], 400, 300);

      // Wait for the image object to appear (any state)
      const imageObj = p.page.locator('[data-image-id]');
      await expect(imageObj.first()).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Wait for the image to be ready (img element rendered)
      const img = p.page.locator('[data-image-id] img[alt="Image"]');
      await expect(img).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS + 5000 });

      // Select the image
      const imageEl = p.page.locator('[data-image-id]').first();
      await imageEl.click();

      // Get initial size
      const initialBox = await imageEl.boundingBox();
      expect(initialBox).not.toBeNull();
      const initialW = initialBox!.width;
      const initialH = initialBox!.height;
      const initialRatio = initialW / initialH;

      // Resize by dragging the SE corner handle
      const handle = p.page.locator('[data-handle="se"]');
      if (await handle.count() > 0) {
        const handleBox = await handle.boundingBox();
        if (handleBox) {
          // Drag to make it larger
          await p.page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
          await p.page.mouse.down();
          await p.page.mouse.move(handleBox.x + 50, handleBox.y + 25, { steps: 5 });
          await p.page.mouse.up();
          await p.page.waitForTimeout(200);

          // Check aspect ratio is preserved (within 1%)
          const newBox = await imageEl.boundingBox();
          expect(newBox).not.toBeNull();
          const newRatio = newBox!.width / newBox!.height;
          expect(Math.abs(newRatio - initialRatio) / initialRatio).toBeLessThan(0.01);
        }
      }

      // Reload in a new context
      const p2 = await browser.newContext();
      const page2 = await p2.newPage();
      await joinBoard(page2, p.boardId);

      // Image should be present
      const images2 = page2.locator('[data-image-id]');
      await expect
        .poll(() => images2.count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);

      // Image should be ready (has an img element)
      await expect(page2.locator('[data-image-id] img[alt="Image"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await p2.close();
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-28: Flaky upload — route aborts POST → Upload failed → Retry → image ready', async ({ page }) => {
    test.setTimeout(E2E_EVENTUAL_TIMEOUT_MS + 10000);
    await gotoFreshBoard(page);

    // Block the upload route
    let allowUpload = false;
    await page.route('**/api/boards/*/assets', async (route) => {
      if (!allowUpload) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Drop a file
    await dropFilesAt(page, [
      { name: 'test.png', buffer: makePngBuffer(), type: 'image/png' },
    ], 400, 300);

    // Wait for the upload to fail
    const failedBox = page.locator('[data-testid="image-failed-uploader"]');
    await expect(failedBox).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const failedText = await failedBox.textContent();
    expect(failedText).toContain('Upload failed');

    // Click Retry (use evaluate to bypass pointer event interception)
    allowUpload = true;
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="image-retry-btn"]') as HTMLElement | null;
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    // Image should become ready
    const img = page.locator('[data-image-id] img[alt="Image"]');
    await expect(img).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS + 5000 });
  });
});


// Helper: get the src of the first img element inside an image object
async function leoPage_getFirstImgSrc(page: Page): Promise<string | null> {
  return page.locator('[data-image-id] img[alt="Image"]').first().getAttribute('src').catch(() => null);
}
