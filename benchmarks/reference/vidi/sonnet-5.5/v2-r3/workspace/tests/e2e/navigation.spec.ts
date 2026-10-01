import { expect, test, type Locator, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import { drag, gridState, originCentre, setCamera, zoomLabel } from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const mod = (v: number, d: number) => ((v % d) + d) % d;
const centre = { x: 640, y: 400 };

// Clicks a zoom button, waiting for the label to change after each click, until the label matches.
async function clickUntilLabel(page: Page, button: Locator, target: string) {
  for (let i = 0; i < 30; i++) {
    const current = await zoomLabel(page).textContent();
    if (current === target) return;
    await button.click();
    await expect(zoomLabel(page)).not.toHaveText(current ?? '');
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('first visit: hint, exact drag, pointer-anchored zoom', async ({ page }) => {
  // TC-28
  await expect(page.getByText(HINT)).toBeVisible();

  // TC-23: the origin marker starts centred and a drag moves it and the grid exactly.
  const before = await originCentre(page);
  expect(Math.abs(before.x - centre.x)).toBeLessThanOrEqual(1);
  const gridBefore = await gridState(page);
  await drag(page, { x: 300, y: 300 }, 200, 100);
  const after = await originCentre(page);
  expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  const gridAfter = await gridState(page);
  expect(Math.abs(mod(gridAfter.x - gridBefore.x - 200, gridAfter.size))).toBeLessThanOrEqual(1);
  expect(Math.abs(mod(gridAfter.y - gridBefore.y - 100, gridAfter.size))).toBeLessThanOrEqual(1);
  await expect(page.getByText(HINT)).toHaveCount(0);

  // TC-24: Ctrl+wheel keeps the point under the pointer fixed (origin marker as the tracked dot).
  const target = await originCentre(page);
  await page.mouse.move(target.x, target.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(zoomLabel(page)).not.toHaveText('100%');
  const zoomed = await originCentre(page);
  expect(Math.abs(zoomed.x - target.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(zoomed.y - target.y)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test('plain scroll pans in the scroll direction', async ({ page }) => {
  const before = await originCentre(page);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(30, 60);
  await expect.poll(async () => (await originCentre(page)).y).toBeCloseTo(before.y - 60, 0);
  expect((await originCentre(page)).x).toBeCloseTo(before.x - 30, 0);
});

test('limits and recovery', async ({ page }) => {
  // TC-25
  const plus = page.getByRole('button', { name: 'Zoom in' });
  await clickUntilLabel(page, plus, '400%');
  await expect(zoomLabel(page)).toHaveText('400%');
  await expect(plus).toBeDisabled();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(plus).toBeEnabled();
  await plus.click();

  // TC-26
  await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, -UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(zoomLabel(page)).toHaveText('100%');
  const o = await originCentre(page);
  expect(Math.abs(o.x - centre.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(o.y - centre.y)).toBeLessThanOrEqual(1);
});

test('minimum zoom disables the Zoom out button', async ({ page }) => {
  const minus = page.getByRole('button', { name: 'Zoom out' });
  await clickUntilLabel(page, minus, '10%');
  await expect(zoomLabel(page)).toHaveText('10%');
  await expect(minus).toBeDisabled();
});

test('far travel: pan stays exact and grid spacing even', async ({ page }) => {
  // TC-27
  await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
  await expect(page.getByText(HINT)).toHaveCount(0);
  const g1 = await gridState(page);
  expect(g1.size).toBeCloseTo(GRID_SPACING_WORLD, 6);
  await drag(page, { x: 300, y: 300 }, 200, 100);
  const g2 = await gridState(page);
  expect(g2.size).toBeCloseTo(GRID_SPACING_WORLD, 6);
  expect(Math.abs(mod(g2.x - g1.x - 200, g2.size))).toBeLessThanOrEqual(1e-3);
  expect(Math.abs(mod(g2.y - g1.y - 100, g2.size))).toBeLessThanOrEqual(1e-3);
});

test('page zoom is never changed by board gestures', async ({ page }) => {
  // TC-31
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await page.mouse.move(400, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
  await expect(zoomLabel(page)).toHaveText('100%');
});
