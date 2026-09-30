import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  clickUntilDisabled,
  drag,
  getCamera,
  gridMetrics,
  isDotAt,
  nearestDot,
  openBoard,
  originCentre,
  pageZoom,
  setCamera,
  viewport,
  zoomLabel,
} from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const PX_TOLERANCE = 1;

function expectNear(actual: number, expected: number, tol = PX_TOLERANCE) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24: hint, exact drag, zoom around the pointer', async ({ page }) => {
    await openBoard(page);
    const vp = page.viewportSize()!;

    // TC-28: hint visible on first load, zoom starts at 100% with origin centred.
    await expect(page.getByText(HINT)).toBeVisible();
    await expect(zoomLabel(page)).toHaveText('100%');
    const o0 = await originCentre(page);
    expectNear(o0.x, vp.width / 2);
    expectNear(o0.y, vp.height / 2);

    // TC-23: drag from a grid dot by (200, 100).
    const grid0 = await gridMetrics(page);
    expect(grid0.size).toBeCloseTo(GRID_SPACING_WORLD, 3);
    const dot = nearestDot(grid0, { x: 300, y: 300 });
    await drag(page, dot, 200, 100);
    await expect(viewport(page)).toHaveAttribute('data-state', 'idle');
    const o1 = await originCentre(page);
    expectNear(o1.x, o0.x + 200);
    expectNear(o1.y, o0.y + 100);
    const grid1 = await gridMetrics(page);
    expect(isDotAt(grid1, { x: dot.x + 200, y: dot.y + 100 })).toBe(true);

    // TC-28: hint removed after the drag.
    await expect(page.getByText(HINT)).toHaveCount(0);

    // TC-24: Ctrl + wheel over a dot keeps it under the pointer.
    const pointer = nearestDot(grid1, { x: 500, y: 350 });
    await page.mouse.move(pointer.x, pointer.y);
    const before = await getCamera(page);
    const worldUnderPointer = {
      x: pointer.x / before.zoom + before.x,
      y: pointer.y / before.zoom + before.y,
    };
    const scaleBefore = await pageZoom(page);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');

    const after = await getCamera(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expectNear((worldUnderPointer.x - after.x) * after.zoom, pointer.x);
    expectNear((worldUnderPointer.y - after.y) * after.zoom, pointer.y);
    // Real pixels: the origin marker scaled about the pointer.
    const o2 = await originCentre(page);
    const f = after.zoom / before.zoom;
    expectNear(o2.x, pointer.x + (o1.x - pointer.x) * f);
    expectNear(o2.y, pointer.y + (o1.y - pointer.y) * f);
    expect(await pageZoom(page)).toEqual(scaleBefore);
    expect(scaleBefore.scale).toBe(1);

    // Zoom back out: same point stays put.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await getCamera(page)).zoom).not.toBe(after.zoom);
    const back = await getCamera(page);
    expectNear((worldUnderPointer.x - back.x) * back.zoom, pointer.x);
    expectNear((worldUnderPointer.y - back.y) * back.zoom, pointer.y);
    await expect(page.getByText(HINT)).toHaveCount(0);
  });

  test('plain wheel scroll pans in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const o0 = await originCentre(page);
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await originCentre(page)).y).toBeLessThan(o0.y);
    const o1 = await originCentre(page);
    expectNear(o1.y, o0.y - 120);
    expectNear(o1.x, o0.x);
    await page.mouse.wheel(80, 0);
    await expect.poll(async () => (await originCentre(page)).x).toBeLessThan(o0.x);
    expectNear((await originCentre(page)).x, o0.x - 80);
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 → TC-26: zoom to maximum, then Reset view from far away', async ({ page }) => {
    await openBoard(page);
    const vp = page.viewportSize()!;
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    // TC-25: + until disabled.
    await zoomIn.click();
    await expect(zoomLabel(page)).toHaveText('125%');
    await zoomOut.click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const labels = await clickUntilDisabled(page, zoomIn, 20);
    expect(labels.at(-1)).toBe(`${ZOOM_MAX * 100}%`);
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
    await expect(zoomIn).toBeDisabled();
    await expect(zoomIn).toHaveAttribute('disabled', '');
    await expect(zoomOut).toBeEnabled();

    // TC-26: jump far away at max zoom, then Reset view.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const o = await originCentre(page);
    expectNear(o.x, vp.width / 2);
    expectNear(o.y, vp.height / 2);
    await expect(zoomIn).toBeEnabled();
  });

  test('zoom out to minimum disables − and stops at 10%', async ({ page }) => {
    await openBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    await clickUntilDisabled(page, zoomOut, 30);
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the board still pans exactly and the grid is even', async ({ page }) => {
    await openBoard(page);
    const far = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    await setCamera(page, far);

    const grid0 = await gridMetrics(page);
    expect(grid0.size).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);
    const dot = nearestDot(grid0, { x: 400, y: 300 });
    await drag(page, dot, 200, 100);
    await expect(viewport(page)).toHaveAttribute('data-state', 'idle');

    const cam = await getCamera(page);
    expect(Math.abs(cam.x - (far.x - 200))).toBeLessThan(1e-6);
    expect(Math.abs(cam.y - (far.y - 100))).toBeLessThan(1e-6);
    const grid1 = await gridMetrics(page);
    expect(grid1.size).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);
    expect(isDotAt(grid1, { x: dot.x + 200, y: dot.y + 100 })).toBe(true);

    // And from far away at a different zoom, and in the negative direction.
    await setCamera(page, { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 2 });
    const grid2 = await gridMetrics(page);
    expect(grid2.size).toBeCloseTo(GRID_SPACING_WORLD * 2, 3);
    const dot2 = nearestDot(grid2, { x: 500, y: 400 });
    await drag(page, dot2, -200, -100);
    const grid3 = await gridMetrics(page);
    expect(isDotAt(grid3, { x: dot2.x - 200, y: dot2.y - 100 })).toBe(true);
  });
});

test('TC-31 board zoom gestures and shortcuts never change the page zoom', async ({ page }) => {
  await openBoard(page);
  const before = await pageZoom(page);
  const labelBox = await zoomLabel(page).boundingBox();
  await page.getByTestId('board-viewport').focus();

  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+Equal');
  await expect(zoomLabel(page)).not.toHaveText('100%');
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Digit0');
  await expect(zoomLabel(page)).toHaveText('100%');

  expect(await pageZoom(page)).toEqual(before);
  expect(before.scale).toBe(1);
  expect(await zoomLabel(page).boundingBox()).toEqual(labelBox);
});

test('keyboard shortcuts step the zoom by one step', async ({ page }) => {
  await openBoard(page);
  await page.getByTestId('board-viewport').focus();
  await page.keyboard.press('Control+Equal');
  await expect(zoomLabel(page)).toHaveText('125%');
  await page.keyboard.press('Control+Minus');
  await expect(zoomLabel(page)).toHaveText('100%');
});
