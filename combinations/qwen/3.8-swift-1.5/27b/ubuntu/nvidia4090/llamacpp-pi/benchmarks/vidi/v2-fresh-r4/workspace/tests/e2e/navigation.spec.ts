import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import {
  gridSpacingPx,
  originMarkerCenter,
  settle,
  setCamera,
  zoomLabel,
} from './helpers/board';
import { createBoardViaApi } from './helpers/participants';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const VIEWPORT_CENTER = { x: 640, y: 400 }; // 1280x800 fixture

async function drag(page: import('@playwright/test').Page, dx: number, dy: number, from = { x: 100, y: 100 }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

test.describe('story 1: pan and zoom around an infinite board', () => {
  test('workflow 1: first visit — hint, exact drag, pointer-anchored zoom (TC-28, TC-23, TC-24)', async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });

    // TC-28: the first-use hint is visible on load.
    const hint = page.getByText(HINT_TEXT);
    await expect(hint).toBeVisible();

    // TC-23: a real mouse drag moves the board exactly by the pointer delta.
    const before = await originMarkerCenter(page);
    await drag(page, 200, 100);
    const afterDrag = await originMarkerCenter(page);
    expect(Math.abs(afterDrag.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterDrag.y - before.y - 100)).toBeLessThanOrEqual(1);

    // TC-28 (cont.): the hint is gone after the first pan and stays gone.
    await expect(hint).toBeHidden();

    // TC-24: Ctrl+wheel over a grid dot keeps the dot under the pointer.
    const pageScaleBefore = await page.evaluate(() => window.visualViewport?.scale);
    const dotBefore = await originMarkerCenter(page);
    await page.mouse.move(dotBefore.x, dotBefore.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);

    const dotAfter = await originMarkerCenter(page);
    expect(Math.abs(dotAfter.x - dotBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(dotAfter.y - dotBefore.y)).toBeLessThanOrEqual(1);
    // The board zoomed (the pointer-anchored point stayed put, so the zoom is
    // observable in the label) and the page did not zoom.
    expect(await zoomLabel(page)).not.toBe('100%');
    const pageScaleAfter = await page.evaluate(() => window.visualViewport?.scale);
    expect(pageScaleAfter).toBe(pageScaleBefore);
    expect(pageScaleAfter).toBe(1);
    await expect(hint).toBeHidden();
  });

  test('workflow 2: zoom to the limit, then reset (TC-25, TC-26)', async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });

    // TC-25: click + until it is disabled; the label ends at 400%.
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 20; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await settle(page);
    }
    await expect(zoomIn).toBeDisabled();
    expect(await zoomLabel(page)).toBe(`${Math.round(ZOOM_MAX * 100)}%`);

    // TC-26: from far away at 400%, Reset view returns to 100% centred.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await settle(page);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await settle(page);

    expect(await zoomLabel(page)).toBe('100%');
    const origin = await originMarkerCenter(page);
    expect(Math.abs(origin.x - VIEWPORT_CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - VIEWPORT_CENTER.y)).toBeLessThanOrEqual(1);
  });

  test('workflow 3: panning exactly one million units away (TC-27)', async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });

    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    await settle(page);

    const before = await originMarkerCenter(page);
    await drag(page, 200, 100);
    const after = await originMarkerCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // The grid is still evenly spaced: background-size = GRID_SPACING_WORLD * zoom.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * 1, 3);
  });

  test('board gestures never change the page zoom (TC-31)', async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });

    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale,
      dpr: window.devicePixelRatio,
    }));

    // Ctrl+wheel over the board.
    await page.mouse.move(400, 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);

    // Ctrl/Cmd + = / - / 0.
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    await settle(page);

    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale,
      dpr: window.devicePixelRatio,
    }));
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);

    // The board itself did zoom (the gesture affected the board, not the page).
    await page.keyboard.press('Control+=');
    await settle(page);
    expect(await zoomLabel(page)).not.toBe('100%');
  });
});
