/**
 * E2E for story 12: drop images onto the board (TC-25 to TC-28).
 *
 * Real browsers, real `wrangler dev` server (with a local R2 bucket), real
 * y-websocket sync. Functional waits use E2E_EVENTUAL_TIMEOUT_MS (story 3);
 * delivery times are logged (via expectEventually), never asserted.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { openParticipants, expectEventually, type Participant } from './helpers/participants';
import { dropFiles, toBase64 } from './helpers/drop-files';
import { pngBytes, pdfBytes, jpegBytes, gifBytes } from '../fixtures/images';

const IMG = '[data-testid="image-object"]';
const IMG_READY = '[data-testid="image-ready"]';
const IMG_UPLOADING = '[data-testid="image-uploading"]';
const TOAST = '[data-testid="toast-item"]';

async function closeAll(parts: Participant[]): Promise<void> {
  await Promise.all(parts.map((p) => p.close()));
}

/** Wait until `n` image objects exist on the page. */
async function expectImages(page: Page, n: number, label: string): Promise<void> {
  await expectEventually(async () => (await page.locator(IMG).count()) === n, label);
}

/** Wait until `n` images are fully loaded (ready). */
async function expectReady(page: Page, n: number, label: string): Promise<void> {
  await expectEventually(async () => (await page.locator(IMG_READY).count()) >= n, label);
}

test.describe('images e2e', () => {
  // TC-25: Leo drops 3 screenshots; Sam sees placeholders then all three.
  test('TC-25: moodboard with a colleague — 3 drops sync and serve', async ({ browser }) => {
    const parts = await openParticipants(browser, 2);
    const leo = parts[0].page;
    const sam = parts[1].page;

    const files = [0, 1, 2].map((i) => ({
      name: `shot${i}.png`,
      type: 'image/png',
      base64: toBase64(pngBytes(200, 150)),
    }));
    await dropFiles(leo, files, 300, 250);

    // Leo: 3 placeholders, then all three ready.
    await expectImages(leo, 3, 'Leo sees 3 image objects');
    await expectReady(leo, 3, 'Leo sees 3 ready images');

    // Sam: the same three, ending ready (drop-to-visible time is logged).
    await expectImages(sam, 3, 'Sam sees 3 image objects');
    await expectReady(sam, 3, 'Sam sees 3 ready images');

    // A served asset carries the immutable Cache-Control header.
    const src = (await leo.locator(IMG_READY).first().getAttribute('src')) ?? '';
    expect(src).toMatch(/^\/api\/assets\//);
    const res = await leo.request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('immutable');
    expect(res.headers()['content-security-policy']).toBe("default-src 'none'");

    await closeAll(parts);
  });

  // TC-26: mixed picker batch → one image added, type + size toasts.
  test('TC-26: picker batch keeps only the valid PNG, toasts the rest', async ({ browser }) => {
    const parts = await openParticipants(browser, 1);
    const page = parts[0].page;

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press('i'),
    ]);
    await chooser.setFiles([
      { name: 'good.png', mimeType: 'image/png', buffer: pngBytes(100, 80) },
      { name: 'not-pdf.png', mimeType: 'application/pdf', buffer: pdfBytes() },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: jpegBytes(11 * 1024 * 1024) },
    ]);

    // Exactly one image is added (the valid PNG).
    await expectImages(page, 1, 'one image added');
    await expectReady(page, 1, 'the image is ready');

    // Type and size toasts with the exact PRD wording.
    await expect(page.locator(TOAST, { hasText: 'Only PNG, JPEG, GIF and WebP images can be added.' })).toBeVisible();
    await expect(page.locator(TOAST, { hasText: 'Images must be 10 MB or smaller.' })).toBeVisible();

    await closeAll(parts);
  });

  // TC-27: resize by a corner (aspect preserved, min floor), then it survives reload.
  test('TC-27: aspect-locked resize and persistence after reload', async ({ browser }) => {
    const parts = await openParticipants(browser, 1);
    const page = parts[0].page;
    const boardId = parts[0].boardId;

    // A 200x150 PNG (4:3) dropped and loaded.
    await dropFiles(page, [{ name: 'a.png', type: 'image/png', base64: toBase64(pngBytes(200, 150)) }], 400, 300);
    await expectReady(page, 1, 'image is ready');

    const boxBefore = (await page.locator(IMG).first().boundingBox())!;
    const ratioBefore = boxBefore.width / boxBefore.height;

    // Select the image → corner handles appear; drag the SE corner.
    await page.mouse.click(boxBefore.x + boxBefore.width / 2, boxBefore.y + boxBefore.height / 2);
    const se = page.locator('[data-testid="resize-handle-se"]');
    await se.waitFor();
    const seBox = (await se.boundingBox())!;
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBox.x + seBox.width / 2 + 60, seBox.y + seBox.height / 2 + 45, { steps: 12 });
    await page.mouse.up();

    const boxAfter = (await page.locator(IMG).first().boundingBox())!;
    const ratioAfter = boxAfter.width / boxAfter.height;
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);

    // Drag far smaller than the min → stops at the IMAGE_MIN_SIZE_WORLD floor.
    const seBox2 = (await page.locator('[data-testid="resize-handle-se"]').boundingBox())!;
    await page.mouse.move(seBox2.x + seBox2.width / 2, seBox2.y + seBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBox2.x - 500, seBox2.y - 500, { steps: 12 });
    await page.mouse.up();
    const boxMin = (await page.locator(IMG).first().boundingBox())!;
    expect(boxMin.width).toBeGreaterThanOrEqual(15);

    // A fresh context on the same board still shows the image, ready.
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(`/b/${boardId}`);
    await p2.waitForFunction(
      () => (window as { __vidi6?: { connectionState: string } }).__vidi6?.connectionState === 'connected',
      { timeout: 15_000 },
    );
    await expectReady(p2, 1, 'image present after reload');
    await ctx.close();

    await closeAll(parts);
  });

  // TC-28: a flaky (aborted) upload fails with Retry; retrying succeeds.
  test('TC-28: flaky upload fails, then succeeds on retry', async ({ browser }) => {
    const parts = await openParticipants(browser, 2);
    const leo = parts[0].page;
    const sam = parts[1].page;

    // Abort the first assets upload; let later ones through.
    let failNext = true;
    await leo.route('**/api/boards/*/assets', async (route) => {
      if (failNext) {
        failNext = false;
        return route.abort();
      }
      await route.continue();
    });

    await dropFiles(leo, [{ name: 'a.png', type: 'image/png', base64: toBase64(pngBytes(120, 90)) }], 400, 300);
    await expectImages(leo, 1, 'placeholder appears');

    // The upload failed → "Upload failed" with a Retry button.
    await expectEventually(
      async () => (await leo.locator('[data-testid="image-retry"]').count()) === 1,
      'Leo sees the failed upload with Retry',
    );

    // Retry → the (now-allowed) upload succeeds → ready on both screens.
    await leo.locator('[data-testid="image-retry"]').click();
    await expectReady(leo, 1, 'Leo sees the image ready after retry');
    await expectReady(sam, 1, 'Sam sees the image ready after retry');

    await closeAll(parts);
  });
});
