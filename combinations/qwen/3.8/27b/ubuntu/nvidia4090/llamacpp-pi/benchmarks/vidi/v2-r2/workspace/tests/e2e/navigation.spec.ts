import { expect, test, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';
import { createBoard, sharedServerUrl } from './helpers/participants';
import type { Point } from '../../src/client/canvas/camera';
import {
  expectWithinPx,
  gridBackgroundPosition,
  gridBackgroundSize,
  originPosition,
  pageZoomState,
  settle,
  setCamera,
  zoomLabel,
} from './helpers/board';

/**
 * E2E navigation for story 1 (design "E2E workflows"):
 *   1. First visit navigation: TC-28 -> TC-23 -> TC-24
 *   2. Limits and recovery:    TC-25 -> TC-26
 *   3. Far travel:             TC-27
 *   Negative:                  TC-31 (page zoom never changes)
 *
 * The origin marker (a world-space crosshair at (0,0)) is the stable pixel
 * target; its centre sits exactly at worldToScreen(0,0).
 */

const VIEWPORT = { width: 1280, height: 800 };
const CENTER: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** At the standard view a grid dot sits on the world origin, i.e. at the viewport centre. */
const ORIGIN_DOT: Point = { ...CENTER };

const DRAG_FROM: Point = { x: 400, y: 300 };
const DRAG_DELTA: Point = { x: 200, y: 100 };

async function drag(page: Page, from: Point, delta: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  const boardId = await createBoard(sharedServerUrl());
  await page.goto(`/b/${encodeURIComponent(boardId)}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
});

test.describe('navigation.e2e: first visit navigation', () => {
  test('TC-28: the hint is visible on load and removed after the first drag', async ({ page }) => {
    const hint = page.getByTestId('navigation-hint');
    expect(await hint.isVisible()).toBe(true);

    await drag(page, DRAG_FROM, DRAG_DELTA);
    await settle(page);

    expect(await hint.isVisible()).toBe(false);
  });

  test('TC-23: a real mouse drag (200,100) moves the grid dot and origin marker by exactly (200,100) px', async ({ page }) => {
    const markerBefore = await originPosition(page);
    const gridBefore = await gridBackgroundPosition(page);

    await drag(page, DRAG_FROM, DRAG_DELTA);
    await settle(page);

    const markerAfter = await originPosition(page);
    expectWithinPx(markerAfter.x, markerBefore.x + DRAG_DELTA.x, 'origin marker x');
    expectWithinPx(markerAfter.y, markerBefore.y + DRAG_DELTA.y, 'origin marker y');

    // The dot grid moved by the same delta. The tile anchor wraps modulo
    // the tile size, so compare the shift modulo GRID_SPACING_WORLD (the
    // pattern is identical exactly when the shifts agree mod the spacing).
    const gridAfter = await gridBackgroundPosition(page);
    const mod = (v: number, m: number): number => ((v % m) + m) % m;
    const spacing = GRID_SPACING_WORLD; // zoom is 1
    expect(
      Math.abs(mod(gridAfter.x - gridBefore.x, spacing) - mod(DRAG_DELTA.x, spacing)),
      'grid dot x shift (mod spacing)',
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(mod(gridAfter.y - gridBefore.y, spacing) - mod(DRAG_DELTA.y, spacing)),
      'grid dot y shift (mod spacing)',
    ).toBeLessThanOrEqual(1);
  });

  test('TC-24: a Ctrl wheel over a dot keeps the dot under the pointer; page zoom stays 1', async ({ page }) => {
    const before = await originPosition(page);
    expectWithinPx(before.x, ORIGIN_DOT.x, 'origin dot x (pre)');
    expectWithinPx(before.y, ORIGIN_DOT.y, 'origin dot y (pre)');
    const zoomBefore = await pageZoomState(page);

    await page.mouse.move(ORIGIN_DOT.x, ORIGIN_DOT.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await settle(page);

    // The dot (world origin) stayed under the pointer.
    const after = await originPosition(page);
    expectWithinPx(after.x, ORIGIN_DOT.x, 'origin dot x (post)');
    expectWithinPx(after.y, ORIGIN_DOT.y, 'origin dot y (post)');
    // And the zoom actually changed.
    expect(await zoomLabel(page)).not.toBe('100%');

    // Page zoom never changed.
    const zoomAfter = await pageZoomState(page);
    expect(zoomAfter.scale).toBe(zoomBefore.scale);
    expect(zoomAfter.devicePixelRatio).toBe(zoomBefore.devicePixelRatio);
  });
});

test.describe('navigation.e2e: limits and recovery', () => {
  test('TC-25: clicking Zoom in until disabled ends at the 400% label with a disabled button', async ({ page }) => {
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isDisabled()) {
        break;
      }
      await zoomIn.click();
      await settle(page, 60);
    }

    expect(await zoomLabel(page)).toBe('400%');
    expect(await zoomIn.isDisabled()).toBe(true);
  });

  test('TC-26: from a far camera at max zoom, Reset view returns to 100% with the origin at the viewport centre', async ({ page }) => {
    // Far away (UNBOUNDED_PAN_TESTED_EXTENT) at maximum zoom, via the test hook.
    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4,
    });
    expect(await zoomLabel(page)).toBe('400%');
    const far = await originPosition(page);
    expect(far.x).toBeGreaterThan(UNBOUNDED_PAN_TESTED_EXTENT);
    expect(far.y).toBeGreaterThan(UNBOUNDED_PAN_TESTED_EXTENT);

    await page.getByRole('button', { name: 'Reset view' }).click();
    await settle(page);

    expect(await zoomLabel(page)).toBe('100%');
    const after = await originPosition(page);
    expectWithinPx(after.x, CENTER.x, 'origin x after reset');
    expectWithinPx(after.y, CENTER.y, 'origin y after reset');
  });
});

test.describe('navigation.e2e: far travel', () => {
  test('TC-27: at 1,000,000 units a drag (200,100) is exact and the grid spacing is unchanged', async ({ page }) => {
    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const before = await originPosition(page);
    await drag(page, DRAG_FROM, DRAG_DELTA);
    await settle(page);
    const after = await originPosition(page);

    expectWithinPx(after.x, before.x + DRAG_DELTA.x, 'far origin x');
    expectWithinPx(after.y, before.y + DRAG_DELTA.y, 'far origin y');

    // The grid is still attached to the board at GRID_SPACING_WORLD*zoom px.
    expect(await gridBackgroundSize(page)).toBe(
      `${GRID_SPACING_WORLD * 1}px ${GRID_SPACING_WORLD * 1}px`,
    );
  });
});

test.describe('navigation.e2e: negative', () => {
  test('TC-31: zoom gestures over the board never change the page zoom', async ({ page }) => {
    const before = await pageZoomState(page);

    // Ctrl + wheel in and out over the board.
    await page.mouse.move(CENTER.x, CENTER.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await settle(page);

    // And the keyboard zoom shortcuts.
    for (const key of ['=', '-', '0']) {
      await page.keyboard.down('Control');
      await page.keyboard.press(key);
      await page.keyboard.up('Control');
      await settle(page, 60);
    }

    const after = await pageZoomState(page);
    expect(after.scale).toBe(before.scale);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
  });
});
