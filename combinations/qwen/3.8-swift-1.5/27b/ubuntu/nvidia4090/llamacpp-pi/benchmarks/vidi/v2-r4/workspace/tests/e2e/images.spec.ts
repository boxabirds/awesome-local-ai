import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setCamera, createBoard } from './helpers/board';

/**
 * Story 12 E2E: drop images onto the board (TC-25 to TC-28).
 *
 * Fixtures are served under /test-fixtures/images/ (see global-setup.ts).
 */

async function createEditorContext(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  // The board-viewport only renders once the connection is established (it
  // renders a placeholder while 'connecting' / 'load_failed').
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  return page;
}

/** Dispatches a real drop of the named fixture images at (x, y). */
async function dropImages(page: Page, names: string[], x: number, y: number): Promise<void> {
  await page.evaluate(async ({ names, x, y }) => {
    const mimeFor = (n: string) =>
      n.endsWith('.png') ? 'image/png'
      : n.endsWith('.gif') ? 'image/gif'
      : n.endsWith('.jpg') || n.endsWith('.jpeg') ? 'image/jpeg'
      : 'image/webp';
    const files = await Promise.all(
      names.map(async (n) => {
        const res = await fetch(`/test-fixtures/images/${n}`);
        const buf = await res.arrayBuffer();
        return new File([buf], n, { type: mimeFor(n) });
      }),
    );
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer: dt,
    });
    el.dispatchEvent(drop);
  }, { names, x, y });
}

async function imageRatio(page: Page): Promise<number> {
  const box = await page.locator('[data-testid="image-object"]').first().boundingBox();
  if (!box) throw new Error('image object not found');
  return box.width / box.height;
}

test.describe('Story 12: Drop images onto the board', () => {
  test('TC-25: drop 3 images → uploader and other participant see placeholders then all three images', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // Sam (A) drops three images.
    await dropImages(a, ['sample-320x200.png', 'screenshot-1440x900.png', 'animated.gif'], 300, 200);

    // Three placeholders appear for the uploader…
    await expect(a.locator('[data-testid="image-object"]')).toHaveCount(3, { timeout: 5000 });

    // …and all three become ready <img> elements for Sam.
    await expect(a.locator('img[alt="Image"]')).toHaveCount(3, { timeout: 20000 });

    // The other participant sees all three images too.
    await expect(b.locator('img[alt="Image"]')).toHaveCount(3, { timeout: 20000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-26: picker with valid + renamed PDF + 11 MB → one image added, type and size toasts', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const a = await createEditorContext(ctx, boardId);

    // Open the picker via the Image button, then feed it the mixed files.
    await a.getByLabel('Image (I)').click();
    const input = a.locator('[data-testid="image-file-input"]');
    const pngBuf = readFileSync('tests/fixtures/images/sample-320x200.png');
    const pdfBuf = readFileSync('tests/fixtures/images/pdf-renamed.png');
    const bigBuf = Buffer.alloc(11 * 1024 * 1024);
    await input.setInputFiles([
      { name: 'valid.png', mimeType: 'image/png', buffer: pngBuf },
      { name: 'doc.png', mimeType: 'image/png', buffer: pdfBuf }, // PDF renamed to .png
      { name: 'big.png', mimeType: 'image/png', buffer: bigBuf }, // 11 MB
    ]);

    // Exactly one image is added (the valid PNG).
    await expect(a.locator('[data-testid="image-object"]')).toHaveCount(1, { timeout: 5000 });

    // The type toast (shown after the decode failure of the renamed PDF) is visible.
    const toast = a.locator('[data-testid="toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('can be added', { timeout: 5000 });

    await ctx.close();
  });

  test('TC-27: resize preserves aspect ratio; the image persists after reload', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const a = await createEditorContext(ctx, boardId);

    // Add one image and let it become ready.
    await dropImages(a, ['sample-320x200.png'], 300, 200);
    await expect(a.locator('img[alt="Image"]')).toHaveCount(1, { timeout: 20000 });

    const ratioBefore = await imageRatio(a);

    // Select the image and drag its bottom-right (se) corner handle.
    const img = a.locator('[data-testid="image-object"]').first();
    await img.click();
    const handle = a.locator('[data-testid="handle-se"]');
    await handle.waitFor({ timeout: 5000 });
    const hb = await handle.boundingBox();
    if (hb) {
      await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await a.mouse.down();
      await a.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 + 50, { steps: 12 });
      await a.mouse.up();
    }
    await a.locator('[data-testid="selection-overlay"]').waitFor({ timeout: 5000 });

    // Aspect ratio preserved (±2% to absorb pointer rounding).
    const ratioAfter = await imageRatio(a);
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.02);

    // Reload in a fresh context → the image is present with the same ratio.
    const ctx2 = await browser.newContext();
    const c = await createEditorContext(ctx2, boardId);
    await expect(c.locator('img[alt="Image"]')).toHaveCount(1, { timeout: 20000 });
    const ratioReloaded = await imageRatio(c);
    expect(Math.abs(ratioReloaded - ratioAfter) / ratioAfter).toBeLessThan(0.02);

    await ctx.close();
    await ctx2.close();
  });

  test('TC-28: aborted upload shows "Upload failed"; Retry with the route restored makes the image ready', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const a = await createEditorContext(ctx, boardId);

    // Abort asset uploads until we lift the block.
    let abortUploads = true;
    await ctx.route('**/api/boards/*/assets', async (route) => {
      if (route.request().method() === 'POST' && abortUploads) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Drop an image → the upload is aborted → failed state.
    await dropImages(a, ['sample-320x200.png'], 300, 200);
    await expect(a.locator('[data-testid="image-failed"]')).toBeVisible({ timeout: 5000 });
    await expect(a.locator('text=Upload failed')).toBeVisible({ timeout: 5000 });

    // Restore the route and Retry → the image becomes ready.
    abortUploads = false;
    await a.locator('[data-testid="image-retry"]').click();
    await expect(a.locator('img[alt="Image"]')).toHaveCount(1, { timeout: 20000 });

    await ctx.close();
  });
});
