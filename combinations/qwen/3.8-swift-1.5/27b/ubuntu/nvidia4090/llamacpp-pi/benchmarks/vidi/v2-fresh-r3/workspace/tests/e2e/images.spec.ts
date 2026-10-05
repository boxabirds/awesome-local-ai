import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
import { openBoardPath, setCamera, waitForZoom } from './helpers/board';
import {
  dropFilesAt,
  pasteFiles,
  fixtureFile,
  fixturePath,
  getImageState,
  waitForConnected,
  type ImageState,
} from './helpers/images';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * Story 12 E2E: dropping images onto the board (TC-25 to TC-28).
 *
 * Real browser, real Worker (wrangler dev), real Miniflare R2. Fixture images
 * are real PNGs (tests/e2e/fixtures/images); disguised files exercise the
 * content-based refusal.
 */

async function openBoardIn(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ id: string; page: Page }> {
  const res = await request.post('/api/boards');
  if (res.status() !== 201) throw new Error(`board creation failed: ${res.status()}`);
  const { id } = (await res.json()) as { id: string };
  return { id, page: await openBoardPage(browser, id) };
}

async function openBoardPage(browser: Browser, id: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15_000 });
  await waitForConnected(page);
  await setCamera(page, 0, 0, 1);
  await waitForZoom(page, 1);
  return page;
}

async function addViaPicker(page: Page, files: string[]): Promise<void> {
  await page.keyboard.press('i');
  await page.setInputFiles('input[data-testid="image-file-input"]', files);
}

test.describe('story 12: drop images onto the board (e2e)', () => {
  test('TC-25: moodboard with a colleague — drops and pastes reach both clients', async ({ browser, request }) => {
    const sam = await openBoardIn(browser, request);
    const alex = await openBoardPage(browser, sam.id);

    // Sam drops three images at a point.
    const files = [
      fixtureFile('a.png', 'image/png'),
      fixtureFile('b.png', 'image/png'),
      fixtureFile('c.png', 'image/png'),
    ];
    const t0 = Date.now();
    await dropFilesAt(sam.page, files, 300, 250);

    // Sam: placeholders, then all three images.
    await expect(sam.page.locator('[data-image-id]')).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(sam.page.locator('[data-testid="image-ready"]')).toHaveCount(3, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Alex (other participant) sees the same three images.
    await expect(alex.locator('[data-image-id]')).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(alex.locator('[data-testid="image-ready"]')).toHaveCount(3, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Drop-to-visible time is reported against the budget (not asserted).
    const ms = Date.now() - t0;
    test.info().annotations.push({
      type: 'drop-to-visible',
      description: `${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
    });

    // The first image is anchored at the drop point (top-left).
    const [first] = (await getImageState(sam.page)).sort((a, b) => a.x - b.x);
    expect(first.x).toBe(300);
    expect(first.y).toBe(250);

    // Sam pastes a fourth image; it appears for both.
    await pasteFiles(sam.page, [fixtureFile('medium.png', 'image/png')]);
    await expect(sam.page.locator('[data-testid="image-ready"]')).toHaveCount(4, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(alex.locator('[data-testid="image-ready"]')).toHaveCount(4, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
  });

  test('TC-26: mixed picker batch — one image added, type and size toasts', async ({ page, request }) => {
    await openBoardPath(request, page);
    await waitForConnected(page);
    await setCamera(page, 0, 0, 1);
    await waitForZoom(page, 1);

    // Toasts auto-dismiss after a few seconds, so start observing them before
    // the batch is submitted.
    const typeToast = expect(
      page.getByTestId('toast').filter({ hasText: 'Only PNG, JPEG, GIF and WebP images can be added.' }),
    ).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const sizeToast = expect(
      page.getByTestId('toast').filter({ hasText: 'Images must be 10 MB or smaller.' }),
    ).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await addViaPicker(page, [fixturePath('small.png'), fixturePath('fake.png'), fixturePath('big.png')]);
    await typeToast;
    await sizeToast;

    // Exactly one image is added (the valid PNG).
    await expect(page.locator('[data-image-id]')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.locator('[data-testid="image-ready"]')).toHaveCount(1, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
  });

  test('TC-27: resize keeps the aspect ratio, clamps at the minimum, and survives a reload', async ({
    browser,
    request,
  }) => {
    const { id, page } = await openBoardIn(browser, request);

    // Add a 400×200 (2:1) image via the picker.
    await addViaPicker(page, [fixturePath('medium.png')]);
    await expect(page.locator('[data-testid="image-ready"]')).toHaveCount(1, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    const [img] = await getImageState(page);
    expect(img.naturalWidth).toBe(400);
    expect(img.naturalHeight).toBe(200);
    const ratio = img.width / img.height;

    const dragSe = async (dx: number, dy: number) => {
      const handle = (await page.locator('[data-testid="resize-handle-se"]').boundingBox())!;
      const cx = handle.x + handle.width / 2;
      const cy = handle.y + handle.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
      await page.mouse.up();
    };

    // Select the image and grow it from the SE corner.
    const box = (await page.locator(`[data-image-id="${img.id}"]`).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-testid="resize-handle-se"]')).toBeVisible();
    await dragSe(100, 50);

    const [resized] = await getImageState(page);
    expect(resized.width).toBeGreaterThan(img.width);
    // Aspect ratio preserved within ±1%.
    expect(Math.abs(resized.width / resized.height - ratio) / ratio).toBeLessThan(0.01);

    // Shrink far past the minimum: clamped, proportions kept.
    await dragSe(-5000, -5000);
    const [min] = await getImageState(page);
    expect(min.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(min.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(Math.abs(min.width / min.height - ratio) / ratio).toBeLessThan(0.01);

    // Revisit in a fresh context: the image is present at the resized size.
    const revisit = await browser.newPage();
    await revisit.goto(`/b/${id}`);
    await expect(revisit.getByTestId('board-viewport')).toBeVisible({ timeout: 15_000 });
    await expect(revisit.locator('[data-testid="image-ready"]')).toHaveCount(1, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    const [persisted] = (await getImageState(revisit)) as ImageState[];
    expect(persisted.width).toBeCloseTo(min.width, 0);
    expect(persisted.height).toBeCloseTo(min.height, 0);
  });

  test('TC-28: flaky upload — the image fails, then Retry restores it', async ({ page, request }) => {
    await openBoardPath(request, page);
    await waitForConnected(page);
    await setCamera(page, 0, 0, 1);
    await waitForZoom(page, 1);

    // Break the upload route, drop an image → it fails.
    await page.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFilesAt(page, [fixtureFile('small.png', 'image/png')], 300, 250);
    await expect(page.locator('[data-testid="image-failed"]')).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(page.getByText('Upload failed')).toBeVisible();

    // Restore the route and Retry → the image becomes ready.
    await page.unroute('**/api/boards/*/assets');
    await page.getByTestId('image-retry').click();
    await expect(page.locator('[data-testid="image-ready"]')).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
  });
});
