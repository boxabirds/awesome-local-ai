import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import { HINT, dotPosition, gridState, originCentre, setCamera, zoomLabel } from './helpers/board';

const TOLERANCE = 1;
const centre = { x: 640, y: 400 };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('origin-marker')).toBeVisible();
});

test('first visit navigation: hint, exact drag, pointer zoom', async ({ page }) => {
  // TC-28
  await expect(page.getByText(HINT)).toBeVisible();

  // TC-23
  const o0 = await originCentre(page);
  const g0 = await gridState(page);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 350, { steps: 4 });
  await page.mouse.move(500, 400, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await originCentre(page)).x).not.toBe(o0.x);
  await page.waitForTimeout(100);
  const o1 = await originCentre(page);
  expect(Math.abs(o1.x - o0.x - 200)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(o1.y - o0.y - 100)).toBeLessThanOrEqual(TOLERANCE);
  const g1 = await gridState(page);
  const spacing = g0.sx;
  const shiftX = (((g1.px - g0.px - 200) % spacing) + spacing) % spacing;
  const shiftY = (((g1.py - g0.py - 100) % spacing) + spacing) % spacing;
  expect(Math.min(shiftX, spacing - shiftX)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.min(shiftY, spacing - shiftY)).toBeLessThanOrEqual(TOLERANCE);
  await expect(page.getByText(HINT)).toHaveCount(0);

  // TC-24: the origin marker is a distinctive board location under the pointer
  const o = await originCentre(page);
  await page.mouse.move(o.x, o.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(zoomLabel(page)).not.toHaveText('100%');
  const o2 = await originCentre(page);
  expect(Math.abs(o2.x - o.x)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(o2.y - o.y)).toBeLessThanOrEqual(TOLERANCE);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test('plain wheel pans the board in the scroll direction', async ({ page }) => {
  const o0 = await originCentre(page);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(50, 100);
  await expect.poll(async () => (await originCentre(page)).y).toBeCloseTo(o0.y - 100, 0);
  expect((await originCentre(page)).x).toBeCloseTo(o0.x - 50, 0);
});

test('limits and recovery', async ({ page }) => {
  // TC-25
  const plus = page.getByRole('button', { name: 'Zoom in' });
  // Updates are frame-batched, so clicks past the limit land on a button about to be disabled.
  for (let i = 0; i < 10; i++) await plus.click({ force: true });
  await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
  await expect(plus).toBeDisabled();

  // TC-26
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(zoomLabel(page)).toHaveText('100%');
  const o = await originCentre(page);
  expect(Math.abs(o.x - centre.x)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(o.y - centre.y)).toBeLessThanOrEqual(TOLERANCE);
});

test('far travel keeps panning exact', async ({ page }) => {
  // TC-27
  const initial = await gridState(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT + 5, y: UNBOUNDED_PAN_TESTED_EXTENT + 7, zoom: 1 });
  await expect.poll(async () => (await gridState(page)).px).not.toBe(initial.px);
  const g0 = await gridState(page);
  const d0 = dotPosition(g0);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 5 });
  await page.mouse.up();
  const s = g0.sx;
  const wrap = (v: number) => Math.min(((v % s) + s) % s, s - (((v % s) + s) % s));
  await expect.poll(async () => {
    const g1 = await gridState(page);
    const d1 = dotPosition(g1);
    return g1.sx === GRID_SPACING_WORLD && wrap(d1.x - d0.x - 200) <= TOLERANCE && wrap(d1.y - d0.y - 100) <= TOLERANCE
      && (g1.px !== g0.px || g1.py !== g0.py);
  }).toBe(true);
});

test('board gestures do not zoom the page', async ({ page }) => {
  // TC-31
  const before = await page.evaluate(() => ({ s: window.visualViewport?.scale, d: devicePixelRatio }));
  await page.mouse.move(400, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  const after = await page.evaluate(() => ({ s: window.visualViewport?.scale, d: devicePixelRatio }));
  expect(after).toEqual(before);
  const size = await page.getByRole('button', { name: 'Reset view' }).evaluate((e) => getComputedStyle(e).fontSize);
  expect(size).toBe('13.3333px');
});
