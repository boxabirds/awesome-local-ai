import { test, expect } from '@playwright/test';
import {
  openBoard,
  originCentre,
  zoomLabel,
  zoomInButton,
  resetButton,
  gridSpacingPx,
  setCamera,
} from './helpers/board.ts';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  GRID_SPACING_WORLD,
  ZOOM_MAX,
} from '../../src/shared/config.ts';

async function dragBy(page: import('@playwright/test').Page, fromX: number, fromY: number, dx: number, dy: number) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + dx / 2, fromY + dy / 2, { steps: 5 });
  await page.mouse.move(fromX + dx, fromY + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

const round = (n: number) => Math.round(n);

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28 hint visible then removed after drag', async ({ page }) => {
    await openBoard(page);
    const hint = page.getByTestId('nav-hint');
    await expect(hint).toBeVisible();
    await dragBy(page, 640, 400, 50, 50);
    await expect(hint).toHaveCount(0);
  });

  test('TC-23 real mouse drag moves the origin marker by exactly the drag delta', async ({ page }) => {
    await openBoard(page);
    await page.waitForTimeout(60);
    const before = await originCentre(page);
    await dragBy(page, 400, 300, 200, 100);
    const after = await originCentre(page);
    expect(round(after.x - before.x)).toBeCloseTo(200, 0);
    expect(round(after.y - before.y)).toBeCloseTo(100, 0);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24 ctrl+wheel over a dot keeps it under the pointer; visualViewport.scale stays 1', async ({ page }) => {
    await openBoard(page);
    await page.waitForTimeout(60);
    const dot = await originCentre(page);
    await page.mouse.move(dot.x, dot.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(80);
    const after = await originCentre(page);
    expect(Math.abs(after.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - dot.y)).toBeLessThanOrEqual(1);
    const scale = await page.evaluate(() => (window.visualViewport?.scale ?? 1));
    expect(scale).toBe(1);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25 click + until disabled, label ends 400%, + has disabled attribute', async ({ page }) => {
    await openBoard(page);
    let guard = 0;
    while (guard++ < 30) {
      if (await zoomInButton(page).isDisabled()) break;
      try {
        await zoomInButton(page).click({ timeout: 1000 });
      } catch {
        break; // became disabled between the check and the click
      }
      await page.waitForTimeout(40);
    }
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);
    expect(await zoomInButton(page).getAttribute('disabled')).not.toBeNull();
  });

  test('TC-26 jump far, then Reset view centres the origin at 100%', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 4 });
    await expect(zoomLabel(page)).toHaveText('400%');
    await resetButton(page).click();
    await page.waitForTimeout(80);
    await expect(zoomLabel(page)).toHaveText('100%');
    const rect = await page.getByTestId('viewport').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, left: r.left, top: r.top };
    });
    const c = await originCentre(page);
    const cx = rect.left + rect.w / 2;
    const cy = rect.top + rect.h / 2;
    expect(Math.abs(c.x - cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - cy)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27 at 1,000,000 units the grid spacing is correct and drag is exact', async ({ page }) => {
    await openBoard(page);
    const zoom = 1;
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom });
    const spacing = await gridSpacingPx(page);
    expect(Math.abs(spacing.gx - GRID_SPACING_WORLD * zoom)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(spacing.gy - GRID_SPACING_WORLD * zoom)).toBeLessThanOrEqual(0.5);
    const before = await originCentre(page);
    await dragBy(page, 600, 400, 200, 100);
    const after = await originCentre(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });
});

test.describe('TC-31 board gestures do not zoom the page', () => {
  test('visualViewport.scale and devicePixelRatio unchanged after board zoom gestures', async ({ page }) => {
    await openBoard(page);
    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    await page.mouse.move(600, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
  });
});
