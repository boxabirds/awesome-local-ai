import { expect, test } from '@playwright/test';
import {
  devicePixelRatio,
  dragBoard,
  gotoBoard,
  gridSpacingPx,
  originCenter,
  pageScale,
  readZoomLabel,
  readZoomPercent,
  setCamera,
} from './helpers/board';

const VIEWPORT = { width: 1280, height: 800 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const GRID_SPACING_WORLD = 24;
const UNBOUNDED = 1_000_000;

/** Scroll with Ctrl held (browser page-zoom gesture) over a screen point. */
async function ctrlWheel(
  page: import('@playwright/test').Page,
  at: { x: number; y: number },
  deltaY: number,
): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 hint is visible on load and removed after the first drag', async ({ page }) => {
    await gotoBoard(page);
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(
      'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom',
    );

    await dragBoard(page, { x: 300, y: 250 }, 40, 40);
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);

    // Further navigation does not bring it back.
    await dragBoard(page, { x: 500, y: 300 }, -30, 20);
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
  });

  test('TC-23 dragging moves the board exactly with the pointer', async ({ page }) => {
    await gotoBoard(page);
    const before = await originCenter(page);
    await dragBoard(page, { x: 300, y: 250 }, 200, 100);
    const after = await originCenter(page);
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24 Ctrl+wheel keeps the point under the pointer fixed and does not zoom the page', async ({ page }) => {
    await gotoBoard(page);
    const startScale = await pageScale(page);
    // Zoom in around the origin marker's own screen position; it must stay put.
    const beforeOrigin = await originCenter(page);
    const startPct = await readZoomPercent(page);

    await ctrlWheel(page, { x: Math.round(beforeOrigin.x), y: Math.round(beforeOrigin.y) }, -240);

    await expect.poll(() => readZoomPercent(page)).toBeGreaterThan(startPct);
    const afterOrigin = await originCenter(page);
    expect(Math.abs(afterOrigin.x - beforeOrigin.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterOrigin.y - beforeOrigin.y)).toBeLessThanOrEqual(1);

    expect(await pageScale(page)).toBeCloseTo(startScale, 5);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 zooming in stops at 400% and disables the + button', async ({ page }) => {
    await gotoBoard(page);
    const zoomIn = page.getByLabel('Zoom in');
    const zoomOut = page.getByLabel('Zoom out');
    await expect(zoomOut).toBeEnabled();

    for (let i = 0; i < 25; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
    }
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();
    await expect(readZoomLabel(page)).resolves.toBe('400%');
  });

  test('TC-26 Reset view returns to 100% centred from far away at max zoom', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, UNBOUNDED, UNBOUNDED, 4);
    await expect.poll(() => readZoomPercent(page)).toBe(400);

    await page.getByLabel('Reset view').click();
    await expect(readZoomLabel(page)).resolves.toBe('100%');
    const after = await originCenter(page);
    expect(Math.abs(after.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - CENTER.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the grid stays crisp and panning is exact', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, UNBOUNDED, UNBOUNDED, 2);
    const spacing = await gridSpacingPx(page);
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * 2, 6);

    const before = await originCenter(page);
    await dragBoard(page, { x: 300, y: 250 }, 200, 100);
    const after = await originCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
    // Grid spacing unaffected by panning.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * 2, 6);
  });
});

test.describe('Page zoom is never triggered by board gestures', () => {
  test('TC-31 Ctrl+wheel and Ctrl + =/-/0 leave the page zoom unchanged', async ({ page }) => {
    await gotoBoard(page);
    const scale0 = await pageScale(page);
    const dpr0 = await devicePixelRatio(page);

    await ctrlWheel(page, CENTER, -240);
    await ctrlWheel(page, CENTER, 240);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    expect(await pageScale(page)).toBeCloseTo(scale0, 5);
    expect(await devicePixelRatio(page)).toBe(dpr0);
  });
});
