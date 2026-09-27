import { test, expect } from '@playwright/test';
import {
  gotoBoard,
  setCamera,
  originCenter,
  readGrid,
  expectedTile,
  mod,
  dispatchCtrlWheel,
  pageZoom,
} from './helpers/board.ts';
import { ZOOM_MAX, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config.ts';

async function dragBy(page: import('@playwright/test').Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(50);
}

// Workflow 1: first visit navigation
test('TC-28 shows the hint on load and hides it after the first drag', async ({ page }) => {
  await gotoBoard(page);
  await expect(page.getByTestId('nav-hint')).toBeVisible();
  await dragBy(page, { x: 400, y: 300 }, 50, 50);
  await expect(page.getByTestId('nav-hint')).toHaveCount(0);
});

test('TC-23 drags the board by exactly the pointer movement', async ({ page }) => {
  await gotoBoard(page);
  const before = await originCenter(page);
  const grid0 = await readGrid(page);

  await dragBy(page, { x: 400, y: 300 }, 200, 100);

  const after = await originCenter(page);
  expect(after.x).toBeCloseTo(before.x + 200, 0);
  expect(after.y).toBeCloseTo(before.y + 100, 0);
  expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);

  // the dot grid moves with the board (a grid dot moves by the same screen delta)
  const grid1 = await readGrid(page);
  expect(grid1.size).toBeCloseTo(grid0.size, 0);
  expect(grid1.posX).toBeCloseTo(mod(grid0.posX + 200, grid0.size), 0);
  expect(grid1.posY).toBeCloseTo(mod(grid0.posY + 100, grid0.size), 0);
});

test('TC-24 keeps the point under the pointer while zooming and does not page-zoom', async ({ page }) => {
  await gotoBoard(page);
  const point = await originCenter(page);

  const prevented = await dispatchCtrlWheel(page, point, -100);
  await page.waitForTimeout(50);

  const after = await originCenter(page);
  expect(Math.abs(after.x - point.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - point.y)).toBeLessThanOrEqual(1);

  expect(prevented).toBe(true);
  const pz = await pageZoom(page);
  expect(pz.scale).toBe(1);
});

// Workflow 2: limits and recovery
test('TC-25 zooms in until the button disables at 400%', async ({ page }) => {
  await gotoBoard(page);
  const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
  // Repeatedly zoom in until the coalesced update disables the button. Clicking
  // a disabled button is a no-op, so force-clicking is safe while polling.
  await expect
    .poll(
      async () => {
        await zoomIn.click({ force: true });
        return zoomIn.isDisabled();
      },
      { timeout: 15000, intervals: [80] },
    )
    .toBe(true);
  await expect(page.getByTestId('zoom-label')).toHaveText('400%');
});

test('TC-26 resets to 100% centred after travelling far away', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX,
  });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.waitForTimeout(50);

  await expect(page.getByTestId('zoom-label')).toHaveText('100%');
  const centre = await originCenter(page);
  const vp = page.viewportSize()!;
  expect(Math.abs(centre.x - vp.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - vp.height / 2)).toBeLessThanOrEqual(1);
});

// Workflow 3: far travel
test('TC-27 pans exactly and keeps even grid spacing far from the start', async ({ page }) => {
  await gotoBoard(page);
  const zoom = ZOOM_MAX;
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom,
  });

  const tile = expectedTile(zoom);
  const g0 = await readGrid(page);
  expect(g0.size).toBeCloseTo(tile, 0);

  await dragBy(page, { x: 400, y: 300 }, 200, 100);

  const g1 = await readGrid(page);
  expect(g1.size).toBeCloseTo(tile, 0);
  expect(Math.abs(g1.posX - mod(g0.posX + 200, tile))).toBeLessThanOrEqual(1);
  expect(Math.abs(g1.posY - mod(g0.posY + 100, tile))).toBeLessThanOrEqual(1);
});

// Negative: board gestures never change the browser page zoom.
test('TC-31 board zoom gestures leave page zoom and devicePixelRatio unchanged', async ({ page }) => {
  await gotoBoard(page);
  const before = await pageZoom(page);

  await dispatchCtrlWheel(page, { x: 600, y: 400 }, -100);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(80);

  const after = await pageZoom(page);
  expect(after.scale).toBe(before.scale);
  expect(after.dpr).toBe(before.dpr);
});
