import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { nextFrames } from './helpers/board';
import { dropFiles, IMAGE_FIXTURES } from './helpers/drop-files';
import { openParticipants } from './helpers/participants';

const objects = (page: Page): Locator => page.locator('[data-image-object]');
const loaded = (page: Page): Locator => page.locator('[data-image-object] img[alt="Image"]');
const worldBox = (l: Locator) => l.evaluate((el) => {
  const s = (el as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
});
const eventually = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
const MIXED_FILES = ['screenshot.png', 'small.jpg', 'sample.webp'];

test.describe('Images', () => {
  test('TC-25 moodboard: three dropped screenshots show as Uploading… for a colleague, then as images', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, 2);
    // Hold the uploads so the colleague can be seen with placeholders.
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const samResponses: { url: string; cache: string | null }[] = [];
    sam.page.on('response', (res) => {
      if (res.url().includes('/api/assets/')) samResponses.push({ url: res.url(), cache: res.headers()['cache-control'] ?? null });
    });

    const sentAt = Date.now();
    await dropFiles(leo.page, MIXED_FILES, { x: 300, y: 200 });
    await expect(objects(leo.page)).toHaveCount(3);
    await expect(objects(sam.page)).toHaveCount(3, eventually);
    console.log(`[latency] placeholders for Sam: ${Date.now() - sentAt} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`);
    await expect(sam.page.getByText('Uploading…')).toHaveCount(3);
    await expect(leo.page.getByTestId('image-progress').first()).toBeVisible();

    // Placeholders have their final size and sit side by side from the drop point.
    const boxes = await Promise.all([0, 1, 2].map((i) => worldBox(objects(sam.page).nth(i))));
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    expect(sorted[0]).toMatchObject({ x: 300, y: 200 });
    expect(sorted[1].x - (sorted[0].x + sorted[0].w)).toBe(24);
    expect(sorted[0].w).toBe(800); // the 1440x900 screenshot is scaled to 800 wide

    await expect(loaded(leo.page)).toHaveCount(3, eventually);
    await expect(loaded(sam.page)).toHaveCount(3, eventually);
    console.log(`[latency] images visible for Sam: ${Date.now() - sentAt} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms + download)`);
    await expect.poll(() => samResponses.length, eventually).toBeGreaterThanOrEqual(3);
    expect(samResponses.every((r) => r.cache?.includes('immutable'))).toBe(true);
    expect(leo.errors).toEqual([]);
    await leo.context.close();
    await sam.context.close();
  });

  test('TC-26 mixed picker batch: only the valid image is added, with the refusal messages', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    const p = leo.page;
    await p.keyboard.press('i');
    const eleven = Buffer.alloc(IMAGE_MAX_BYTES + 1024 * 1024);
    readFileSync(`${IMAGE_FIXTURES}/small.jpg`).copy(eleven);
    await p.getByTestId('image-file-input').setInputFiles([
      { name: 'small.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${IMAGE_FIXTURES}/small.jpg`) },
      { name: 'not-really.png', mimeType: 'image/png', buffer: readFileSync(`${IMAGE_FIXTURES}/not-an-image.png`) },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: eleven },
    ]);
    await expect(p.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(p.getByText('Images must be 10 MB or smaller.')).toBeVisible();
    await expect(loaded(p)).toHaveCount(1, eventually);
    await expect(objects(p)).toHaveCount(1);
    // Centred in the visible area (camera at the origin, 1280x800 viewport).
    const box = await worldBox(objects(p).first());
    expect(Math.abs(box.x + box.w / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.h / 2 - 400)).toBeLessThanOrEqual(2);
    await leo.context.close();
  });

  test('TC-27 resize keeps the aspect ratio down to the minimum size, and the image survives a reload', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    const p = leo.page;
    await p.keyboard.press('i');
    await p.getByTestId('image-file-input').setInputFiles(`${IMAGE_FIXTURES}/small.jpg`);
    await expect(loaded(p)).toHaveCount(1, eventually);
    const image = objects(p).first();
    const start = await worldBox(image);
    const ratio = start.w / start.h;
    await image.click({ position: { x: 30, y: 30 } });
    const handle = p.getByRole('button', { name: 'Resize bottom-right' });
    const hb = (await handle.boundingBox())!;
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const drag = async (dx: number, dy: number) => {
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      await p.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
      await p.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
      await p.mouse.up();
      await nextFrames(p);
    };
    await drag(150, 10);
    const grown = await worldBox(image);
    expect(grown.w).toBeGreaterThan(start.w + 50);
    expect(Math.abs(grown.w / grown.h - ratio) / ratio).toBeLessThan(0.01);

    // Shrink far past the minimum: the shorter side stops at the floor.
    const hb2 = (await handle.boundingBox())!;
    const from2 = { x: hb2.x + hb2.width / 2, y: hb2.y + hb2.height / 2 };
    await p.mouse.move(from2.x, from2.y);
    await p.mouse.down();
    await p.mouse.move(from2.x - 200, from2.y - 200, { steps: 4 });
    await p.mouse.move(from2.x - 1000, from2.y - 1000, { steps: 4 });
    await p.mouse.up();
    await nextFrames(p);
    const tiny = await worldBox(image);
    expect(Math.min(tiny.w, tiny.h)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.01);
    expect(Math.min(tiny.w, tiny.h)).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 1);
    expect(Math.abs(tiny.w / tiny.h - ratio) / ratio).toBeLessThan(0.01);

    const url = p.url();
    const second = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await second.newPage();
    await page2.goto(url);
    await expect(objects(page2)).toHaveCount(1, eventually);
    await expect(loaded(page2)).toHaveCount(1, eventually);
    await expect.poll(() => loaded(page2).evaluate((el) => (el as HTMLImageElement).naturalWidth), eventually).toBe(300);
    await second.close();
    await leo.context.close();
  });

  test('TC-28 a failed upload offers Retry, and retrying with the network restored shows the image on both screens', async ({ browser }) => {
    const [leo, sam] = await openParticipants(browser, 2);
    await leo.page.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFiles(leo.page, ['small.jpg'], { x: 300, y: 200 });
    await expect(leo.page.getByText('Upload failed')).toBeVisible(eventually);
    await expect(sam.page.getByText('Image unavailable')).toBeVisible(eventually);
    await expect(sam.page.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    await leo.page.unroute('**/api/boards/*/assets');
    await leo.page.getByRole('button', { name: 'Retry' }).click();
    await expect(loaded(leo.page)).toHaveCount(1, eventually);
    await expect(loaded(sam.page)).toHaveCount(1, eventually);
    await leo.context.close();
    await sam.context.close();
  });

  test('a failed placeholder can be removed', async ({ browser }) => {
    const [leo] = await openParticipants(browser, 1);
    await leo.page.route('**/api/boards/*/assets', (route) => route.abort());
    await dropFiles(leo.page, ['small.jpg'], { x: 300, y: 200 });
    await leo.page.getByRole('button', { name: 'Remove' }).click();
    await expect(objects(leo.page)).toHaveCount(0);
    await leo.context.close();
  });
});
