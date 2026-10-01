import { expect, test } from '@playwright/test';
import {
  HINT_TEXT,
  dotNearCentre,
  gridInfo,
  originCentre,
  openNewBoard,
  setCamera,
  zoomLabel,
  zoomValue,
} from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';

const TOL = 1;

async function nextFrames(page: import('@playwright/test').Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page);
}

test.beforeEach(async ({ page }) => {
  await openNewBoard(page);
  await expect(zoomLabel(page)).toHaveText('100%');
});

test.describe('first visit navigation', () => {
  test('TC-28 hint visible, removed after drag; TC-23 drag moves board exactly; TC-24 ctrl+wheel keeps point', async ({ page }) => {
    await expect(page.getByText(HINT_TEXT)).toBeVisible();
    const o0 = await originCentre(page);
    const d0 = await dotNearCentre(page);
    await drag(page, { x: 300, y: 300 }, 200, 100);
    await expect(page.getByText(HINT_TEXT)).toHaveCount(0);
    const o1 = await originCentre(page);
    expect(Math.abs(o1.x - o0.x - 200)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(o1.y - o0.y - 100)).toBeLessThanOrEqual(TOL);
    const g = await gridInfo(page);
    // The same dot (identified by its offset from the origin marker) moved with the board.
    const d1 = await dotNearCentre(page);
    const shiftX = (((d1.x - d0.x - 200) % g.spacing) + g.spacing) % g.spacing;
    expect(Math.min(shiftX, g.spacing - shiftX)).toBeLessThanOrEqual(TOL);

    // Ctrl+wheel keeps the dot under the pointer.
    const dot = await dotNearCentre(page);
    const before = await originCentre(page);
    await page.mouse.move(dot.x, dot.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');
    await nextFrames(page);
    const after = await originCentre(page);
    const z = (await zoomValue(page)) / 100;
    // world point under pointer: (dot - origin)/zoom is invariant.
    const worldBefore = { x: dot.x - before.x, y: dot.y - before.y };
    const worldAfter = { x: (dot.x - after.x) / z, y: (dot.y - after.y) / z };
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThanOrEqual(TOL);
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  });

  test('plain scroll pans in the scroll direction', async ({ page }) => {
    const o0 = await originCentre(page);
    await page.mouse.move(400, 400);
    await page.mouse.wheel(30, 100);
    await expect.poll(async () => (await originCentre(page)).y).toBeCloseTo(o0.y - 100, 0);
    expect((await originCentre(page)).x).toBeCloseTo(o0.x - 30, 0);
  });
});

test.describe('limits and recovery', () => {
  test('TC-25 + until disabled; TC-26 reset from far away', async ({ page }) => {
    const plus = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 20 && (await plus.isEnabled()); i++) {
      await plus.click();
      await nextFrames(page);
    }
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
    await expect(plus).toBeDisabled();

    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const o = await originCentre(page);
    const vp = page.viewportSize()!;
    await expect.poll(async () => Math.abs((await originCentre(page)).x - vp.width / 2)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(o.y - vp.height / 2)).toBeLessThanOrEqual(TOL);
  });
});

test.describe('far travel', () => {
  test('TC-27 pan exactly and keep grid spacing at 1,000,000 units', async ({ page }) => {
    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
    await expect.poll(async () => (await gridInfo(page)).spacing).toBe(GRID_SPACING_WORLD);
    const a = await gridInfo(page);
    await drag(page, { x: 400, y: 300 }, 200, 100);
    const b = await gridInfo(page);
    expect(b.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
    const mod = (v: number) => ((v % a.spacing) + a.spacing) % a.spacing;
    const diffX = mod(b.dotX - a.dotX - 200);
    expect(Math.min(diffX, a.spacing - diffX)).toBeLessThanOrEqual(TOL);
    const diffY = mod(b.dotY - a.dotY - 100);
    expect(Math.min(diffY, a.spacing - diffY)).toBeLessThanOrEqual(TOL);
  });
});

test('TC-31 board gestures and shortcuts do not change page zoom', async ({ page, browserName }) => {
  const read = () => page.evaluate(() => ({ s: window.visualViewport!.scale, d: window.devicePixelRatio }));
  const before = await read();
  await page.mouse.move(500, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(key);
  expect(await read()).toEqual(before);
  expect(browserName).toBeTruthy();
});
