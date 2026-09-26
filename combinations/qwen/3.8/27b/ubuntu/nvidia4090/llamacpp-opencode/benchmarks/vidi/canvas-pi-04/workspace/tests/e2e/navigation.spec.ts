import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  expectCenterWithin,
  gridBackground,
  originCenter,
  pageZoom,
  setCamera,
  zoomLabel,
} from './helpers/board';

/** a mod b for possibly negative a, result in [0, b). */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

test.describe('story 1: pan and zoom around an infinite board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('workflow 1: first visit navigation (TC-28, TC-23, TC-24)', async ({ page }) => {
    // TC-28: the first-use hint is visible on first visit.
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
    expect(await page.getByTestId('navigation-hint').textContent()).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    const before = await originCenter(page);
    // The origin starts at the centre of the 1280x800 viewport.
    expect(Math.abs(before.x - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.y - 400)).toBeLessThanOrEqual(1);

    // TC-23: drag (200, 100). The origin marker moves exactly (200, 100);
    // the dot lattice shifts by (200, 100) modulo its period.
    const gridBefore = await gridBackground(page);
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 100, { steps: 8 });
    await page.mouse.up();

    const after = await originCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    const gridAfter = await gridBackground(page);
    // At zoom 1 the spacing is GRID_SPACING_WORLD px.
    expect(gridAfter.sizeX).toBeCloseTo(GRID_SPACING_WORLD, 6);
    const spacing = GRID_SPACING_WORLD;
    expect(mod(gridAfter.posX - gridBefore.posX, spacing)).toBeCloseTo(
      mod(200, spacing),
      6,
    );
    expect(mod(gridAfter.posY - gridBefore.posY, spacing)).toBeCloseTo(
      mod(100, spacing),
      6,
    );

    // TC-28 (continued): the hint is hidden after the first camera change.
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);

    // TC-24: Ctrl+scroll at the pointer keeps the dot (origin) under the
    // pointer, and never changes the page zoom.
    const pointer = after;
    const zoomBefore = await pageZoom(page);
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // The board must actually have zoomed, with the dot still under the pointer.
    await expect(page.getByTestId('zoom-label')).not.toHaveText('100%');
    await expectCenterWithin(page, pointer.x, pointer.y);

    const zoomAfter = await pageZoom(page);
    expect(zoomAfter.scale).toBe(zoomBefore.scale);
    expect(zoomAfter.dpr).toBe(zoomBefore.dpr);
  });

  test('workflow 2: limits and recovery (TC-25, TC-26)', async ({ page }) => {
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });

    // TC-25: zoom in until the control is disabled; the label reaches 400%.
    // Each click is committed on the next animation frame, so wait for the
    // controls to settle after every click before deciding the next step.
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isDisabled()) break;
      const prevLabel = await zoomLabel(page);
      await zoomIn.click();
      await expect
        .poll(
          async () =>
            (await zoomLabel(page)) !== prevLabel ||
            (await zoomIn.getAttribute('disabled')) !== null,
          { timeout: 3000, message: 'zoom controls settle after click' },
        )
        .toBe(true);
    }
    await expect(zoomIn).toBeDisabled();
    await expect(page.getByTestId('zoom-label')).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);

    // TC-26: jump far away at 400% via the test hook, then reset.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await page.getByRole('button', { name: 'Reset view' }).click();

    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    await expectCenterWithin(page, 640, 400);
  });

  test('workflow 3: far travel (TC-27)', async ({ page }) => {
    // Start a million world units away.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const before = await originCenter(page);
    // It really is off-screen.
    expect(before.x).toBeLessThan(-100_000);
    expect(before.y).toBeLessThan(-100_000);

    // A drag moves the view by exactly (200, 100) even from so far away.
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 8 });
    await page.mouse.up();

    const after = await originCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // Computed grid spacing equals GRID_SPACING_WORLD * zoom.
    const grid = await gridBackground(page);
    expect(grid.sizeX).toBeCloseTo(GRID_SPACING_WORLD * 1, 6);
    expect(grid.sizeY).toBeCloseTo(GRID_SPACING_WORLD * 1, 6);
  });

  test('TC-31 board gestures never change the page zoom', async ({ page }) => {
    const before = await pageZoom(page);

    // Ctrl+wheel over the board.
    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');

    // Keyboard shortcuts (which also prove the gestures reached the board).
    await page.keyboard.press('Control+=');
    await expect(page.getByTestId('zoom-label')).toHaveText('125%');
    await page.keyboard.press('Control+-');
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    await page.keyboard.press('Control+0');

    const after = await pageZoom(page);
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
  });
});
