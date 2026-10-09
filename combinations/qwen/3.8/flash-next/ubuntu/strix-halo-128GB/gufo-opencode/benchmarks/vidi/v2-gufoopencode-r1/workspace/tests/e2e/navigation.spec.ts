import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import {
  dragBoard,
  gridComputedStyles,
  markerCenter,
  openFreshBoard,
  parsePxPairs,
  readCamera,
  setCamera,
  settle,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  zoomLabel
} from './helpers/board';

const CENTER = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };

async function visualViewportScale(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 hint shows on load and is gone after the first drag', async ({ page }) => {
    await openFreshBoard(page);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
    await dragBoard(page, { x: 900, y: 600 }, 40, 20);
    await settle(page);
    await expect(page.getByTestId('navigation-hint')).toBeHidden();
    await dragBoard(page, { x: 900, y: 600 }, -40, -20);
    await expect(page.getByTestId('navigation-hint')).toBeHidden();
  });

  test('TC-23 dragging 200x100 moves the origin marker exactly 200x100 px', async ({ page }) => {
    await openFreshBoard(page);
    const before = await markerCenter(page);
    expect(Math.abs(before.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.y - CENTER.y)).toBeLessThanOrEqual(1);
    await dragBoard(page, { x: 400, y: 300 }, 200, 100);
    await settle(page);
    const after = await markerCenter(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);
  });

  test('TC-24 Ctrl+wheel zooms around the pointer without page zoom', async ({ page }) => {
    await openFreshBoard(page);
    const before = await markerCenter(page);
    await page.keyboard.down('Control');
    await page.mouse.move(before.x, before.y);
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await settle(page);
    const after = await markerCenter(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    const camera = await readCamera(page);
    expect(camera.zoom).toBeGreaterThan(1);
    expect(await visualViewportScale(page)).toBe(1);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 zooming in with + stops at 400% and disables the button', async ({ page }) => {
    await openFreshBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await settle(page);
    }
    await expect(zoomIn).toBeDisabled();
    expect(await zoomLabel(page)).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    expect(await zoomOut.isDisabled()).toBe(false);
    await zoomOut.click();
    await expect.poll(() => zoomLabel(page)).not.toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  test('TC-26 Reset view from far away at 400% returns to 100% centred on the start', async ({ page }) => {
    await openFreshBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    expect(await zoomLabel(page)).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await settle(page);
    await expect.poll(() => zoomLabel(page)).toBe('100%');
    const center = await markerCenter(page);
    expect(Math.abs(center.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - CENTER.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the grid is evenly spaced and drags are exact', async ({ page }) => {
    await openFreshBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    const styles = await gridComputedStyles(page);
    const sizes = parsePxPairs(styles.backgroundSize);
    expect(Math.abs(sizes[0].x - GRID_SPACING_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(sizes[0].y - GRID_SPACING_WORLD)).toBeLessThanOrEqual(1);
    const posBefore = parsePxPairs(styles.backgroundPosition)[0];
    await dragBoard(page, { x: 500, y: 500 }, 200, 100);
    await settle(page);
    const after = await gridComputedStyles(page);
    const posAfter = parsePxPairs(after.backgroundPosition)[0];
    const spacing = GRID_SPACING_WORLD;
    const mod = (v: number): number => ((v % spacing) + spacing) % spacing;
    expect(Math.abs(mod(posAfter.x - posBefore.x) - (200 % spacing))).toBeLessThanOrEqual(1);
    expect(Math.abs(mod(posAfter.y - posBefore.y) - (100 % spacing))).toBeLessThanOrEqual(1);
    const camera = await readCamera(page);
    expect(Math.abs(camera.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200))).toBeLessThan(1e-6);
    expect(Math.abs(camera.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100))).toBeLessThan(1e-6);
  });
});

test('TC-31 board zoom gestures never change the browser page zoom', async ({ page }) => {
  await openFreshBoard(page);
  const dprBefore = page.evaluate(() => window.devicePixelRatio);
  expect(await visualViewportScale(page)).toBe(1);
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  expect(await visualViewportScale(page)).toBe(1);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(await dprBefore);
});

test('zoom-out limit disables the minus button at 10%', async ({ page }) => {
  await openFreshBoard(page);
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  const minLabel = `${Math.round(ZOOM_MIN * 100)}%`;
  for (let i = 0; i < 40 && (await zoomLabel(page)) !== minLabel; i++) {
    await zoomOut.click();
    await settle(page);
  }
  await expect(zoomOut).toBeDisabled();
  expect(await zoomLabel(page)).toBe(minLabel);
});
