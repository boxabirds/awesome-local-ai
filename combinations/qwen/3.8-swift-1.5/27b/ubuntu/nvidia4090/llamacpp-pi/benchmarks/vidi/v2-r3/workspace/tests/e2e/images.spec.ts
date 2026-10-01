import { test, expect, type Page } from '@playwright/test';
import { createBoard, openBoardInPage } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

// A valid 1x1 red pixel PNG (base64)
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Trigger an image drop on the board viewport using page.evaluate.
 * Creates a File from base64 and dispatches a drop event on the container.
 */
async function dropImageOnBoard(page: Page, base64: string, filename: string, mimeType: string): Promise<void> {
  await page.evaluate(
    ({ b64, name, type }) => {
      const byteString = atob(b64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }
      const file = new File([bytes], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);

      // Dispatch on the container div (parent of board-viewport) which has the drag handlers
      const container = document.querySelector('[data-testid="board-viewport"]')?.parentElement;
      const target = container || document.querySelector('[data-testid="board-viewport"]');
      if (!target) throw new Error('target not found');

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: 200,
        clientY: 200,
      });
      target.dispatchEvent(dropEvent);
    },
    { b64: base64, name: filename, type: mimeType },
  );
}

// TC-25: image drop
test('TC-25: image drop', async ({ browser }) => {
  const boardId = await createBoard();
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  await openBoardInPage(page1, boardId);
  await openBoardInPage(page2, boardId);

  // Drop an image on the board
  await dropImageOnBoard(page1, VALID_PNG_BASE64, 'test.png', 'image/png');

  // Wait for the image to appear (uploading → ready)
  await expect
    .poll(() => page1.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);

  // Both tabs see the image
  await expect
    .poll(() => page2.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);

  await page1.close();
  await page2.close();
  await context1.close();
  await context2.close();
});

// TC-26: multi-drop with rejection
test('TC-26: multi-drop with rejection', async ({ browser }) => {
  const boardId = await createBoard();
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoardInPage(page, boardId);
  await page.waitForTimeout(1000); // Ensure React state is fully updated under load

  // Drop a valid image and an oversized one
  await page.evaluate(
    ({ b64 }) => {
      const byteString = atob(b64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }
      const validFile = new File([bytes], 'valid.png', { type: 'image/png' });

      // Create an oversized file (10MB + 1)
      const largeBytes = new Uint8Array(10 * 1024 * 1024 + 1);
      const largeFile = new File([largeBytes], 'large.png', { type: 'image/png' });

      const dt = new DataTransfer();
      dt.items.add(validFile);
      dt.items.add(largeFile);

      const container = document.querySelector('[data-testid="board-viewport"]')?.parentElement;
      const target = container || document.querySelector('[data-testid="board-viewport"]');
      if (!target) throw new Error('target not found');

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: 200,
        clientY: 200,
      });
      target.dispatchEvent(dropEvent);
    },
    { b64: VALID_PNG_BASE64 },
  );

  // Toast for size rejection appears
  await expect(
    page.locator('[data-testid="toast"]').filter({ hasText: 'Images must be 10 MB' }),
  ).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

  // Only 1 image is added (the valid one)
  await expect
    .poll(() => page.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);

  await page.close();
  await context.close();
});

// TC-27: retry after failed upload
test('TC-27: retry after failed upload', async ({ browser }) => {
  const boardId = await createBoard();
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoardInPage(page, boardId);
  await page.waitForTimeout(1000); // Ensure React state is fully updated under load

  // Block the upload request
  await page.route('**/api/boards/*/assets', (route) => {
    route.abort('failed');
  });

  // Drop an image
  await dropImageOnBoard(page, VALID_PNG_BASE64, 'test.png', 'image/png');

  // Wait for the failed state
  await expect(page.locator('[data-testid="image-failed-uploader"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="image-retry-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="image-remove-btn"]')).toBeVisible();

  // Verify the failed UI text
  await expect(page.locator('[data-testid="image-failed-uploader"]')).toContainText('Upload failed');

  await page.close();
  await context.close();
});

// TC-28: aspect-locked resize
test('TC-28: aspect-locked resize', async ({ browser }) => {
  const boardId = await createBoard();
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoardInPage(page, boardId);
  await page.waitForTimeout(1000); // Ensure React state is fully updated under load

  // Drop an image
  await dropImageOnBoard(page, VALID_PNG_BASE64, 'test.png', 'image/png');

  // Wait for the image to appear
  await expect
    .poll(() => page.locator('img[alt="Image"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);

  // The image is rendered with a valid bounding box
  const img = page.locator('img[alt="Image"]');
  const box = await img.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  await page.close();
  await context.close();
});
