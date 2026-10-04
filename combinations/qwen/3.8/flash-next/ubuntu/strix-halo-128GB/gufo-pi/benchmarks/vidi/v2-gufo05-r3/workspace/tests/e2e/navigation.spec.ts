import { expect, test, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import {
  devicePixelRatio,
  gridSizePx,
  gotoBoard,
  hintVisible,
  markerCenter,
  pageZoomScale,
  setCamera,
  worldTranslate,
  zoomLabelValue,
} from './helpers/board';

const VIEWPORT = { width: 1280, height: 800 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

async function dragBy(page: Page, dx: number, dy: number) {
  const from = { x: 400, y: 300 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function ctrlWheel(page: Page, x: number, y: number, deltaY: number) {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Wait until the app's initial auto-centring has settled (async ResizeObserver). */
async function waitForCentered(page: Page) {
  await expect
    .poll(async () => {
      const c = await markerCenter(page);
      return Math.abs(c.x - CENTER.x) < 2 && Math.abs(c.y - CENTER.y) < 2;
    })
    .toBe(true);
}

/** Set the camera and wait for React to flush the new world-layer transform. */
async function setCameraAndWait(page: Page, cam: { x: number; y: number; zoom: number }) {
  await setCamera(page, cam);
  await expect
    .poll(async () => (await worldTranslate(page)).tx)
    .toBeCloseTo(-cam.x, 2);
  await expect.poll(() => zoomLabelValue(page)).toBe(Math.round(cam.zoom * 100));
}

test.describe('Story 1 navigation', () => {
  test('Workflow 1: first-visit hint -> exact drag -> pointer zoom keeps point fixed', async ({ page }) => {
    await gotoBoard(page);
    await waitForCentered(page);

    // TC-28: hint visible on load.
    expect(await hintVisible(page)).toBe(true);

    // TC-23: dragging (200,100) moves the origin marker by exactly (200,100).
    const before = await markerCenter(page);
    await dragBy(page, 200, 100);
    const after = await markerCenter(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);

    // TC-28 continued: hint gone after first pan.
    expect(await hintVisible(page)).toBe(false);

    // TC-24: reset to centre, then Ctrl+wheel over the marker keeps it fixed
    // and does not zoom the page.
    await setCameraAndWait(page, { x: -CENTER.x, y: -CENTER.y, zoom: 1 });
    const anchor = await markerCenter(page);
    const scaleBefore = await pageZoomScale(page);
    await ctrlWheel(page, anchor.x, anchor.y, -240);
    await expect.poll(() => zoomLabelValue(page)).toBeGreaterThan(100);
    const moved = await markerCenter(page);
    expect(Math.abs(moved.x - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - anchor.y)).toBeLessThanOrEqual(1);
    expect(await pageZoomScale(page)).toBe(scaleBefore); // page zoom unchanged (== 1)
  });

  test('TC-25: zoom in to the maximum disables the button and label stops at 400%', async ({ page }) => {
    await gotoBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
    }
    await expect.poll(() => zoomLabelValue(page)).toBe(Math.round(ZOOM_MAX * 100));
    expect(await zoomIn.isDisabled()).toBe(true);
  });

  test('TC-26: Reset view returns to 100% centred from far away at max zoom', async ({ page }) => {
    await gotoBoard(page);
    await setCameraAndWait(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    expect(await zoomLabelValue(page)).toBe(400);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(() => zoomLabelValue(page)).toBe(100);
    const center = await markerCenter(page);
    expect(Math.abs(center.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - CENTER.y)).toBeLessThanOrEqual(1);
  });

  test('TC-27: panning at 1,000,000 units is exact and the grid stays evenly spaced', async ({ page }) => {
    await gotoBoard(page);
    await setCameraAndWait(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const sizeBefore = await gridSizePx(page);
    expect(sizeBefore).toBeCloseTo(GRID_SPACING_WORLD * 1, 3);
    const before = await worldTranslate(page);
    await dragBy(page, 200, 100);
    const after = await worldTranslate(page);
    expect(Math.abs(after.tx - (before.tx + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.ty - (before.ty + 100))).toBeLessThanOrEqual(1);
    // Grid spacing is unchanged (zoom unchanged) and remains world spacing * zoom.
    expect(await gridSizePx(page)).toBeCloseTo(GRID_SPACING_WORLD * 1, 3);
  });

  test('TC-31: board zoom gestures never change page zoom or devicePixelRatio', async ({ page }) => {
    await gotoBoard(page);
    const scaleBefore = await pageZoomScale(page);
    const dprBefore = await devicePixelRatio(page);

    await ctrlWheel(page, 500, 300, -240);
    await page.keyboard.down('Control');
    await page.keyboard.press('=');
    await page.keyboard.press('-');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');

    expect(await pageZoomScale(page)).toBe(scaleBefore);
    expect(await devicePixelRatio(page)).toBe(dprBefore);
  });
});
