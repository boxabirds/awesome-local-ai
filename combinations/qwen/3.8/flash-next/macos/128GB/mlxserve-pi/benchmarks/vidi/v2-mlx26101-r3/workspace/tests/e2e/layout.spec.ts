import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../src/shared/config';
import {
  dragBoard,
  gridLayer,
  isMultipleOf,
  markerCentre,
  openBoard,
  readCamera,
  readGrid,
  scrollBoard,
  settle,
  VIEWPORT,
  zoomInButton,
  zoomNumber,
} from './helpers/board';

/**
 * Page-level behaviour from the design: the board owns the whole window, the controls sit
 * on top of it, and gestures over the controls do not navigate the board.
 */
test.describe('page layout and controls on top', () => {
  test('TC-17: the board fills the window and the page itself never scrolls', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await openBoard(page);

    const box = await page.getByTestId('board-viewport').boundingBox();
    expect(box?.width).toBeCloseTo(VIEWPORT.width, 0);
    expect(box?.height).toBeCloseTo(VIEWPORT.height, 0);

    // No document scrolling and no browser scroll/zoom handling.
    const behaviour = await page.evaluate(() => {
      const viewport = document.querySelector('.board-viewport') as HTMLElement;
      const computed = getComputedStyle(viewport);
      return {
        documentScrolls: document.documentElement.scrollHeight > window.innerHeight,
        overscroll: computed.overscrollBehavior,
        touchAction: computed.touchAction,
      };
    });
    expect(behaviour.documentScrolls).toBe(false);
    expect(behaviour.overscroll).toBe('none');
    expect(behaviour.touchAction).toBe('none');

    // The grid covers the viewport.
    const gridBox = await gridLayer(page).boundingBox();
    expect(gridBox?.width).toBeCloseTo(VIEWPORT.width, 0);
    expect(gridBox?.height).toBeCloseTo(VIEWPORT.height, 0);

    expect(consoleErrors).toEqual([]);
  });

  test('TC-17: wheeling over the zoom controls does not zoom the board', async ({ page }) => {
    await openBoard(page);
    const before = await readCamera(page);
    const button = zoomInButton(page);
    const box = await button.boundingBox();
    const overControls = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };

    await scrollBoard(page, overControls, { y: -240 }, 'Control');
    expect(await readCamera(page)).toEqual(before);

    // The same wheel event on the board does zoom.
    await scrollBoard(page, { x: 640, y: 300 }, { y: -240 }, 'Control');
    expect((await readCamera(page)).zoom).toBeGreaterThan(before.zoom);
  });

  test('dragging away from a control does not pan the board', async ({ page }) => {
    await openBoard(page);
    const before = await readCamera(page);
    const controlsBox = await page.getByTestId('zoom-controls').boundingBox();
    const start = { x: (controlsBox?.x ?? 0) + 10, y: (controlsBox?.y ?? 0) + 10 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 4 });
    await page.mouse.up();
    await settle(page);

    expect(await readCamera(page)).toEqual(before);

    // The same gesture starting on the board surface does pan.
    await dragBoard(page, { x: 600, y: 300 }, { x: 500, y: 200 });
    expect((await readCamera(page)).x).toBeCloseTo(before.x + 100, 3);
  });

  test('TC-16: the controls stay the same size on screen while the board zooms', async ({
    page,
  }) => {
    await openBoard(page);
    const markerAt = await markerCentre(page);
    const before = await page.getByTestId('zoom-controls').boundingBox();

    await scrollBoard(page, markerAt, { y: -300 }, 'Control');
    const zoom = (await zoomNumber(page)) / 100;
    expect(zoom).toBeGreaterThan(1);
    const after = await page.getByTestId('zoom-controls').boundingBox();
    expect(after?.height).toBeCloseTo(before?.height ?? 0, 1);
    expect((await readGrid(page)).spacing).toBeCloseTo(GRID_SPACING_WORLD * zoom, 1);
  });

  test('the marker is centred on load and the hint sits inside the window', async ({ page }) => {
    await openBoard(page);
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(1);

    const hintBox = await page.getByTestId('navigation-hint').boundingBox();
    expect(hintBox).not.toBeNull();
    expect((hintBox?.y ?? 0) + (hintBox?.height ?? 0)).toBeLessThanOrEqual(VIEWPORT.height + 1);

    // The hint never blocks the board: a drag that starts over it still pans.
    const before = await readCamera(page);
    await dragBoard(
      page,
      { x: (hintBox?.x ?? 0) + 10, y: (hintBox?.y ?? 0) + 10 },
      { x: 400, y: 400 },
    );
    expect((await readCamera(page)).x).not.toBe(before.x);
  });

  test('the dot grid stays aligned with world grid lines', async ({ page }) => {
    await openBoard(page);

    // Dots repeat every tile with the dot in the middle of the tile, so a dot must sit
    // exactly on the screen position of the world origin (the marker centre). Checked
    // after real interactions, at several zoom levels and offsets.
    const expectAligned = async (): Promise<void> => {
      const centre = await markerCentre(page);
      const grid = await readGrid(page);
      const camera = await readCamera(page);
      const spacing = grid.spacing;
      expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * camera.zoom, 1);
      expect(isMultipleOf(centre.x - grid.x - spacing / 2, spacing, 0.02)).toBe(true);
      expect(isMultipleOf(centre.y - grid.y - spacing / 2, spacing, 0.02)).toBe(true);
    };

    await expectAligned();
    await zoomInButton(page).click();
    await settle(page);
    await expectAligned();
    await zoomInButton(page).click();
    await settle(page);
    await expectAligned();
    expect(await zoomNumber(page)).toBe(156);

    // A pointer zoom and a pan change both the spacing and the offset.
    await scrollBoard(page, { x: 300, y: 250 }, { y: -120 }, 'Control');
    await expectAligned();
    await dragBoard(page, { x: 500, y: 500 }, { x: 330, y: 610 });
    await expectAligned();
  });

  test('a window resize does not move content relative to the top-left corner', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await markerCentre(page);
    const cameraBefore = await readCamera(page);

    await page.setViewportSize({ width: 1000, height: 600 });
    await settle(page);

    // Camera (which is the board's top-left corner) is untouched, so nothing moved.
    expect(await readCamera(page)).toEqual(cameraBefore);
    const after = await markerCentre(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('the cursor shows a grabbing hand while dragging', async ({ page }) => {
    const viewport = page.getByTestId('board-viewport');
    const cursor = async (): Promise<string> =>
      viewport.evaluate((element) => getComputedStyle(element).cursor);

    await openBoard(page);
    expect(await cursor()).toBe('grab');

    await page.mouse.move(400, 300);
    await page.mouse.down();
    expect(await cursor()).toBe('grabbing');
    await page.mouse.move(520, 410, { steps: 3 });
    expect(await cursor()).toBe('grabbing');
    await page.mouse.up();
    await settle(page);
    expect(await cursor()).toBe('grab');
  });

  test('zooming with the buttons keeps the viewport centre fixed', async ({ page }) => {
    await openBoard(page);
    const centreBefore = await markerCentre(page);

    await zoomInButton(page).click();
    await settle(page);

    const centreAfter = await markerCentre(page);
    expect(Math.abs(centreAfter.x - centreBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreAfter.y - centreBefore.y)).toBeLessThanOrEqual(1);
  });
});
