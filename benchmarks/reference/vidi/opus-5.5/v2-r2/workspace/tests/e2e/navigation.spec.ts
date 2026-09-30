import { type Locator, type Page, expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import {
  HINT_TEXT,
  drag,
  getCamera,
  gridGeometry,
  modularDelta,
  nextFrames,
  openBoard,
  originMarkerCentre,
  pageZoomState,
  setCamera,
  zoomLabel,
} from './helpers/board';

/** Clicks a zoom button until it disables, waiting for each label change; returns the labels seen. */
async function clickUntilDisabled(page: Page, button: Locator): Promise<string[]> {
  const labels: string[] = [];
  for (let i = 0; i < 40 && (await button.isEnabled()); i++) {
    const previous = await zoomLabel(page).textContent();
    await button.click();
    await expect(zoomLabel(page)).not.toHaveText(previous ?? '');
    labels.push((await zoomLabel(page).textContent()) ?? '');
  }
  return labels;
}

const TOLERANCE_PX = 1;
const VIEWPORT_CENTRE = { x: 640, y: 400 };

test.describe('story 1: pan and zoom', () => {
  test('workflow 1: first visit navigation (TC-28, TC-23, TC-24)', async ({ page }) => {
    await openBoard(page);

    // TC-28: hint visible on load.
    await expect(page.getByText(HINT_TEXT)).toBeVisible();
    await expect(zoomLabel(page)).toHaveText('100%');

    // The board starts centred on its starting point.
    const start = await originMarkerCentre(page);
    expect(Math.abs(start.x - VIEWPORT_CENTRE.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(start.y - VIEWPORT_CENTRE.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    const gridBefore = await gridGeometry(page);

    // TC-23: drag from the origin dot by (200, 100).
    await drag(page, start, 200, 100);
    const afterDrag = await originMarkerCentre(page);
    expect(Math.abs(afterDrag.x - start.x - 200)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(afterDrag.y - start.y - 100)).toBeLessThanOrEqual(TOLERANCE_PX);
    const gridAfter = await gridGeometry(page);
    expect(gridAfter.size).toBeCloseTo(GRID_SPACING_WORLD, 3);
    expect(Math.abs(modularDelta(gridBefore.offsetX, gridAfter.offsetX, gridAfter.size) - modularDelta(0, 200, gridAfter.size))).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(modularDelta(gridBefore.offsetY, gridAfter.offsetY, gridAfter.size) - modularDelta(0, 100, gridAfter.size))).toBeLessThanOrEqual(TOLERANCE_PX);

    // TC-28: hint gone after the first pan.
    await expect(page.getByText(HINT_TEXT)).toHaveCount(0);

    // TC-24: Ctrl + wheel over the origin dot keeps it under the pointer.
    await page.mouse.move(afterDrag.x, afterDrag.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');
    await nextFrames(page);
    const afterZoomIn = await originMarkerCentre(page);
    expect(Math.abs(afterZoomIn.x - afterDrag.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(afterZoomIn.y - afterDrag.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    const zoomedIn = (await getCamera(page)).zoom;
    expect(zoomedIn).toBeGreaterThan(1);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 150);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await getCamera(page)).zoom).toBeLessThan(zoomedIn);
    await nextFrames(page);
    const afterZoomOut = await originMarkerCentre(page);
    expect(Math.abs(afterZoomOut.x - afterDrag.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(afterZoomOut.y - afterDrag.y)).toBeLessThanOrEqual(TOLERANCE_PX);

    const zoomState = await pageZoomState(page);
    expect(zoomState.scale).toBe(1);

    // Hint stays gone for the rest of the visit.
    await expect(page.getByText(HINT_TEXT)).toHaveCount(0);
  });

  test('plain scroll pans the board in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const start = await originMarkerCentre(page);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await originMarkerCentre(page)).y).toBeLessThan(start.y);
    const afterDown = await originMarkerCentre(page);
    expect(Math.abs(afterDown.y - (start.y - 100))).toBeLessThanOrEqual(TOLERANCE_PX);
    await page.mouse.wheel(80, 0);
    await expect.poll(async () => (await originMarkerCentre(page)).x).toBeLessThan(start.x);
    const afterRight = await originMarkerCentre(page);
    expect(Math.abs(afterRight.x - (start.x - 80))).toBeLessThanOrEqual(TOLERANCE_PX);
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  test('workflow 2: limits and recovery (TC-25, TC-26)', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    // TC-25: + until disabled.
    await zoomIn.click();
    await expect(zoomLabel(page)).toHaveText('125%');
    await zoomOut.click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const labels = await clickUntilDisabled(page, zoomIn);
    expect(labels).toEqual(['125%', '156%', '195%', '244%', '305%', '381%', '400%']);
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();

    // Minimum limit, then zooming back re-enables the button.
    await clickUntilDisabled(page, zoomOut);
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
    await zoomIn.click();
    await expect(zoomOut).toBeEnabled();

    // TC-26: far away at 400%, Reset view returns to 100% centred.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await nextFrames(page);
    const origin = await originMarkerCentre(page);
    expect(Math.abs(origin.x - VIEWPORT_CENTRE.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(origin.y - VIEWPORT_CENTRE.y)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test('workflow 3: far travel still pans exactly (TC-27)', async ({ page }) => {
    await openBoard(page);
    const zoom = 2;
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom });
    const before = await getCamera(page);
    const gridBefore = await gridGeometry(page);
    expect(gridBefore.size).toBeCloseTo(GRID_SPACING_WORLD * zoom, 3);

    await drag(page, { x: 400, y: 300 }, 200, 100);
    const after = await getCamera(page);
    expect(Math.abs((before.x - after.x) * zoom - 200)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs((before.y - after.y) * zoom - 100)).toBeLessThanOrEqual(TOLERANCE_PX);

    const gridAfter = await gridGeometry(page);
    expect(gridAfter.size).toBeCloseTo(GRID_SPACING_WORLD * zoom, 3);
    expect(Math.abs(modularDelta(gridBefore.offsetX, gridAfter.offsetX, gridAfter.size) - modularDelta(0, 200, gridAfter.size))).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(modularDelta(gridBefore.offsetY, gridAfter.offsetY, gridAfter.size) - modularDelta(0, 100, gridAfter.size))).toBeLessThanOrEqual(TOLERANCE_PX);

    // Reset view still returns to the start from a million units away.
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await nextFrames(page);
    const origin = await originMarkerCentre(page);
    expect(Math.abs(origin.x - VIEWPORT_CENTRE.x)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test('TC-31: board zoom gestures and shortcuts never change page zoom', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomState(page);
    await page.getByTestId('board-viewport').focus();

    await page.mouse.move(500, 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Minus');
    await nextFrames(page);
    expect(await pageZoomState(page)).toEqual(before);

    await page.keyboard.press('Control+Digit0');
    await expect(zoomLabel(page)).toHaveText('100%');
    expect(await pageZoomState(page)).toEqual(before);
  });

  test('Ctrl/Cmd + = / − / 0 step the board zoom', async ({ page }) => {
    await openBoard(page);
    await page.getByTestId('board-viewport').focus();
    await page.keyboard.press('Control+Equal');
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+Minus');
    await expect(zoomLabel(page)).toHaveText('100%');
    await page.keyboard.press('Control+Minus');
    await expect(zoomLabel(page)).toHaveText('80%');
    await page.keyboard.press('Control+Digit0');
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  test('resizing the window does not move content relative to the top-left', async ({ page }) => {
    await openBoard(page);
    const before = await originMarkerCentre(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await nextFrames(page);
    const after = await originMarkerCentre(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    // Reset view centres in the new board area size.
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await nextFrames(page);
    const centred = await originMarkerCentre(page);
    expect(Math.abs(centred.x - 960)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(centred.y - 540)).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});
