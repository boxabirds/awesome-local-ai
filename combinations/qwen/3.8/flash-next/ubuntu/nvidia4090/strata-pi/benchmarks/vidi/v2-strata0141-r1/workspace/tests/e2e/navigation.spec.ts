import { expect, test } from '@playwright/test';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  VIEWPORT_CENTRE,
  ctrlWheel,
  dragBoard,
  getCamera,
  gridStyle,
  markerPoint,
  near,
  openBoard,
  setCamera,
  zoomLabel,
  zoomPercent,
} from './helpers/board';

const mod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/**
 * How far a measured screen coordinate is from the nearest grid dot.
 * `zoom` is derived from the rendered spacing, so this checks that the dot
 * pattern is anchored to world coordinates: a world coordinate that is a
 * multiple of GRID_SPACING_WORLD must land on a dot.
 */
function dotAlignmentError(
  screenCoord: number,
  worldCoord: number,
  offset: number,
  spacingPx: number,
): number {
  const zoom = spacingPx / GRID_SPACING_WORLD;
  const residue = mod(screenCoord - offset, spacingPx);
  const expected = mod(worldCoord * zoom + spacingPx / 2, spacingPx);
  return Math.abs(residue - expected);
}

/** Zoom percentages produced by repeated one-step zooms from 100%. */
function stepLabels(direction: 'in' | 'out'): number[] {
  const labels: number[] = [];
  let zoom = 1;
  for (let i = 0; i < 40; i += 1) {
    const next =
      direction === 'in'
        ? Math.min(ZOOM_MAX, zoom * ZOOM_STEP_FACTOR)
        : Math.max(ZOOM_MIN, zoom / ZOOM_STEP_FACTOR);
    if (next === zoom) {
      break;
    }
    zoom = next;
    labels.push(Math.round(zoom * 100));
  }
  return labels;
}

test.describe('story 1: pan and zoom', () => {
  test('workflow 1 - first visit navigation (TC-28, TC-23, TC-24)', async ({ page }) => {
    await openBoard(page);

    // TC-28: the first-use hint is shown.
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom');

    // TC-23: a 200 x 100 drag moves the board content by exactly that amount.
    const before = await markerPoint(page);
    await dragBoard(page, { x: 500, y: 300 }, 200, 100);
    const after = await markerPoint(page);
    expect(near(after.x - before.x, 200)).toBe(true);
    expect(near(after.y - before.y, 100)).toBe(true);

    // The dot grid is attached to the board: a dot sits on the board's starting
    // point both before and after the drag.
    const grid = await gridStyle(page);
    expect(dotAlignmentError(after.x, 0, grid.offsetX, grid.spacingPx)).toBeLessThanOrEqual(1);
    expect(dotAlignmentError(after.y, 0, grid.offsetY, grid.spacingPx)).toBeLessThanOrEqual(1);

    // The hint is gone for the rest of the visit.
    await expect(hint).toHaveCount(0);

    // TC-24: Ctrl + scroll (trackpad pinch) keeps the dot under the pointer.
    const scaleBefore = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    await ctrlWheel(page, after, -400);
    const zoomed = await markerPoint(page);
    expect(near(zoomed.x, after.x)).toBe(true);
    expect(near(zoomed.y, after.y)).toBe(true);
    expect(await zoomPercent(page)).toBeGreaterThan(100);

    const scaleAfter = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    expect(scaleAfter).toEqual(scaleBefore);
    expect(scaleAfter.scale).toBe(1);

    // Zooming back out keeps the same point fixed too.
    await ctrlWheel(page, zoomed, 400);
    const out = await markerPoint(page);
    expect(near(out.x, after.x)).toBe(true);
    expect(near(out.y, after.y)).toBe(true);
    await expect(hint).toHaveCount(0);
  });

  test('workflow 2 - limits and recovery (TC-25, TC-26)', async ({ page }) => {
    await openBoard(page);

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    expect(await zoomLabel(page)).toBe('100%');
    expect(await zoomIn.isEnabled()).toBe(true);
    expect(await zoomOut.isEnabled()).toBe(true);

    // TC-25: clicking + until it is disabled, label ends at 400%.
    const labels = stepLabels('in');
    for (const label of labels) {
      await zoomIn.click();
      await expect(page.getByTestId('zoom-percent')).toHaveText(`${label}%`);
    }
    expect(labels.at(-1)).toBe(Math.round(ZOOM_MAX * 100));
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();
    // Further zooming (keyboard this time) does nothing at the limit.
    await page.keyboard.press('Control+=');
    await expect(page.getByTestId('zoom-percent')).toHaveText('400%');

    // Minimum limit (back to a known view first).
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');
    for (const label of stepLabels('out')) {
      await zoomOut.click();
      await expect(page.getByTestId('zoom-percent')).toHaveText(`${label}%`);
    }
    expect(await zoomLabel(page)).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    await expect(zoomOut).toBeDisabled();
    await expect(zoomIn).toBeEnabled();

    // TC-26: far away at maximum zoom, Reset view returns to 100% centred.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - 300,
      y: -UNBOUNDED_PAN_TESTED_EXTENT - 200,
      zoom: 4,
    });
    expect(await zoomPercent(page)).toBe(400);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');
    const centre = await markerPoint(page);
    expect(near(centre.x, VIEWPORT_CENTRE.x)).toBe(true);
    expect(near(centre.y, VIEWPORT_CENTRE.y)).toBe(true);

    // Ctrl/Cmd + 0 resets as well.
    await ctrlWheel(page, { x: 200, y: 200 }, -300);
    await page.keyboard.press('Control+0');
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');
    const again = await markerPoint(page);
    expect(near(again.x, VIEWPORT_CENTRE.x)).toBe(true);
    expect(near(again.y, VIEWPORT_CENTRE.y)).toBe(true);
  });

  test('workflow 3 - far travel at 1,000,000 units (TC-27)', async ({ page }) => {
    await openBoard(page);

    // Camera 1,000,000 world units from the start, far anchor centred.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.x,
      y: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.y,
      zoom: 1,
    });

    const anchorBefore = await markerPoint(page, 'far-anchor');
    expect(near(anchorBefore.x, VIEWPORT_CENTRE.x)).toBe(true);
    expect(near(anchorBefore.y, VIEWPORT_CENTRE.y)).toBe(true);

    const grid = await gridStyle(page);
    expect(near(grid.spacingPx, GRID_SPACING_WORLD * 1)).toBe(true);

    await dragBoard(page, { x: 400, y: 300 }, 200, 100);
    const anchorAfter = await markerPoint(page, 'far-anchor');
    expect(near(anchorAfter.x - anchorBefore.x, 200)).toBe(true);
    expect(near(anchorAfter.y - anchorBefore.y, 100)).toBe(true);

    // The camera moved by exactly the pointer delta in world units.
    const camera = await getCamera(page);
    expect(Math.abs(camera.x - (UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.x - 200))).toBeLessThan(
      0.001,
    );
    expect(Math.abs(camera.y - (UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.y - 100))).toBeLessThan(
      0.001,
    );

    // Grid still evenly spaced with the same spacing, no distortion, and still
    // anchored to world coordinates 1,000,000 units away.
    const gridAfter = await gridStyle(page);
    expect(near(gridAfter.spacingPx, GRID_SPACING_WORLD * camera.zoom)).toBe(true);
    expect(
      dotAlignmentError(anchorAfter.x, UNBOUNDED_PAN_TESTED_EXTENT, gridAfter.offsetX, gridAfter.spacingPx),
    ).toBeLessThanOrEqual(1);
    expect(
      dotAlignmentError(anchorAfter.y, UNBOUNDED_PAN_TESTED_EXTENT, gridAfter.offsetY, gridAfter.spacingPx),
    ).toBeLessThanOrEqual(1);

    // And at maximum zoom far away, panning is still exact (1 px = 1/zoom world units).
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.x,
      y: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.y,
      zoom: 4,
    });
    const maxBefore = await markerPoint(page, 'far-anchor');
    await dragBoard(page, { x: 400, y: 300 }, 200, 100);
    const maxAfter = await markerPoint(page, 'far-anchor');
    expect(near(maxAfter.x - maxBefore.x, 200)).toBe(true);
    expect(near(maxAfter.y - maxBefore.y, 100)).toBe(true);
    const zoomedCamera = await getCamera(page);
    expect(Math.abs(zoomedCamera.zoom - 4)).toBeLessThan(1e-9);
    expect(
      Math.abs(
        zoomedCamera.x - (UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT_CENTRE.x - 200 / 4),
      ),
    ).toBeLessThan(0.001);
  });

  test('TC-31: board gestures never zoom the page', async ({ page }) => {
    await openBoard(page);

    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      bodyFont: getComputedStyle(document.body).fontSize,
      controlFont: getComputedStyle(
        document.querySelector('[data-testid="zoom-percent"]') as HTMLElement,
      ).fontSize,
      controlWidth: (document.querySelector('[data-testid="zoom-percent"]') as HTMLElement)
        .getBoundingClientRect().width,
    }));

    await ctrlWheel(page, { x: 640, y: 400 }, -500);
    await expect(page.getByTestId('zoom-percent')).toHaveText('400%');
    await page.keyboard.press('Control+=');
    await expect(page.getByTestId('zoom-percent')).toHaveText('400%');
    await page.keyboard.press('Control+-');
    await expect(page.getByTestId('zoom-percent')).toHaveText('320%');
    await page.keyboard.press('Control+0');
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');

    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      bodyFont: getComputedStyle(document.body).fontSize,
      controlFont: getComputedStyle(
        document.querySelector('[data-testid="zoom-percent"]') as HTMLElement,
      ).fontSize,
      controlWidth: (document.querySelector('[data-testid="zoom-percent"]') as HTMLElement)
        .getBoundingClientRect().width,
    }));

    expect(after).toEqual(before);
    expect(after.scale).toBe(1);

    // The board itself did zoom and reset through the same shortcuts.
    expect(await zoomLabel(page)).toBe('100%');
  });

  test('plain scroll pans the board and does not scroll the page', async ({ page }) => {
    await openBoard(page);
    const before = await markerPoint(page);
    const cameraBefore = await getCamera(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(80);

    const after = await markerPoint(page);
    // Scrolling down moves content up.
    expect(near(after.y - before.y, -200)).toBe(true);
    const cameraAfter = await getCamera(page);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y + 200 / cameraBefore.zoom))).toBeLessThan(0.001);
    expect(cameraAfter.x).toBe(cameraBefore.x);

    // Horizontal trackpad scroll pans too: scrolling right moves content left.
    await page.mouse.wheel(120, 0);
    await page.waitForTimeout(80);
    const sideways = await markerPoint(page);
    expect(near(sideways.x - after.x, -120)).toBe(true);

    // The page itself never scrolls.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
