import { expect, test } from '@playwright/test';
import {
  getCamera, gridInfo, GRID_WORLD, offGrid, originCentre, setCamera, settled, zoomLabel,
} from './helpers/board';
import { UNBOUNDED_PAN_TESTED_EXTENT as FAR, ZOOM_MAX } from '../../src/shared/config';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const TOL = 1;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await settled(page);
});

test('workflow 1: first visit navigation (TC-28, TC-23, TC-24)', async ({ page }) => {
  await expect(page.getByText(HINT)).toBeVisible();
  const before = await originCentre(page);
  const gridBefore = await gridInfo(page);
  expect(offGrid(before.x, gridBefore.dotX, gridBefore.spacing)).toBeLessThan(TOL);

  await page.mouse.move(before.x + 300, before.y + 200);
  await page.mouse.down();
  await page.mouse.move(before.x + 500, before.y + 300, { steps: 5 });
  await page.mouse.up();
  await settled(page);
  await expect(page.getByText(HINT)).toHaveCount(0);

  const after = await originCentre(page);
  expect(Math.abs(after.x - before.x - 200)).toBeLessThan(TOL);
  expect(Math.abs(after.y - before.y - 100)).toBeLessThan(TOL);
  const gridAfter = await gridInfo(page);
  expect(offGrid(after.x, gridAfter.dotX, gridAfter.spacing)).toBeLessThan(TOL);
  expect(offGrid(after.y, gridAfter.dotY, gridAfter.spacing)).toBeLessThan(TOL);

  // Ctrl+wheel over the origin dot keeps it under the pointer.
  await page.mouse.move(after.x, after.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await settled(page);
  expect((await getCamera(page)).zoom).toBeGreaterThan(1);
  const zoomed = await originCentre(page);
  expect(Math.abs(zoomed.x - after.x)).toBeLessThan(TOL);
  expect(Math.abs(zoomed.y - after.y)).toBeLessThan(TOL);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
});

test('workflow 2: limits and recovery (TC-25, TC-26)', async ({ page }) => {
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const labels: string[] = [];
  for (let i = 0; i < 20 && !(await zoomIn.isDisabled()); i++) {
    await zoomIn.click();
    labels.push((await zoomLabel(page).textContent()) ?? '');
    await settled(page);
  }
  await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
  await expect(zoomIn).toBeDisabled();

  await setCamera(page, { x: FAR, y: -FAR, zoom: ZOOM_MAX });
  await page.getByRole('button', { name: 'Reset view' }).click();
  await settled(page);
  await expect(zoomLabel(page)).toHaveText('100%');
  const c = await originCentre(page);
  const vp = page.viewportSize()!;
  expect(Math.abs(c.x - vp.width / 2)).toBeLessThan(TOL);
  expect(Math.abs(c.y - vp.height / 2)).toBeLessThan(TOL);
});

test('workflow 3: far travel (TC-27)', async ({ page }) => {
  await setCamera(page, { x: FAR, y: FAR, zoom: 1 });
  await settled(page);
  const g0 = await gridInfo(page);
  expect(g0.spacing).toBeCloseTo(GRID_WORLD, 6);
  const c0 = await getCamera(page);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  await settled(page);
  const c1 = await getCamera(page);
  expect(c0.x - c1.x).toBeCloseTo(200, 6);
  expect(c0.y - c1.y).toBeCloseTo(100, 6);
  const g1 = await gridInfo(page);
  expect(g1.spacing).toBeCloseTo(GRID_WORLD * c1.zoom, 6);
  expect(offGrid(g1.dotX, g0.dotX + 200, g1.spacing)).toBeLessThan(TOL);
});

test('TC-31 zoom gestures do not change page zoom', async ({ page }) => {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await page.mouse.move(500, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  await settled(page);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('plain wheel pans the board in the scroll direction', async ({ page }) => {
  const before = await originCentre(page);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(40, 100);
  await settled(page);
  const after = await originCentre(page);
  expect(Math.abs(after.y - (before.y - 100))).toBeLessThan(TOL);
  expect(Math.abs(after.x - (before.x - 40))).toBeLessThan(TOL);
});
