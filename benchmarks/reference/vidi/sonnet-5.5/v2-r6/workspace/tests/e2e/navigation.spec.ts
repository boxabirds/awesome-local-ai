import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import {
  foldedDelta, nextFrames, gridState, markerCentre, readZoomPercent, setCamera, viewportOf, zoomLabel,
} from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

async function drag(page: import('@playwright/test').Page, dx: number, dy: number) {
  const x = 400, y = 300;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
  await nextFrames(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(viewportOf(page)).toBeVisible();
});

test('workflow 1: first visit navigation (TC-28, TC-23, TC-24)', async ({ page }) => {
  // TC-28
  await expect(page.getByText(HINT)).toBeVisible();

  // TC-23
  const m0 = await markerCentre(page);
  const g0 = await gridState(page);
  await drag(page, 200, 100);
  await expect(page.getByText(HINT)).toHaveCount(0);
  const m1 = await markerCentre(page);
  const g1 = await gridState(page);
  expect(Math.abs(m1.x - m0.x - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(m1.y - m0.y - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(foldedDelta(g0.dotX, g1.dotX, g0.spacing) - foldedDelta(0, 200, g0.spacing))).toBeLessThanOrEqual(1);
  expect(Math.abs(foldedDelta(g0.dotY, g1.dotY, g0.spacing) - foldedDelta(0, 100, g0.spacing))).toBeLessThanOrEqual(1);

  // TC-24: hover over the origin marker (a world point), ctrl+wheel keeps it under the pointer.
  const target = await markerCentre(page);
  await page.mouse.move(target.x, target.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(() => readZoomPercent(page)).toBeGreaterThan(100);
  const after = await markerCentre(page);
  expect(Math.abs(after.x - target.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - target.y)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test('plain wheel pans the board in the scroll direction', async ({ page }) => {
  const m0 = await markerCentre(page);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await markerCentre(page)).y).toBeLessThan(m0.y);
});

test('workflow 2: limits and recovery (TC-25, TC-26)', async ({ page }) => {
  const plus = page.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 20 && (await plus.isEnabled()); i++) {
    await plus.click();
    await nextFrames(page);
  }
  await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
  await expect(plus).toBeDisabled();

  await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, -UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(zoomLabel(page)).toHaveText('100%');
  const c = await markerCentre(page);
  const vp = page.viewportSize()!;
  expect(Math.abs(c.x - vp.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.y - vp.height / 2)).toBeLessThanOrEqual(1);
});

test('workflow 3: far travel (TC-27)', async ({ page }) => {
  await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
  const g0 = await gridState(page);
  expect(g0.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
  await drag(page, 200, 100);
  const g1 = await gridState(page);
  expect(g1.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
  expect(Math.abs(foldedDelta(g0.dotX, g1.dotX, g0.spacing) - foldedDelta(0, 200, g0.spacing))).toBeLessThanOrEqual(1);
  expect(Math.abs(foldedDelta(g0.dotY, g1.dotY, g0.spacing) - foldedDelta(0, 100, g0.spacing))).toBeLessThanOrEqual(1);
});

test('TC-31: zoom gestures do not change page zoom', async ({ page }) => {
  const before = await page.evaluate(() => ({ s: window.visualViewport?.scale, d: window.devicePixelRatio }));
  await page.mouse.move(500, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  const after = await page.evaluate(() => ({ s: window.visualViewport?.scale, d: window.devicePixelRatio }));
  expect(after).toEqual(before);
  await expect(zoomLabel(page)).toHaveText('100%');
});
