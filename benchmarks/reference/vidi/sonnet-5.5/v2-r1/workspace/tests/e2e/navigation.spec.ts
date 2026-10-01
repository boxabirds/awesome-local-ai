import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { getCamera, gridDot, openBoard, originCentre, setCamera, wrap } from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const TOLERANCE_PX = 1;
const DRAG = { dx: 200, dy: 100 };

async function drag(page: import('@playwright/test').Page, dx: number, dy: number) {
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(400 + dx / 2, 300 + dy / 2, { steps: 4 });
  await page.mouse.move(400 + dx, 300 + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe('first visit navigation', () => {
  test('TC-28 hint visible, then removed after a drag', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByText(HINT)).toBeVisible();
    await drag(page, DRAG.dx, DRAG.dy);
    await expect(page.getByText(HINT)).toHaveCount(0);
  });

  test('TC-23 drag moves origin marker and grid dot exactly', async ({ page }) => {
    await openBoard(page);
    const originBefore = await originCentre(page);
    const dotBefore = await gridDot(page);
    await drag(page, DRAG.dx, DRAG.dy);
    await expect(page.getByText(HINT)).toHaveCount(0);
    const originAfter = await originCentre(page);
    const dotAfter = await gridDot(page);
    expect(Math.abs(originAfter.x - originBefore.x - DRAG.dx)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(originAfter.y - originBefore.y - DRAG.dy)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(wrap(dotAfter.x - dotBefore.x - DRAG.dx, dotBefore.size))).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(wrap(dotAfter.y - dotBefore.y - DRAG.dy, dotBefore.size))).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test('TC-24 ctrl+wheel keeps the point under the pointer and does not zoom the page', async ({ page }) => {
    await openBoard(page);
    const pointer = { x: 700, y: 350 };
    const worldBefore = await page.evaluate((p) => {
      const c = window.__vidi6!.getCamera();
      return { x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y };
    }, pointer);
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, 150);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await getCamera(page)).zoom).not.toBe(1);
    const cam = await getCamera(page);
    const screenX = (worldBefore.x - cam.x) * cam.zoom;
    const screenY = (worldBefore.y - cam.y) * cam.zoom;
    expect(Math.abs(screenX - pointer.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(screenY - pointer.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  });

  test('plain wheel pans in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const before = await originCentre(page);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(60, 120);
    await expect.poll(async () => (await originCentre(page)).y).toBeLessThan(before.y);
    const after = await originCentre(page);
    expect(after.x).toBeLessThan(before.x);
  });
});

test.describe('limits and recovery', () => {
  test('TC-25 + zooms to 400% and becomes disabled', async ({ page }) => {
    await openBoard(page);
    const plus = page.getByRole('button', { name: 'Zoom in' });
    await plus.click();
    await expect(page.getByTestId('zoom-label')).toHaveText('125%');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    const maxLabel = `${ZOOM_MAX * 100}%`;
    const stepsToMax = Math.ceil(Math.log(ZOOM_MAX) / Math.log(ZOOM_STEP_FACTOR));
    for (let i = 0; i < stepsToMax; i++) await plus.click();
    await expect(page.getByTestId('zoom-label')).toHaveText(maxLabel);
    await expect(plus).toBeDisabled();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(plus).toBeEnabled();
  });

  test('TC-26 reset returns to 100% with origin centred', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await expect(page.getByTestId('zoom-label')).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    const origin = await originCentre(page);
    const vp = page.viewportSize()!;
    expect(Math.abs(origin.x - vp.width / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(origin.y - vp.height / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});

test.describe('far travel', () => {
  test('TC-27 drag is exact and grid spacing stays even at 1,000,000 units', async ({ page }) => {
    await openBoard(page);
    const zoom = 1;
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom });
    const before = await gridDot(page);
    const camBefore = await getCamera(page);
    await drag(page, DRAG.dx, DRAG.dy);
    const after = await gridDot(page);
    const camAfter = await getCamera(page);
    expect(after.size).toBeCloseTo(GRID_SPACING_WORLD * zoom, 6);
    expect((camBefore.x - camAfter.x) * zoom).toBeCloseTo(DRAG.dx, 3);
    expect((camBefore.y - camAfter.y) * zoom).toBeCloseTo(DRAG.dy, 3);
    expect(Math.abs(wrap(after.x - before.x - DRAG.dx, before.size))).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(wrap(after.y - before.y - DRAG.dy, before.size))).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});

test('TC-31 zoom gestures and shortcuts do not change page zoom', async ({ page }) => {
  await openBoard(page);
  const metrics = () => page.evaluate(() => ({ scale: window.visualViewport?.scale, dpr: window.devicePixelRatio }));
  const before = await metrics();
  await page.mouse.move(500, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  expect(await metrics()).toEqual(before);
  await expect(page.getByTestId('zoom-label')).toHaveText('100%');
});
