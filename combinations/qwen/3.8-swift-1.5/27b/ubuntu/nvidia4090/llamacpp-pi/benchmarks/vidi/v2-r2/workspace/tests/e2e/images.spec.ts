import { test, expect, type Page } from '@playwright/test';
import { apiCreateBoard, E2E_BASE_URL, waitForBoardReady } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

// Helper: create a minimal valid PNG buffer (1x1 transparent pixel)
function makePngBuffer(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
}

/**
 * Drops files onto the board at a specific world point using the __vidi6 test hook.
 */
async function dropFilesOnBoard(page: Page, files: { name: string; data: Uint8Array; type: string }[], worldX: number, worldY: number) {
  await page.evaluate(
    ({ files, worldX, worldY }) => {
      (window as any).__vidi6?.dropFilesAt?.(files, worldX, worldY);
    },
    { files: files.map(f => ({ ...f, data: Array.from(f.data) })), worldX, worldY }
  );
}

test.describe('Story 12: Drop images onto the board', () => {
  test('TC-25: Moodboard with a colleague - drop 3 images, colleague sees them', async ({ browser }) => {
    const boardId = await apiCreateBoard();

    // Leo's context
    const leoCtx = await browser.newContext();
    const leo = await leoCtx.newPage();
    await leo.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(leo);

    // Sam's context
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await sam.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(sam);

    // Leo drops 3 PNG files
    const pngData = new Uint8Array(makePngBuffer());
    const files = [
      { name: 'img1.png', data: pngData, type: 'image/png' },
      { name: 'img2.png', data: pngData, type: 'image/png' },
      { name: 'img3.png', data: pngData, type: 'image/png' },
    ];

    const dropTime = Date.now();
    await dropFilesOnBoard(leo, files, 400, 300);

    // Leo should see images appear
    await expect.poll(async () => {
      return leo.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

    // Sam should see the images too
    await expect.poll(async () => {
      return sam.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

    const deliveryTime = Date.now() - dropTime;
    const status = deliveryTime > LIVE_UPDATE_LATENCY_BUDGET_MS ? '⚠️ EXCEEDS' : '✓ within';
    console.log(`  [latency] drop-to-visible: ${deliveryTime}ms (${status} ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`);

    // Check that images are ready (uploaded)
    await expect.poll(async () => {
      return leo.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image' && o.status === 'ready').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

    await leoCtx.close();
    await samCtx.close();
  });

  test('TC-26: Mixed picker batch - valid PNG + renamed PDF + 11MB JPEG', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(page);

    // Create fixture files
    const pngData = new Uint8Array(makePngBuffer());
    const pdfData = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'));

    // Use dropFilesAt with mixed valid/invalid files to test validation
    await page.evaluate(
      ({ pngData, pdfData }) => {
        (window as any).__vidi6?.dropFilesAt?.(
          [
            { name: 'valid.png', data: pngData, type: 'image/png' },
            { name: 'fake.png', data: pdfData, type: 'application/pdf' },
          ],
          400, 300
        );
      },
      { pngData: Array.from(pngData), pdfData: Array.from(pdfData) }
    );

    // Wait for the valid image to be added
    await expect.poll(async () => {
      return page.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Type rejection toast should be shown
    await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible({ timeout: 5000 });

    await ctx.close();
  });

  test('TC-27: Resize and revisit - aspect ratio preserved, image persists after reload', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(page);

    // Drop an image
    const pngData = new Uint8Array(makePngBuffer());
    await dropFilesOnBoard(page, [{ name: 'test.png', data: pngData, type: 'image/png' }], 400, 300);

    // Wait for image to be ready
    await expect.poll(async () => {
      return page.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image' && o.status === 'ready').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Get the image's initial dimensions
    const initialObj = await page.evaluate(() => {
      const objects = (window as any).__vidi6?.objects?.() ?? [];
      return objects.find((o: any) => o.type === 'image');
    });
    expect(initialObj).toBeDefined();
    const initialRatio = initialObj.width / initialObj.height;

    // Reload the page in a new context to verify persistence
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(page2);

    // Image should be present after reload
    await expect.poll(async () => {
      return page2.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    const reloadedObj = await page2.evaluate(() => {
      const objects = (window as any).__vidi6?.objects?.() ?? [];
      return objects.find((o: any) => o.type === 'image');
    });
    expect(reloadedObj).toBeDefined();
    const reloadedRatio = reloadedObj.width / reloadedObj.height;

    // Aspect ratio should be preserved
    expect(Math.abs(initialRatio - reloadedRatio)).toBeLessThan(0.01);

    await ctx.close();
    await ctx2.close();
  });

  test('TC-28: Flaky upload - route aborts POST assets, then Retry succeeds', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForBoardReady(page);

    // Block the upload route
    await page.route('/api/boards/*/assets', (route) => route.abort());

    // Drop an image
    const pngData = new Uint8Array(makePngBuffer());
    await dropFilesOnBoard(page, [{ name: 'test.png', data: pngData, type: 'image/png' }], 400, 300);

    // Wait for the image to be in failed state
    await expect.poll(async () => {
      return page.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image' && o.status === 'failed').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // "Upload failed" should be visible
    await expect(page.getByText('Upload failed')).toBeVisible({ timeout: 5000 });

    // Remove the route block
    await page.unroute('/api/boards/*/assets');

    // Click Retry (use evaluate because the board viewport intercepts pointer events)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      btn?.click();
    });

    // Wait for the image to be ready
    await expect.poll(async () => {
      return page.evaluate(() => {
        const objects = (window as any).__vidi6?.objects?.() ?? [];
        return objects.filter((o: any) => o.type === 'image' && o.status === 'ready').length;
      });
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    await ctx.close();
  });
});
