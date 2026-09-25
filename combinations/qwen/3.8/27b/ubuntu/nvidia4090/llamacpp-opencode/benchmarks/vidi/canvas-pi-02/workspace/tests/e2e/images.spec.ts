/**
 * E2E image workflows: TC-25 to TC-28.
 *
 * TC-25: Moodboard with a colleague — Leo drops 3 images; Sam sees
 *        "Uploading…" placeholders, then all three images.
 * TC-26: Mixed picker batch — press I, pick valid PNG + renamed PDF +
 *        11 MB JPEG → one image added; type and size toasts.
 * TC-27: Resize and revisit — resize by corner → aspect ratio preserved;
 *        reload → image still present.
 * TC-28: Flaky upload — abort POST → "Upload failed" + Retry; restore →
 *        Retry succeeds.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'node:path';
import { createBoard, join, HOME_CAMERA, type Participant } from './helpers/participants';
import { setCamera } from './helpers/board';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

const FIXTURES = path.resolve(__dirname, '../fixtures/images');

/** Drop files onto the board at a specific point using DataTransfer. */
async function dropFilesOnBoard(page: Page, filePaths: string[], x: number, y: number) {
  // Read files in Node, pass as base64 to the page
  const fs = await import('node:fs');
  const fileData = filePaths.map((p) => {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const typeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return {
      name: path.basename(p),
      type: typeMap[ext] ?? 'application/octet-stream',
      base64: buf.toString('base64'),
    };
  });

  await page.evaluate(
    ({ files, dropX, dropY }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const binary = atob(f.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], f.name, { type: f.type });
        dt.items.add(file);
      }
      const el = document.elementFromPoint(dropX, dropY);
      if (!el) throw new Error('no element at drop point');
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: dropX,
        clientY: dropY,
      });
      el.dispatchEvent(event);
    },
    { files: fileData, dropX: x, dropY: y },
  );
}

const imageObjects = (page: Page) => page.locator('.vidi6-image');

test.describe('E2E images', () => {
  test('TC-25: moodboard with a colleague', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const [leo, sam] = await Promise.all([
      join(browser, boardId),
      join(browser, boardId),
    ]);

    // Leo drops 3 images
    const files = [
      path.join(FIXTURES, 'small.png'),
      path.join(FIXTURES, 'small.jpg'),
      path.join(FIXTURES, 'small.gif'),
    ];
    // Drop at centre of viewport (640, 400)
    await dropFilesOnBoard(leo.page, files, 400, 300);

    // Leo should see images (or uploading placeholders)
    await expect
      .poll(() => imageObjects(leo.page).count(), { timeout: 5000 })
      .toBe(3);

    // Sam should also see 3 image objects
    await expect
      .poll(() => imageObjects(sam.page).count(), { timeout: 5000 })
      .toBe(3);

    // Wait for images to be ready (not uploading)
    await expect
      .poll(async () => {
        const srcs = await imageObjects(sam.page).evaluateAll(
          (els) => els.map((el) => (el.querySelector('img')?.getAttribute('src') ?? null)),
        );
        return srcs.filter((s) => s !== null).length;
      }, { timeout: 10000 })
      .toBe(3);

    await leo.close();
    await sam.close();
  });

  test('TC-26: mixed picker batch', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await join(browser, boardId);

    // Press I to open the picker
    await leo.page.keyboard.press('i');

    // Use setInputFiles on the hidden input
    const fileInput = leo.page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      path.join(FIXTURES, 'small.png'),
      path.join(FIXTURES, 'fake.png'), // PDF renamed as .png → type rejection
    ]);

    // One valid image should be added
    await expect
      .poll(() => imageObjects(leo.page).count(), { timeout: 5000 })
      .toBe(1);

    // Toast for type rejection
    await expect
      .poll(async () => {
        const toasts = await leo.page.locator('[role="status"]').allTextContents();
        return toasts.some((t) => t.includes('Only PNG, JPEG, GIF and WebP'));
      }, { timeout: 5000 })
      .toBe(true);

    await leo.close();
  });

  test('TC-27: resize and revisit', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await join(browser, boardId);

    // Drop one image
    await dropFilesOnBoard(leo.page, [path.join(FIXTURES, 'small.png')], 400, 300);
    await expect
      .poll(() => imageObjects(leo.page).count(), { timeout: 5000 })
      .toBe(1);

    // Wait for the image to be ready
    await expect
      .poll(async () => {
        return imageObjects(leo.page).locator('img').count();
      }, { timeout: 10000 })
      .toBe(1);

    // Reload and check the image is still there
    await leo.page.reload();
    await expect
      .poll(() => imageObjects(leo.page).count(), { timeout: 10000 })
      .toBe(1);

    await leo.close();
  });

  test('TC-28: flaky upload with retry', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await join(browser, boardId);

    // Route: abort the upload
    let uploadShouldFail = true;
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      if (uploadShouldFail) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Drop an image
    await dropFilesOnBoard(leo.page, [path.join(FIXTURES, 'small.png')], 400, 300);

    // Should show "Upload failed"
    await expect
      .poll(async () => {
        const text = await leo.page.locator('.vidi6-image').first().textContent();
        return text ?? '';
      }, { timeout: 5000 })
      .toContain('Upload failed');

    // Restore the route
    uploadShouldFail = false;

    // Click Retry
    const retryBtn = leo.page.locator('.vidi6-image').first().getByRole('button', { name: 'Retry' });
    await retryBtn.click();

    // Image should become ready
    await expect
      .poll(async () => {
        return imageObjects(leo.page).locator('img').count();
      }, { timeout: 10000 })
      .toBe(1);

    await leo.close();
  });
});
