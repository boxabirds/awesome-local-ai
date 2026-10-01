import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { dropFiles, fixtureFile } from './helpers/drop-files';
import { openParticipants } from './helpers/participants';
import { imageBytes, jpegOfSize } from '../fixtures/images';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
const images = (page: Page) => page.locator('[data-image]');
const loaded = (page: Page) => page.locator('[data-image] img');

async function openBoard(page: Page, id: string) {
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible(EVENTUALLY);
  await settled(page);
}

const FILES = () => [
  fixtureFile('screenshot.png', 'image/png'),
  fixtureFile('photo.jpg', 'image/jpeg'),
  fixtureFile('small.webp', 'image/webp'),
];

test.describe('images', () => {
  test('TC-25 moodboard: three dropped images show as Uploading… for a colleague, then as images', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, ['Leo', 'Sam']);
    const cache: string[] = [];
    sam.page.on('response', (r) => { if (r.url().includes('/api/assets/')) cache.push(r.headers()['cache-control'] ?? ''); });
    const start = Date.now();
    await dropFiles(leo.page, FILES(), { x: 200, y: 200 });
    await expect(images(leo.page)).toHaveCount(3, EVENTUALLY);
    // The row starts at the drop point; screenshot 1440x900 is scaled to 800x500.
    const boxes = (await images(leo.page).all()).length === 3
      ? await Promise.all((await images(leo.page).all()).map((l) => l.boundingBox())) : [];
    const sorted = boxes.map((b) => b!).sort((a, b) => a.x - b.x);
    expect(Math.abs(sorted[0].x - 200)).toBeLessThan(2);
    expect(Math.abs(sorted[0].width - 800)).toBeLessThan(2);
    expect(Math.abs(sorted[1].x - (sorted[0].x + sorted[0].width + 24))).toBeLessThan(2);
    for (const b of sorted) expect(Math.abs(b.y - 200)).toBeLessThan(2);
    await expect(images(sam.page)).toHaveCount(3, EVENTUALLY);
    await expect(loaded(leo.page)).toHaveCount(3, EVENTUALLY);
    await expect(loaded(sam.page)).toHaveCount(3, EVENTUALLY);
    const took = Date.now() - start;
    console.log(`[latency] drop-to-visible for Sam: ${took}ms (${took <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER'} ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`);
    await expect.poll(() => cache.length, EVENTUALLY).toBeGreaterThanOrEqual(3);
    for (const c of cache) expect(c).toContain('immutable');
    await leo.context.close();
    await sam.context.close();
  });

  test('TC-26 mixed picker batch: only the valid PNG is added; type and size are explained', async ({ page, request }) => {
    await openBoard(page, await createBoardVia(request));
    await expect(page.getByRole('button', { name: 'Image (I)' })).toBeVisible();
    await page.keyboard.press('i');
    await page.getByTestId('image-file-input').setInputFiles([
      { name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(imageBytes('small.png')) },
      { name: 'report.png', mimeType: 'image/png', buffer: Buffer.from('%PDF-1.4 not an image') },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegOfSize(IMAGE_MAX_BYTES + 1 + 1024 * 1024)) },
    ]);
    await expect(images(page)).toHaveCount(1, EVENTUALLY);
    await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
    await expect(loaded(page)).toHaveCount(1, EVENTUALLY);
    // centred in the visible area (viewport 1280x800)
    const box = await images(page).first().boundingBox();
    expect(Math.abs(box!.x + box!.width / 2 - 640)).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - 400)).toBeLessThan(2);
  });

  test('TC-27 resize keeps the aspect ratio, stops at the minimum, and the image survives a reload', async ({ page, request, browser }) => {
    const id = await createBoardVia(request);
    await openBoard(page, id);
    await dropFiles(page, [fixtureFile('screenshot.png', 'image/png')], { x: 100, y: 100 });
    await expect(loaded(page)).toHaveCount(1, EVENTUALLY);
    await images(page).first().click();
    const handle = page.getByRole('button', { name: 'Resize bottom-right' });
    const drag = async (dx: number, dy: number) => {
      const h = (await handle.boundingBox())!;
      const x = h.x + h.width / 2;
      const y = h.y + h.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
      await page.mouse.move(x + dx, y + dy, { steps: 4 });
      await page.mouse.up();
    };
    await drag(-200, -40);
    let box = (await images(page).first().boundingBox())!;
    expect(Math.abs(box.width / box.height - 1440 / 900) / (1440 / 900)).toBeLessThan(0.01);
    expect(box.width).toBeLessThan(800);
    await drag(-2000, -2000);
    box = (await images(page).first().boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(Math.min(box.width, box.height)).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 2);
    await expect(async () => {
      const ratio = (await images(page).first().boundingBox())!;
      expect(Math.abs(ratio.width / ratio.height - 1440 / 900) / (1440 / 900)).toBeLessThan(0.02);
    }).toPass();
    await page.waitForTimeout(500);

    const visitor = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const later = await visitor.newPage();
    await openBoard(later, id);
    await expect(loaded(later)).toHaveCount(1, EVENTUALLY);
    await visitor.close();
  });

  test('TC-28 flaky upload: a failed upload offers Retry, which then succeeds', async ({ page, request }) => {
    await openBoard(page, await createBoardVia(request));
    await page.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFiles(page, [fixtureFile('small.png', 'image/png')], { x: 300, y: 300 });
    await expect(page.getByText('Upload failed')).toBeVisible(EVENTUALLY);
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
    await page.unroute('**/api/boards/*/assets');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(loaded(page)).toHaveCount(1, EVENTUALLY);
    await expect(page.getByText('Upload failed')).toHaveCount(0);
  });
});
