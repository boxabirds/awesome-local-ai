import { test, expect } from '@playwright/test';
import {
  gotoBoard,
  getCamera,
  setCamera,
  markerCenter,
  waitForMarkerCenter,
  gridSpacingPx,
} from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

async function dragBy(page: import('@playwright/test').Page, dx: number, dy: number): Promise<void> {
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(500 + dx / 2, 400 + dy / 2, { steps: 4 });
  await page.mouse.move(500 + dx, 400 + dy, { steps: 4 });
  await page.mouse.up();
}

test('TC-28: first visit shows the navigation hint; dragging removes it', async ({ page }) => {
  await gotoBoard(page);
  await expect(page.getByTestId('navigation-hint')).toBeVisible();
  await expect(
    page.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'),
  ).toBeVisible();

  await dragBy(page, 120, 60);
  await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
});

test('TC-23: dragging 200x100 moves the origin marker exactly 200x100 px', async ({ page }) => {
  await gotoBoard(page);
  const start = await markerCenter(page);
  expect(start.x).toBeCloseTo(640, 0);
  expect(start.y).toBeCloseTo(400, 0);

  await dragBy(page, 200, 100);
  const moved = await waitForMarkerCenter(page, start.x + 200, start.y + 100, 1);
  expect(Math.abs(moved.x - (start.x + 200))).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y - (start.y + 100))).toBeLessThanOrEqual(1);
});

test('TC-24: ctrl+wheel keeps the point under the pointer fixed', async ({ page }) => {
  await gotoBoard(page);
  const pt = { x: 600, y: 300 };
  const before = await getCamera(page);
  const worldX = before.x + pt.x / before.zoom;
  const worldY = before.y + pt.y / before.zoom;

  await page.mouse.move(pt.x, pt.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');

  await expect.poll(() => getCamera(page).then((c) => c.zoom)).toBeGreaterThan(before.zoom);
  const after = await getCamera(page);
  const screenX = (worldX - after.x) * after.zoom;
  const screenY = (worldY - after.y) * after.zoom;
  expect(Math.abs(screenX - pt.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(screenY - pt.y)).toBeLessThanOrEqual(1);
});

test('TC-25: clicking + until disabled ends at 400%', async ({ page }) => {
  await gotoBoard(page);
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  // 1.25^6 < 4 <= 1.25^7, so seven clicks reach the clamp; the seventh is
  // dispatched while the button is still enabled (zoom 3.81).
  for (let i = 0; i < 7; i++) {
    await zoomIn.click();
  }
  await expect(page.getByTestId('zoom-label')).toHaveText('400%');
  await expect(zoomIn).toBeDisabled();
});

test('TC-26: Reset view from far away at max zoom returns to 100% centred', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: 4,
  });
  await expect.poll(() => getCamera(page).then((c) => c.zoom)).toBe(4);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByTestId('zoom-label')).toHaveText('100%');
  await waitForMarkerCenter(page, 640, 400, 1);
});

test('TC-27: panning at 1,000,000 units is exact and grid spacing holds', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT * 2, zoom: 1 });
  const before = await getCamera(page);
  expect(before.x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);

  await dragBy(page, 200, 100);
  await expect
    .poll(() => getCamera(page).then((c) => `${c.x},${c.y}`))
    .toBe(`${before.x - 200},${before.y - 100}`);

  const after = await getCamera(page);
  expect(after.x).toBeCloseTo(before.x - 200, 6);
  expect(after.y).toBeCloseTo(before.y - 100, 6);
  expect(after.zoom).toBe(1);
  await expect.poll(() => gridSpacingPx(page)).toBe(`${GRID_SPACING_WORLD}px`);
});

test('TC-31: ctrl+wheel over the board never changes page zoom', async ({ page }) => {
  await gotoBoard(page);
  const read = () =>
    page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      scale: window.visualViewport ? window.visualViewport.scale : 1,
    }));
  const before = await read();

  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Control');

  expect(await read()).toEqual(before);
});
