import { test, expect } from '@playwright/test';
import {
  openBoard,
  getCamera,
  setCamera,
  markerCenter,
  zoomLabel,
  gridSpacingPx,
  visualScale,
  expectPixelClose,
} from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

async function dragBy(page: import('@playwright/test').Page, sx: number, sy: number, dx: number, dy: number) {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy);
  await page.mouse.up();
}

// A real, cancelable Ctrl+wheel dispatched on the board element: our non-passive
// listener must preventDefault, which is exactly what suppresses page zoom.
async function ctrlWheelAt(page: import('@playwright/test').Page, x: number, y: number, deltaY: number) {
  return page.evaluate(
    ({ x, y, deltaY }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement;
      const ev = new WheelEvent('wheel', {
        clientX: x,
        clientY: y,
        deltaY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        deltaMode: 0,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    { x, y, deltaY },
  );
}

test('TC-28 first-use hint: visible, then gone after the first pan and stays gone', async ({ page }) => {
  await openBoard(page);
  const hint = page.getByTestId('navigation-hint');
  await expect(hint).toBeVisible();

  await dragBy(page, 400, 300, 40, 20);
  await expect(hint).toHaveCount(0);

  // Further navigation must not bring it back for the rest of the visit.
  await ctrlWheelAt(page, 640, 360, -100);
  await expect(hint).toHaveCount(0);
});

test('TC-23 real mouse drag moves the board by exactly (200,100)', async ({ page }) => {
  await openBoard(page);
  const m0 = await markerCenter(page);
  await dragBy(page, 400, 300, 200, 100);
  const m1 = await markerCenter(page);
  await expectPixelClose(m1.x, m0.x + 200, 1);
  await expectPixelClose(m1.y, m0.y + 100, 1);
});

test('TC-24 pointer zoom keeps the dot under the pointer and does not zoom the page', async ({ page }) => {
  await openBoard(page);
  const m0 = await markerCenter(page);
  const scale0 = await visualScale(page);
  const prevented = await ctrlWheelAt(page, Math.round(m0.x), Math.round(m0.y), -100);
  const c1 = await getCamera(page);
  const m1 = await markerCenter(page);
  expect(prevented).toBe(true);
  expect(c1.zoom).toBeGreaterThan(1);
  // The world origin stayed under the pointer.
  await expectPixelClose(m1.x, m0.x, 1);
  await expectPixelClose(m1.y, m0.y, 1);
  // And the browser page never zoomed.
  expect(await visualScale(page)).toBe(scale0);
});

test('TC-25 zoom-in button: repeated clicks clamp at 400% and become disabled', async ({ page }) => {
  await openBoard(page);
  const plus = page.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 15; i++) {
    if (await plus.isDisabled()) break;
    await plus.click();
  }
  await expect(plus).toBeDisabled();
  await expect(zoomLabel(page)).resolves.toBe('400%');
});

test('TC-26 reset returns to 100% and centres the origin (from a far, zoomed view)', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 4 });
  await expect(zoomLabel(page)).resolves.toBe('400%');

  await page.getByRole('button', { name: 'Reset view' }).click();

  await expect(zoomLabel(page)).resolves.toBe('100%');
  const vp = page.viewportSize()!;
  const m = await markerCenter(page);
  await expectPixelClose(m.x, vp.width / 2, 1);
  await expectPixelClose(m.y, vp.height / 2, 1);
});

test('TC-27 far travel (1,000,000 units): drag stays exact and the grid spacing is constant', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 2 });
  const before = await getCamera(page);
  expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * 2, 0);

  await dragBy(page, 400, 300, 200, 100);

  const after = await getCamera(page);
  // Camera moved by exactly delta/zoom world units, no float distortion.
  await expectPixelClose(after.x, before.x - 200 / 2, 0.001);
  await expectPixelClose(after.y, before.y - 100 / 2, 0.001);
  expect(after.zoom).toBe(2);
  expect(Number.isFinite(after.x) && Number.isFinite(after.y)).toBe(true);
  // Grid spacing unchanged and still = GRID_SPACING_WORLD * zoom.
  expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * 2, 0);
});

test('TC-31 negative: board zoom gestures never change page zoom (scale + dpr unchanged)', async ({ page }) => {
  await openBoard(page);
  const scale0 = await visualScale(page);
  const dpr0 = await page.evaluate(() => window.devicePixelRatio);

  await ctrlWheelAt(page, 640, 360, -200);
  await ctrlWheelAt(page, 500, 300, 200);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');

  expect(await visualScale(page)).toBe(scale0);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr0);
});
