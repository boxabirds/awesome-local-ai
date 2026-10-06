import { expect, test } from '@playwright/test';
import {
  cameraSettled,
  drag,
  getCamera,
  gridPositionPx,
  gridSpacingPx,
  originOnScreen,
  pageScale,
  setCamera,
  zoomLabel,
} from './helpers/board';
import { navigateToNewBoard } from './helpers/navigate';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const VIEWPORT = { width: 1280, height: 800 };
const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.describe('first visit navigation', () => {
  test('TC-28 -> TC-23 -> TC-24: hint, drag, zoom under the pointer', async ({ page }) => {
    await navigateToNewBoard(page);

    // TC-28: the hint is shown on first visit, near the bottom centre
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toHaveText(HINT_TEXT);
    const hintBox = await hint.boundingBox();
    if (!hintBox) throw new Error('hint has no bounding box');
    expect(Math.abs(hintBox.x + hintBox.width / 2 - CENTRE.x)).toBeLessThanOrEqual(2);
    expect(hintBox.y + hintBox.height / 2).toBeGreaterThan(CENTRE.y);

    // the board opens on resetCamera(1280x800): world (0,0) in the middle
    expect(await getCamera(page)).toEqual({ x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
    const originBefore = await originOnScreen(page);
    expect(Math.abs(originBefore.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(originBefore.y - CENTRE.y)).toBeLessThanOrEqual(1);

    // TC-23: dragging moves the board content by exactly the pointer delta
    const before = await getCamera(page);
    await drag(page, { x: 500, y: 350 }, { x: 700, y: 450 });
    await expect
      .poll(() => getCamera(page), { message: 'drag should pan by (-200,-100)/zoom' })
      .toEqual({ x: before.x - 200, y: before.y - 100, zoom: 1 });
    const afterDrag = await originOnScreen(page);
    expect(Math.abs(afterDrag.x - (originBefore.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(afterDrag.y - (originBefore.y + 100))).toBeLessThanOrEqual(1);

    // TC-28: the hint disappeared with the first navigation and does not come back
    await expect(hint).toHaveCount(0);

    // TC-24 / TC-31: Ctrl + wheel zooms around the pointer without touching page zoom
    const scaleBefore = await pageScale(page);
    const pointerPoint = await originOnScreen(page);
    await page.mouse.move(pointerPoint.x, pointerPoint.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomLabel(page)).not.toBe('100%');

    const zoomed = await cameraSettled(page);
    expect(zoomed.zoom).toBeGreaterThan(1);
    expect(zoomed.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    const originAfterZoom = await originOnScreen(page);
    expect(Math.abs(originAfterZoom.x - pointerPoint.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(originAfterZoom.y - pointerPoint.y)).toBeLessThanOrEqual(1);

    // no browser page zoom happened
    expect(await pageScale(page)).toEqual(scaleBefore);
    expect((await pageScale(page)).scale).toBe(1);

    // the hint stays hidden for the rest of the visit
    await expect(hint).toHaveCount(0);
  });

  test('TC-31 a plain wheel scrolls the board and never zooms the page', async ({ page }) => {
    await navigateToNewBoard(page);
    const scaleBefore = await pageScale(page);
    const before = await getCamera(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => getCamera(page), { message: 'wheel should scroll the board' })
      .toEqual({ x: before.x, y: before.y + 100 / before.zoom, zoom: before.zoom });

    expect(await pageScale(page)).toEqual(scaleBefore);
    expect(await zoomLabel(page)).toBe('100%');
  });

  test('keyboard shortcuts zoom and reset without zooming the page', async ({ page }) => {
    await navigateToNewBoard(page);
    const scaleBefore = await pageScale(page);
    const centreWorldBefore = screenToWorld(await getCamera(page), CENTRE);

    await page.keyboard.press('Control+=');
    await expect.poll(() => zoomLabel(page)).toBe('125%');
    await page.keyboard.press('Control+-');
    await expect.poll(() => zoomLabel(page)).toBe('100%');

    // zooming around the centre of the board area keeps that spot fixed
    const afterSteps = await getCamera(page);
    expect(afterSteps.zoom).toBe(1);
    expect(screenToWorld(afterSteps, CENTRE).x).toBeCloseTo(centreWorldBefore.x, 6);
    expect(screenToWorld(afterSteps, CENTRE).y).toBeCloseTo(centreWorldBefore.y, 6);

    // pan far away, then Ctrl/Cmd+0 brings the starting point back to the middle
    await setCamera(page, { x: -3000, y: 2000, zoom: 2 });
    await page.keyboard.press('Control+0');
    await expect.poll(() => zoomLabel(page)).toBe('100%');
    expect(await getCamera(page)).toEqual({ x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
    const origin = await originOnScreen(page);
    expect(Math.abs(origin.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - CENTRE.y)).toBeLessThanOrEqual(1);

    expect(await pageScale(page)).toEqual(scaleBefore);
  });

  test('the dot grid scales and stays evenly spaced while navigating', async ({ page }) => {
    await navigateToNewBoard(page);
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD, 2);

    // panning by exactly one grid cell leaves the grid pattern where it was
    const phase0 = await gridPositionPx(page);
    const camera0 = await getCamera(page);
    await drag(page, { x: 400, y: 300 }, { x: 400 + GRID_SPACING_WORLD, y: 300 });
    await expect.poll(() => getCamera(page)).toEqual({
      x: camera0.x - GRID_SPACING_WORLD,
      y: camera0.y,
      zoom: 1,
    });
    const phase1 = await gridPositionPx(page);
    expect(Math.abs(phase1.x - phase0.x)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(phase1.y - phase0.y)).toBeLessThanOrEqual(0.01);

    // and the spacing grows with the zoom
    await page.keyboard.press('Control+=');
    await expect.poll(() => zoomLabel(page)).toBe('125%');
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_STEP_FACTOR, 2);
  });
});

test.describe('limits and recovery', () => {
  test('TC-25 stepping in with + reaches 400% and disables the button', async ({ page }) => {
    await navigateToNewBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const label = page.getByTestId('zoom-percent');
    await expect(label).toHaveText('100%');

    const sequence = ['125%', '156%', '195%', '244%', '305%', '381%', '400%'];
    for (const want of sequence) {
      await zoomIn.click();
      await expect(label).toHaveText(want);
    }
    await expect(zoomIn).toBeDisabled();
    expect((await getCamera(page)).zoom).toBe(ZOOM_MAX);

    // clicking a disabled button does nothing
    await zoomIn.click({ force: true });
    expect((await getCamera(page)).zoom).toBe(ZOOM_MAX);

    // zooming back out re-enables it, and steps are exact in both directions
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(label).toHaveText(`${Math.round((ZOOM_MAX / ZOOM_STEP_FACTOR) * 100)}%`);
    await expect(zoomIn).toBeEnabled();
  });

  test('TC-25b stepping out reaches 10% and the board centre stays fixed', async ({ page }) => {
    await navigateToNewBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    const label = page.getByTestId('zoom-percent');
    const centreWorld = screenToWorld(await getCamera(page), CENTRE);

    const sequence = [
      '80%',
      '64%',
      '51%',
      '41%',
      '33%',
      '26%',
      '21%',
      '17%',
      '13%',
      '11%',
      '10%',
    ];
    for (const want of sequence) {
      await zoomOut.click();
      await expect(label).toHaveText(want);
    }
    await expect(zoomOut).toBeDisabled();
    const atMin = await getCamera(page);
    expect(atMin.zoom).toBe(ZOOM_MIN);

    // every step zoomed around the centre of the board area
    expect(screenToWorld(atMin, CENTRE).x).toBeCloseTo(centreWorld.x, 6);
    expect(screenToWorld(atMin, CENTRE).y).toBeCloseTo(centreWorld.y, 6);
  });

  test('TC-26 Reset view returns to 100% with the starting point centred', async ({ page }) => {
    await navigateToNewBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(page.getByTestId('zoom-percent')).toHaveText('400%');

    await page.getByTestId('reset-view').click();
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');
    expect(await getCamera(page)).toEqual({ x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
    const origin = await originOnScreen(page);
    expect(Math.abs(origin.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - CENTRE.y)).toBeLessThanOrEqual(1);
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD, 2);
  });
});

test.describe('far travel', () => {
  for (const zoom of [1, ZOOM_MAX]) {
    test(`TC-27 panning is exact ${zoom === 1 ? 'at 100%' : 'at maximum zoom'} 1,000,000 units away`, async ({
      page,
    }) => {
      await navigateToNewBoard(page);
      const far = {
        x: UNBOUNDED_PAN_TESTED_EXTENT,
        y: -UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      };
      await setCamera(page, far);

      // the grid is still drawn at GRID_SPACING_WORLD * zoom, with no drift
      expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * zoom, 2);
      const phase0 = await gridPositionPx(page);
      expect(phase0.x).toBeGreaterThanOrEqual(0);
      expect(phase0.x).toBeLessThan(GRID_SPACING_WORLD * zoom + 0.01);

      // a drag moves the camera by exactly delta/zoom, with no edge and no rounding
      await drag(page, { x: 500, y: 350 }, { x: 700, y: 450 });
      const moved = await getCamera(page);
      expect(Math.abs(moved.x - (far.x - 200 / zoom))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(moved.y - (far.y - 100 / zoom))).toBeLessThanOrEqual(1e-9);
      expect(moved.zoom).toBe(zoom);

      // panning one whole grid cell returns the grid to the phase it had before that drag
      const cell = GRID_SPACING_WORLD * zoom;
      const phaseBeforeCell = await gridPositionPx(page);
      await drag(page, { x: 300, y: 300 }, { x: 300 + cell, y: 300 });
      const atCell = await getCamera(page);
      expect(Math.abs(atCell.x - (moved.x - GRID_SPACING_WORLD))).toBeLessThanOrEqual(1e-9);
      const phase1 = await gridPositionPx(page);
      expect(Math.abs(phase1.x - phaseBeforeCell.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(phase1.y - phaseBeforeCell.y)).toBeLessThanOrEqual(0.01);

      // and dragging back the other way restores the camera exactly
      await drag(page, { x: 300 + cell, y: 300 }, { x: 300, y: 300 });
      const back = await getCamera(page);
      expect(back).toEqual(moved);
    });
  }

  test('zoom limits hold far away too', async ({ page }) => {
    await navigateToNewBoard(page);
    const start = { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    await setCamera(page, start);

    const pointer = { x: 640, y: 400 };
    const pointerWorld = screenToWorld(start, pointer);
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, -600);
    }
    await page.keyboard.up('Control');
    await expect.poll(() => zoomLabel(page)).toBe('400%');
    const atMax = await cameraSettled(page);
    expect(atMax.zoom).toBe(ZOOM_MAX);
    // the far-away world point under the pointer never drifted while zooming to the limit
    expect(screenToWorld(atMax, pointer).x).toBeCloseTo(pointerWorld.x, 5);
    expect(screenToWorld(atMax, pointer).y).toBeCloseTo(pointerWorld.y, 5);

    await page.keyboard.down('Control');
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.wheel(0, 600);
    }
    await page.keyboard.up('Control');
    await expect.poll(() => zoomLabel(page)).toBe('10%');
    expect((await cameraSettled(page)).zoom).toBe(ZOOM_MIN);
  });
});

test.describe('large viewport fixture', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the board opens centred and resets centred at 1920x1080', async ({ page }) => {
    await navigateToNewBoard(page);
    expect(await getCamera(page)).toEqual({ x: -960, y: -540, zoom: 1 });

    await setCamera(page, { x: 4321, y: -8765, zoom: 0.4 });
    await page.getByTestId('reset-view').click();
    await expect(page.getByTestId('zoom-percent')).toHaveText('100%');
    expect(await getCamera(page)).toEqual({ x: -960, y: -540, zoom: 1 });
    const origin = await originOnScreen(page);
    expect(Math.abs(origin.x - 960)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - 540)).toBeLessThanOrEqual(1);
  });
});
