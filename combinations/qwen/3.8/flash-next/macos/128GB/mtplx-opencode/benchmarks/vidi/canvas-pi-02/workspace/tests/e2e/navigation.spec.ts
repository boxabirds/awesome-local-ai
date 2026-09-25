import { type Page } from '@playwright/test';
import { expect, test } from './helpers/boardTest';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  board,
  expectWithin,
  markerCentre,
  readCamera,
  readGrid,
  resetViewButton,
  settle,
  setCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers/board';

const HINT_TEXT = 'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

const mod = (value: number, period: number): number =>
  ((value % period) + period) % period;

/** Move the mouse while holding the button down, then let the board render. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  await settle(page);
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 the hint is shown, dismissed by the first drag, and stays gone', async ({
    page,
  }) => {
      const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    expect(await hint.textContent()).toBe(HINT_TEXT);

    await drag(page, 300, 200, 200, 100);
    await expect(hint).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await page.mouse.wheel(0, 120);
    await settle(page);
    await drag(page, 600, 500, -80, -40);
    await expect(hint).toHaveCount(0);

    // A reload shows it again: the view is not remembered anywhere.
    await page.reload();
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
  });

  test('TC-23 a 200x100 drag moves the board exactly 200x100 pixels', async ({
    page,
  }) => {
      await settle(page);

    const cameraBefore = await readCamera(page);
    const markerBefore = await markerCentre(page);
    const gridBefore = await readGrid(page);

    await drag(page, 300, 200, 200, 100);

    // The crosshair (world origin) moved exactly with the pointer.
    expectWithin(await markerCentre(page), {
      x: markerBefore.x + 200,
      y: markerBefore.y + 100,
    });

    // The dot grid moved with the board: same pitch, phase shifted by exactly
    // the drag, so the dot that was under the pointer is now 200px right and
    // 100px down.
    const gridAfter = await readGrid(page);
    const spacing = gridBefore.size.x;
    expect(Math.abs(gridAfter.size.x - spacing)).toBeLessThan(0.01);
    expect(
      Math.abs(gridAfter.position.x - mod(gridBefore.position.x + 200, spacing)),
    ).toBeLessThan(0.5);
    expect(
      Math.abs(gridAfter.position.y - mod(gridBefore.position.y + 100, spacing)),
    ).toBeLessThan(0.5);

    // The camera moved by exactly delta / zoom, with no float drift.
    const cameraAfter = await readCamera(page);
    expect(Math.abs(cameraAfter.x - (cameraBefore.x - 200))).toBeLessThan(1e-9);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y - 100))).toBeLessThan(1e-9);
  });

  test('plain scroll pans the board and never scrolls the page', async ({ page }) => {
      await settle(page);
    const markerBefore = await markerCentre(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 500);
    await settle(page);

    // Content moves with the wheel: the board origin went 500px up.
    expectWithin(await markerCentre(page), {
      x: markerBefore.x,
      y: markerBefore.y - 500,
    });
    // The page itself has nothing to scroll.
    expect(
      await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
        scale: window.visualViewport?.scale ?? 1,
      })),
    ).toEqual({ x: 0, y: 0, scale: 1 });
  });

  test('TC-24 Ctrl + wheel zooms around the pointer and does not zoom the page', async ({
    page,
  }) => {
      // Put the origin crosshair exactly under the pointer at zoom 1.
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    const pointer = { x: 640, y: 400 };
    await page.mouse.move(pointer.x, pointer.y);
    const viewportBefore = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await settle(page);
    expect((await readCamera(page)).zoom).toBeGreaterThan(1);
    expectWithin(await markerCentre(page), pointer);

    await page.mouse.wheel(0, 240);
    await settle(page);
    await page.keyboard.up('Control');
    expectWithin(await markerCentre(page), pointer);

    const viewportAfter = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    expect(viewportAfter).toEqual(viewportBefore);
    expect(viewportAfter.scale).toBe(1);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 zooming in by steps stops at 400% and disables the + button', async ({
    page,
  }) => {
      const plus = zoomInButton(page);
    await expect(plus).toBeEnabled();
    await expect(zoomLabel(page)).toHaveText('100%');

    const labels: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      if (!(await plus.isEnabled())) break;
      await plus.click();
      await settle(page);
      labels.push(await zoomLabel(page).innerText());
    }

    // One step is x1.25: 100% -> 125% -> 156% ...
    expect(labels[0]).toBe('125%');
    expect(labels[1]).toBe('156%');
    expect(labels.at(-1)).toBe('400%');
    expect(labels.length).toBeLessThanOrEqual(10);
    expect(await plus.getAttribute('disabled')).not.toBeNull();
    expect(await plus.isDisabled()).toBe(true);

    // Nothing happens at the limit.
    const camera = await readCamera(page);
    await plus.click({ force: true });
    await settle(page);
    expect(await readCamera(page)).toEqual(camera);

    // Going back the other way re-enables +.
    await zoomOutButton(page).click();
    await settle(page);
    await expect(zoomLabel(page)).not.toHaveText('400%');
    await expect(plus).toBeEnabled();
  });

  test('the zoom-out button disables at 10%', async ({ page }) => {
      const minus = zoomOutButton(page);
    for (let i = 0; i < 40; i += 1) {
      if (!(await minus.isEnabled())) break;
      await minus.click();
      await settle(page);
    }
    await expect(zoomLabel(page)).toHaveText('10%');
    expect(await minus.getAttribute('disabled')).not.toBeNull();
    const camera = await readCamera(page);
    await minus.click({ force: true });
    await settle(page);
    expect(await readCamera(page)).toEqual(camera);
    await zoomInButton(page).click();
    await settle(page);
    await expect(minus).toBeEnabled();
  });

  test('TC-26 Reset view returns to 100% with the start point centred', async ({
    page,
  }) => {
      await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4,
    });
    await expect(zoomLabel(page)).toHaveText('400%');

    await resetViewButton(page).click();
    await settle(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    const size = page.viewportSize();
    if (!size) throw new Error('no viewport size');
    expectWithin(await markerCentre(page), {
      x: size.width / 2,
      y: size.height / 2,
    });
    const camera = await readCamera(page);
    expect(camera.zoom).toBe(1);
    expect(Math.abs(camera.x + size.width / 2)).toBeLessThan(1e-6);
    expect(Math.abs(camera.y + size.height / 2)).toBeLessThan(1e-6);
  });

  test('Ctrl + 0 resets the view from the keyboard', async ({ page }) => {
      await setCamera(page, { x: 1234, y: 567, zoom: 3 });
    await page.keyboard.press('Control+Digit0');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    const size = page.viewportSize();
    if (!size) throw new Error('no viewport size');
    expectWithin(await markerCentre(page), {
      x: size.width / 2,
      y: size.height / 2,
    });
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 a million units out the grid keeps its pitch and panning stays exact', async ({
    page,
  }) => {
      const zoom = ZOOM_STEP_FACTOR;
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom,
    });

    const gridBefore = await readGrid(page);
    const pitch = GRID_SPACING_WORLD * zoom;
    expect(Math.abs(gridBefore.size.x - pitch)).toBeLessThan(0.01);
    expect(Math.abs(gridBefore.size.y - pitch)).toBeLessThan(0.01);

    const cameraBefore = await readCamera(page);
    await drag(page, 400, 400, 200, 100);
    const cameraAfter = await readCamera(page);
    const gridAfter = await readGrid(page);

    // Panning follows the pointer exactly: 200/100 screen px is 200/zoom and
    // 100/zoom world units, with no precision loss a million units out.
    expect(Math.abs(cameraAfter.x - (cameraBefore.x - 200 / zoom))).toBeLessThan(1e-6);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y - 100 / zoom))).toBeLessThan(1e-6);
    expect(Math.abs(cameraAfter.zoom - zoom)).toBeLessThan(1e-12);

    // The grid is still evenly spaced and still attached to the board.
    expect(Math.abs(gridAfter.size.x - pitch)).toBeLessThan(0.01);
    expect(
      Math.abs(gridAfter.position.x - mod(gridBefore.position.x + 200, pitch)),
    ).toBeLessThan(0.5);
    expect(
      Math.abs(gridAfter.position.y - mod(gridBefore.position.y + 100, pitch)),
    ).toBeLessThan(0.5);
  });

  test('a click without movement leaves the view alone', async ({ page }) => {
      await settle(page);
    const before = await readCamera(page);
    await page.mouse.click(500, 300);
    await settle(page);
    expect(await readCamera(page)).toEqual(before);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
  });
});

test.describe('negative: board gestures do not zoom the page (TC-31)', () => {
  test('Ctrl/Cmd gestures and shortcuts over the board leave page zoom alone', async ({
    page,
  }) => {
      const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      labelHeight: document
        .querySelector('[data-testid="zoom-label"]')!
        .getBoundingClientRect().height,
    }));

    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await settle(page);
    // A big single wheel event jumps to the clamp (exp sensitivity, design
    // D1): the board did zoom, so the negative result below is not vacuous.
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.mouse.wheel(0, 300);
    await settle(page);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('400%');

    // Reset, then exercise the three shortcuts from a known zoom.
    await page.keyboard.press('Control+Digit0');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    await page.keyboard.press('Control+Equal');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+Minus');
    await settle(page);
    await page.keyboard.press('Meta+Digit0');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      labelHeight: document
        .querySelector('[data-testid="zoom-label"]')!
        .getBoundingClientRect().height,
    }));
    expect(after).toEqual(before);
    expect(after.scale).toBe(1);
  });

  test('TC-30 Ctrl + wheel over the zoom control does not zoom the board', async ({
    page,
  }) => {
      const controls = page.getByTestId('zoom-controls');
    await controls.hover();
    const cameraBefore = await readCamera(page);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await settle(page);
    await page.keyboard.up('Control');
    expect(await readCamera(page)).toEqual(cameraBefore);
    // The board viewport is the only surface that swallows wheel events.
    expect(await board(page).getAttribute('data-camera')).toBe(
      `${cameraBefore.x},${cameraBefore.y},${cameraBefore.zoom}`,
    );
  });
});
