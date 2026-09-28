import { expect, test } from '@playwright/test';
import {
  distanceToDot,
  drag,
  getCamera,
  grid,
  nearestDot,
  openBoard,
  originMarker,
  pageZoom,
  setCamera,
  settle,
  zoomLabel,
} from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';

const PX_TOLERANCE = 1;
const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24 hint, exact drag, zoom around pointer', async ({ page }) => {
    await openBoard(page);

    // Starts at 100% with the origin centred.
    await expect(zoomLabel(page)).toHaveText('100%');
    const viewport = page.viewportSize()!;
    const start = await originMarker(page);
    expect(Math.abs(start.x - viewport.width / 2)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(start.y - viewport.height / 2)).toBeLessThanOrEqual(PX_TOLERANCE);

    // TC-28: hint visible on load.
    await expect(page.getByText(HINT)).toBeVisible();

    // TC-23: drag 200,100 from a visible grid dot.
    const g0 = await grid(page);
    expect(g0.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    const dot = nearestDot(g0, { x: 400, y: 300 });
    await drag(page, dot, 200, 100);
    const after = await originMarker(page);
    expect(Math.abs(after.x - start.x - 200)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(after.y - start.y - 100)).toBeLessThanOrEqual(PX_TOLERANCE);
    const g1 = await grid(page);
    const moved = distanceToDot(g1, { x: dot.x + 200, y: dot.y + 100 });
    expect(moved.x).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(moved.y).toBeLessThanOrEqual(PX_TOLERANCE);

    // TC-28: hint gone after the first pan.
    await expect(page.getByText(HINT)).toHaveCount(0);

    // TC-24: Ctrl + wheel over a dot (the origin marker sits on a grid dot).
    const zoomBefore = await pageZoom(page);
    await page.mouse.move(after.x, after.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);
    await expect(zoomLabel(page)).not.toHaveText('100%');
    expect((await getCamera(page)).zoom).toBeGreaterThan(1);
    const zoomed = await originMarker(page);
    expect(Math.abs(zoomed.x - after.x)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(zoomed.y - after.y)).toBeLessThanOrEqual(PX_TOLERANCE);
    const g2 = await grid(page);
    const still = distanceToDot(g2, zoomed);
    expect(still.x).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(still.y).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(await pageZoom(page)).toEqual(zoomBefore);
    expect(zoomBefore.scale).toBe(1);

    // Hint does not come back.
    await expect(page.getByText(HINT)).toHaveCount(0);
  });

  test('plain wheel pans in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const start = await originMarker(page);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 100);
    await settle(page);
    await expect.poll(async () => (await originMarker(page)).y).toBeLessThan(start.y);
    await page.mouse.wheel(60, 0);
    await settle(page);
    await expect.poll(async () => (await originMarker(page)).x).toBeLessThan(start.x);
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 click + until disabled; label ends at 400%', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const labels: string[] = [];
    for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i++) {
      await zoomIn.click();
      labels.push((await zoomLabel(page).textContent()) ?? '');
    }
    expect(labels.slice(0, 2)).toEqual(['125%', '156%']);
    expect(labels.at(-1)).toBe('400%');
    await expect(zoomIn).toBeDisabled();
    await expect(zoomIn).toHaveAttribute('disabled', '');
    // Zooming back re-enables +.
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(zoomIn).toBeEnabled();
  });

  test('zoom out stops at 10% and disables −', async ({ page }) => {
    await openBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    for (let i = 0; i < 30 && (await zoomOut.isEnabled()); i++) await zoomOut.click();
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
  });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`TC-26 Reset view from far away at max zoom (${size.width}x${size.height})`, async ({ page }) => {
      await page.setViewportSize(size);
      await openBoard(page);
      await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
      await expect(zoomLabel(page)).toHaveText('400%');
      await page.getByRole('button', { name: 'Reset view' }).click();
      await settle(page);
      await expect(zoomLabel(page)).toHaveText('100%');
      const marker = await originMarker(page);
      expect(Math.abs(marker.x - size.width / 2)).toBeLessThanOrEqual(PX_TOLERANCE);
      expect(Math.abs(marker.y - size.height / 2)).toBeLessThanOrEqual(PX_TOLERANCE);
    });
  }

  test('Ctrl+0 resets the view', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 5000, y: 5000, zoom: 3 });
    await page.getByTestId('board-viewport').focus();
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the board still pans exactly', async ({ page }) => {
    await openBoard(page);
    const far = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    await setCamera(page, far);
    await settle(page);
    const g0 = await grid(page);
    expect(g0.spacing).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);
    const dot = nearestDot(g0, { x: 500, y: 400 });
    await drag(page, dot, 200, 100);
    const cam = await getCamera(page);
    expect(Math.abs(cam.x - (far.x - 200 / far.zoom))).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(cam.y - (far.y - 100 / far.zoom))).toBeLessThanOrEqual(PX_TOLERANCE);
    const g1 = await grid(page);
    expect(g1.spacing).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);
    const moved = distanceToDot(g1, { x: dot.x + 200, y: dot.y + 100 });
    expect(moved.x).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(moved.y).toBeLessThanOrEqual(PX_TOLERANCE);
  });
});

test('TC-31 zoom gestures and shortcuts never change the page zoom', async ({ page }) => {
  await openBoard(page);
  const before = await pageZoom(page);
  const controls = page.getByRole('group', { name: 'Zoom' });
  const controlsBox = await controls.boundingBox();

  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await page.getByTestId('board-viewport').focus();
  await page.keyboard.press('Control+=');
  await expect(zoomLabel(page)).not.toHaveText('100%');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  await settle(page);
  await expect(zoomLabel(page)).toHaveText('100%');

  expect(await pageZoom(page)).toEqual(before);
  expect(await controls.boundingBox()).toEqual(controlsBox);
});
