import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_ZOOM_SENSITIVITY
} from '../../src/shared/config';
import {
  dragBy,
  gridBackgroundStyle,
  markerCenter,
  originMarker,
  pageScale,
  parsePxPair,
  resetViewButton,
  setCamera,
  waitForMarkerAt,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  openBoard
} from './helpers/board';

const CENTRE = { x: 640, y: 400 }; // 1280x800 viewport, set in playwright.config
const PIXEL_TOLERANCE = 1;

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 navigation hint shows on load and disappears after the first drag', async ({
    page
  }) => {
    await openBoard(page);
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    await dragBy(page, { x: 400, y: 250 }, 200, 100);
    await expect(hint).toHaveCount(0);

    // Further navigation never brings the hint back during the visit.
    await page.mouse.move(400, 250);
    await page.mouse.wheel(0, 120);
    await expect(hint).toHaveCount(0);
  });

  test('TC-23 dragging 200x100 moves the origin marker exactly 200x100 pixels', async ({
    page
  }) => {
    await openBoard(page);
    const before = await markerCenter(page);
    await dragBy(page, { x: 400, y: 250 }, 200, 100);
    const after = await markerCenter(page);
    expectWithin(after.x - before.x, 200, PIXEL_TOLERANCE);
    expectWithin(after.y - before.y, 100, PIXEL_TOLERANCE);
  });

  test('TC-24 Ctrl+wheel zooms around the pointer without zooming the page', async ({ page }) => {
    await openBoard(page);
    const pointer = await markerCenter(page);
    const scaleBefore = await pageScale(page);

    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    const expectedZoom = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    await expect(zoomLabel(page)).toHaveText(`${Math.round(expectedZoom * 100)}%`);
    await waitForMarkerAt(page, pointer, PIXEL_TOLERANCE);
    expectWithin(await pageScale(page), scaleBefore, 0);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 clicking + until disabled ends at 400% with + disabled', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    await expect(zoomOutButton(page)).toBeEnabled();

    for (let i = 0; i < 25; i += 1) {
      const button = zoomInButton(page);
      if (await button.isDisabled()) break;
      try {
        await button.click({ timeout: 1000 });
      } catch {
        await expect(button).toBeDisabled();
        break;
      }
    }
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();
  });

  test('TC-26 Reset view returns to 100% centred from far away at ZOOM_MAX', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4
    });
    await expect(zoomLabel(page)).toHaveText('400%');
    // The marker is off-screen this far away; it must come back on reset.
    await resetViewButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await waitForMarkerAt(page, CENTRE, PIXEL_TOLERANCE);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the grid keeps its spacing and panning is exact', async ({
    page
  }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: 0, zoom: 1 });

    const before = await gridBackgroundStyle(page);
    expect(before.size).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    await dragBy(page, { x: 500, y: 300 }, 200, 100);

    const after = await gridBackgroundStyle(page);
    expect(after.size).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
    const [beforeX, beforeY] = parsePxPair(before.position);
    const [afterX, afterY] = parsePxPair(after.position);
    expectWithin(
      mod(afterX - beforeX, GRID_SPACING_WORLD),
      mod(200, GRID_SPACING_WORLD),
      PIXEL_TOLERANCE
    );
    expectWithin(
      mod(afterY - beforeY, GRID_SPACING_WORLD),
      mod(100, GRID_SPACING_WORLD),
      PIXEL_TOLERANCE
    );
  });
});

test('TC-31 board zoom gestures never change browser page zoom', async ({ page }) => {
  await openBoard(page);
  const scaleBefore = await pageScale(page);
  const dprBefore = await page.evaluate(() => window.devicePixelRatio);
  const controlsBox = await page.getByTestId('zoom-controls').boundingBox();
  if (controlsBox === null) throw new Error('zoom controls not visible');

  await page.mouse.move(500, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await expect(zoomLabel(page)).not.toHaveText('100%');

  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  await expect(zoomLabel(page)).toHaveText('100%');

  expectWithin(await pageScale(page), scaleBefore, 0);
  expectWithin(await page.evaluate(() => window.devicePixelRatio), dprBefore, 0);
  const controlsAfter = await page.getByTestId('zoom-controls').boundingBox();
  if (controlsAfter === null) throw new Error('zoom controls not visible');
  expectWithin(controlsAfter.height, controlsBox.height, PIXEL_TOLERANCE);
});

test('origin marker exists in the board (all builds)', async ({ page }) => {
  await openBoard(page);
  await expect(originMarker(page)).toBeVisible();
});
