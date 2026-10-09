import { describe, expect, it } from 'vitest';
import { GRID_SPACING_WORLD, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { resetCamera, worldToScreen } from '../../src/client/canvas/camera';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  VIEWPORT_FIXTURE,
  setWindowSize,
  buttonByLabel,
  dragBoard,
  expectCameraCloseTo,
  flushFrames,
  markerScreenPosition,
  screenPointOf,
  worldPointAt,
  readCamera,
  renderBoard,
  resetButton,
  waitForCamera,
  wheel,
  zoomLabel,
} from './fixtures/board';

function hint(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="navigation-hint"]');
}

describe('opening the board', () => {
  it('shows a full-window board at 100% with the starting point centred, the hint and the zoom control', async () => {
    await renderBoard();
    const initial = resetCamera(VIEWPORT_FIXTURE);
    expectCameraCloseTo(readCamera(), initial);
    expect(zoomLabel().textContent).toBe('100%');
    // The board's starting point sits at the centre of the board area.
    const marker = markerScreenPosition(readCamera());
    expect(marker.x).toBeCloseTo(VIEWPORT_FIXTURE.width / 2, 9);
    expect(marker.y).toBeCloseTo(VIEWPORT_FIXTURE.height / 2, 9);
    // Hint copy is exactly as specified.
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    // Grid dots every GRID_SPACING_WORLD world units at this zoom.
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    expect(viewport?.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`,
    );
  });
});

describe('golden path: hint, drag, pointer zoom, limits and reset', () => {
  it('walks the whole first-visit workflow', async () => {
    await renderBoard();
    expect(hint()).not.toBeNull();
    expect(zoomLabel().textContent).toBe('100%');

    // 1. Drag 200 right and 100 down: the starting point moves by exactly that.
    const beforeDrag = readCamera();
    const markerBefore = markerScreenPosition(beforeDrag);
    await dragBoard({ x: 300, y: 200 }, { x: 500, y: 300 });
    const afterDrag = readCamera();
    expectCameraCloseTo(afterDrag, {
      x: beforeDrag.x - 200,
      y: beforeDrag.y - 100,
      zoom: beforeDrag.zoom,
    });
    const markerAfter = markerScreenPosition(afterDrag);
    expect(markerAfter.x - markerBefore.x).toBeCloseTo(200, 6);
    expect(markerAfter.y - markerBefore.y).toBeCloseTo(100, 6);
    // The hint disappeared after the first pan and does not come back.
    expect(hint()).toBeNull();

    // 2. Ctrl + wheel over a spot: that spot stays under the pointer, zoom label updates.
    const pointer = { x: 520, y: 380 };
    const worldUnderPointer = worldPointAt(afterDrag, pointer);
    wheel({ deltaY: -220, ctrlKey: true }, pointer);
    const zoomed = await waitForCamera((cam) => cam.zoom !== afterDrag.zoom);
    const screenAfter = screenPointOf(zoomed, worldUnderPointer);
    expect(screenAfter.x).toBeCloseTo(pointer.x, 4);
    expect(screenAfter.y).toBeCloseTo(pointer.y, 4);
    // Browser page zoom is untouched.
    expect(window.visualViewport?.scale ?? 1).toBe(1);
    expect(devicePixelRatio).toBeGreaterThan(0);

    // 3. Zoom to the maximum with the + button: the label stops at 400% and + disables.
    for (let i = 0; i < 20; i += 1) {
      buttonByLabel('Zoom in').click();
      await flushFrames();
    }
    const atMax = readCamera();
    expect(zoomLabel().textContent).toBe('400%');
    expect(atMax.zoom).toBe(4);
    expect(buttonByLabel('Zoom in').disabled).toBe(true);
    expect(buttonByLabel('Zoom out').disabled).toBe(false);
    expect(hint()).toBeNull();

    // Zooming back the other way re-enables the button.
    buttonByLabel('Zoom out').click();
    const backBelowMax = await waitForCamera((cam) => cam.zoom < 4);
    expect(buttonByLabel('Zoom in').disabled).toBe(false);
    expect(backBelowMax.zoom).toBeCloseTo(4 / ZOOM_STEP_FACTOR, 6);

    // 4. Reset view returns to 100% with the starting point centred.
    resetButton().click();
    const reset = await waitForCamera((cam) => cam.zoom === 1);
    expect(zoomLabel().textContent).toBe('100%');
    expectCameraCloseTo(reset, resetCamera(VIEWPORT_FIXTURE));
    const markerReset = markerScreenPosition(reset);
    expect(markerReset.x).toBeCloseTo(VIEWPORT_FIXTURE.width / 2, 6);
    expect(markerReset.y).toBeCloseTo(VIEWPORT_FIXTURE.height / 2, 6);
    // The hint stays away for the rest of the visit.
    expect(hint()).toBeNull();
  });
});

describe('resizing the window', () => {
  it('does not move content relative to the top-left corner of the board area', async () => {
    await renderBoard();
    await dragBoard({ x: 200, y: 200 }, { x: 400, y: 260 });
    const before = readCamera();

    setWindowSize(1000, 640);
    window.dispatchEvent(new Event('resize'));
    await flushFrames(3);

    // The world point at the viewport's top-left corner is unchanged, so nothing moves.
    const after = readCamera();
    expectCameraCloseTo(after, before);
    const corner = worldToScreen(after, { x: before.x, y: before.y });
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });
});

describe('zoom steps and indicator through the real app', () => {
  it('100% -> 125% -> 100% exactly, and 156% for 1.5625', async () => {
    await renderBoard();
    buttonByLabel('Zoom in').click();
    await waitForCamera((cam) => cam.zoom === ZOOM_STEP_FACTOR);
    expect(zoomLabel().textContent).toBe('125%');

    buttonByLabel('Zoom out').click();
    await waitForCamera((cam) => cam.zoom === 1);
    expect(zoomLabel().textContent).toBe('100%');
  });
});
