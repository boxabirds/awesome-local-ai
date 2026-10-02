import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  backgroundSize,
  ctrlWheelAt,
  gotoBoard,
  markerCenter,
  pressChord,
  resetButton,
  setCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  zoomPercent,
} from './helpers/board';

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 hint is shown on load and removed after the first drag', async ({
    page,
  }) => {
    await gotoBoard(page);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();

    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
  });

  test('TC-23 a real mouse drag moves the board by exactly the pointer delta', async ({
    page,
  }) => {
    await gotoBoard(page);
    const before = await markerCenter(page);

    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 10 });
    await page.mouse.up();

    const after = await markerCenter(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);
  });

  test('TC-24 Ctrl + wheel keeps the point under the pointer and does not zoom the page', async ({
    page,
  }) => {
    await gotoBoard(page);
    const m0 = await markerCenter(page);
    const z0 = await zoomPercent(page);

    await ctrlWheelAt(page, m0.x, m0.y, -100);

    const m1 = await markerCenter(page);
    expect(Math.abs(m1.x - m0.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(m1.y - m0.y)).toBeLessThanOrEqual(1);

    const z1 = await zoomPercent(page);
    expect(z1).not.toBe(z0); // the board really did zoom

    const scale = await page.evaluate(
      () => window.visualViewport?.scale ?? 1,
    );
    expect(scale).toBe(1);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 zooming in repeatedly stops at 400% and disables +', async ({
    page,
  }) => {
    await gotoBoard(page);
    const btn = zoomInButton(page);
    for (let i = 0; i < 40 && !(await btn.isDisabled()); i++) {
      await btn.click();
    }
    await expect(btn).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText('400%');
    expect(await zoomPercent(page)).toBe(400);
  });

  test('TC-25b zooming out repeatedly stops at 10% and disables −', async ({
    page,
  }) => {
    await gotoBoard(page);
    const btn = zoomOutButton(page);
    for (let i = 0; i < 40 && !(await btn.isDisabled()); i++) {
      await btn.click();
    }
    await expect(btn).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText('10%');
  });

  test('TC-26 Reset view from far away at max zoom returns to 100% centred', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');

    await resetButton(page).click();

    await expect(zoomLabel(page)).toHaveText('100%');
    const c = await markerCenter(page);
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    expect(Math.abs(c.x - vp.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - vp.height / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 panning 1,000,000 units away stays exact with an even grid', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    // Even grid: spacing equals GRID_SPACING_WORLD * zoom.
    const bs = await backgroundSize(page);
    const expected = GRID_SPACING_WORLD * 1;
    expect(bs).toBe(`${expected}px ${expected}px`);

    const before = await markerCenter(page);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(840, 400, { steps: 10 });
    await page.mouse.up();

    const after = await markerCenter(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);
  });
});

test.describe('page zoom suppression', () => {
  test('TC-31 board zoom gestures never change the page zoom', async ({
    page,
  }) => {
    await gotoBoard(page);
    const dpr0 = await page.evaluate(() => window.devicePixelRatio);
    const m = await markerCenter(page);

    await ctrlWheelAt(page, m.x, m.y, -100);
    await ctrlWheelAt(page, m.x, m.y, 100);
    await pressChord(page, '=');
    await pressChord(page, '-');
    await pressChord(page, '0');

    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const dpr1 = await page.evaluate(() => window.devicePixelRatio);
    expect(scale).toBe(1);
    expect(dpr1).toBe(dpr0);
  });
});
