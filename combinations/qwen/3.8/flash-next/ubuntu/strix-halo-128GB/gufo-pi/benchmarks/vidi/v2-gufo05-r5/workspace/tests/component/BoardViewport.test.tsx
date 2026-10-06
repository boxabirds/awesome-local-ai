import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  dispatchGesture,
  dispatchKey,
  dispatchWheel,
  getCamera,
  renderBoard,
  runFrames,
} from './helpers';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_LINE_MODE_PIXELS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const pointer = (clientX: number, clientY: number) => ({
  pointerId: 1,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
});

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function worldEl(): HTMLElement {
  return screen.getByTestId('board-world');
}

vi.useFakeTimers();

describe('viewport.input', () => {
  test('TC-13 a pointer drag moves the board by exactly the pointer delta', async () => {
    renderBoard();
    const viewport = viewportEl();
    const start = getCamera();
    expect(viewport.dataset.interactionState).toBe('idle');

    fireEvent.pointerDown(viewport, pointer(400, 300));
    expect(viewport.dataset.interactionState).toBe('panning');

    fireEvent.pointerMove(viewport, pointer(600, 400));
    await runFrames();

    const moved = getCamera();
    expect(Math.abs(moved.x - (start.x - 200))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(moved.y - (start.y - 100))).toBeLessThanOrEqual(1e-9);
    expect(moved.zoom).toBe(start.zoom);

    // the world layer is transformed with the camera, so content follows the pointer
    expect(worldEl().style.transform).toBe(
      `scale(${moved.zoom}) translate(${-moved.x}px, ${-moved.y}px)`,
    );

    fireEvent.pointerUp(viewport, pointer(600, 400));
    expect(viewport.dataset.interactionState).toBe('idle');

    // moving the pointer after release does nothing (state is Idle)
    fireEvent.pointerMove(viewport, pointer(900, 900));
    await runFrames();
    expect(getCamera()).toEqual(moved);
  });

  test('TC-14 a drag interrupted by pointercancel freezes the camera', async () => {
    renderBoard();
    const viewport = viewportEl();

    fireEvent.pointerDown(viewport, pointer(400, 300));
    fireEvent.pointerMove(viewport, pointer(500, 350));
    await runFrames();
    const atCancel = getCamera();

    fireEvent.pointerCancel(viewport, pointer(500, 350));
    expect(viewport.dataset.interactionState).toBe('idle');

    fireEvent.pointerMove(viewport, pointer(900, 900));
    await runFrames();
    expect(getCamera()).toEqual(atCancel);
  });

  test('TC-14b losing pointer capture ends the drag', async () => {
    renderBoard();
    const viewport = viewportEl();

    fireEvent.pointerDown(viewport, pointer(400, 300));
    fireEvent.pointerMove(viewport, pointer(450, 320));
    await runFrames();
    const atLoss = getCamera();

    fireEvent.lostPointerCapture(viewport, pointer(450, 320));
    expect(viewport.dataset.interactionState).toBe('idle');

    fireEvent.pointerMove(viewport, pointer(800, 800));
    await runFrames();
    expect(getCamera()).toEqual(atLoss);
  });

  test('TC-15 a plain wheel scrolls the board and the event is prevented', async () => {
    renderBoard();
    const before = getCamera();

    const event = dispatchWheel(viewportEl(), { deltaY: 100, clientX: 300, clientY: 200 });
    await runFrames();

    expect(event.defaultPrevented).toBe(true);
    const after = getCamera();
    expect(Math.abs(after.y - (before.y + 100 / before.zoom))).toBeLessThanOrEqual(1e-9);
    expect(after.zoom).toBe(before.zoom);
  });

  test('TC-15b wheel deltas in line units are converted to pixels', async () => {
    renderBoard();
    const before = getCamera();

    dispatchWheel(viewportEl(), { deltaY: 3, deltaMode: 1, clientX: 10, clientY: 10 });
    await runFrames();

    const after = getCamera();
    expect(Math.abs(after.y - (before.y + 3 * WHEEL_LINE_MODE_PIXELS / before.zoom))).toBeLessThanOrEqual(1e-9);
  });

  test('TC-15c a horizontal wheel moves the board sideways', async () => {
    renderBoard();
    const before = getCamera();

    dispatchWheel(viewportEl(), { deltaX: 120, clientX: 10, clientY: 10 });
    await runFrames();

    const after = getCamera();
    // scrolling right reveals content further right, so the camera moves right
    expect(Math.abs(after.x - (before.x + 120 / before.zoom))).toBeLessThanOrEqual(1e-9);
  });

  test('TC-16 a Ctrl wheel zooms around the pointer and the event is prevented', async () => {
    renderBoard();
    const before = getCamera();

    const event = dispatchWheel(viewportEl(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    await runFrames();

    expect(event.defaultPrevented).toBe(true);
    const after = getCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
  });

  test('TC-16b a Meta wheel also zooms (macOS)', async () => {
    renderBoard();
    const before = getCamera();

    dispatchWheel(viewportEl(), { deltaY: -100, metaKey: true, clientX: 300, clientY: 200 });
    await runFrames();

    expect(getCamera().zoom).toBeGreaterThan(before.zoom);
  });

  test('TC-17 a Safari gesturechange zooms and the event is prevented', async () => {
    renderBoard();
    const before = getCamera();

    const event = dispatchGesture(viewportEl(), 'gesturechange', 2, { x: 300, y: 200 });
    await runFrames();

    expect(event.defaultPrevented).toBe(true);
    const after = getCamera();
    expect(Math.abs(after.zoom - Math.min(before.zoom * 2, ZOOM_MAX))).toBeLessThanOrEqual(1e-9);
  });

  test('TC-17b a Safari gesture is clamped at ZOOM_MAX', async () => {
    renderBoard();
    const event = dispatchGesture(viewportEl(), 'gesturechange', 100, { x: 100, y: 100 });
    await runFrames();

    expect(event.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBe(ZOOM_MAX);
  });

  test('TC-18 Ctrl/Cmd + = , - and 0 zoom and reset, and are prevented', async () => {
    renderBoard();
    const start = getCamera();

    const inEvent = dispatchKey(window, { key: '=', ctrlKey: true });
    await runFrames();
    expect(inEvent.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);

    const outEvent = dispatchKey(window, { key: '-', ctrlKey: true });
    await runFrames();
    expect(outEvent.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBe(1);

    // pan away first so the reset is observable
    fireEvent.pointerDown(viewportEl(), pointer(400, 300));
    fireEvent.pointerMove(viewportEl(), pointer(700, 500));
    fireEvent.pointerUp(viewportEl(), pointer(700, 500));
    await runFrames();
    expect(getCamera().x).not.toBe(start.x);

    const resetEvent = dispatchKey(window, { key: '0', ctrlKey: true });
    await runFrames();
    expect(resetEvent.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBe(1);
    expect(getCamera().x).toBe(-window.innerWidth / 2);
    expect(getCamera().y).toBe(-window.innerHeight / 2);
  });

  test('TC-18b keyboard zoom keeps the centre of the board area fixed', async () => {
    renderBoard();
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const before = getCamera();
    const centreWorldBefore = {
      x: centre.x / before.zoom + before.x,
      y: centre.y / before.zoom + before.y,
    };

    dispatchKey(window, { key: '=', ctrlKey: true });
    await runFrames();

    const after = getCamera();
    const centreWorldAfter = {
      x: centre.x / after.zoom + after.x,
      y: centre.y / after.zoom + after.y,
    };
    expect(Math.abs(centreWorldAfter.x - centreWorldBefore.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(centreWorldAfter.y - centreWorldBefore.y)).toBeLessThanOrEqual(1e-9);
  });

  test('the dot grid moves and scales with the camera', async () => {
    renderBoard();
    const viewport = viewportEl();
    const start = getCamera();
    expect(viewport.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * start.zoom}px ${GRID_SPACING_WORLD * start.zoom}px`,
    );

    fireEvent.pointerDown(viewport, pointer(100, 100));
    fireEvent.pointerMove(viewport, pointer(124, 100)); // exactly one grid cell at zoom 1
    fireEvent.pointerUp(viewport, pointer(124, 100));
    await runFrames();

    // panning one whole grid cell leaves the grid pattern where it was
    expect(viewport.style.backgroundPosition).toBe(
      computeGridOffset(getCamera(), GRID_SPACING_WORLD * getCamera().zoom),
    );

    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    await runFrames();
    const zoomed = getCamera();
    expect(viewport.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * zoomed.zoom}px ${GRID_SPACING_WORLD * zoomed.zoom}px`,
    );
  });

  test('TC-29 clicking empty space without moving changes nothing', async () => {
    renderBoard();
    const before = getCamera();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    fireEvent.pointerDown(viewportEl(), pointer(400, 300));
    fireEvent.pointerUp(viewportEl(), pointer(400, 300));
    await runFrames();

    expect(getCamera()).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  test('TC-30 Ctrl wheel over the zoom control neither zooms the board nor is prevented', async () => {
    renderBoard();
    const before = getCamera();
    const zoomIn = within(screen.getByTestId('zoom-controls')).getByLabelText('Zoom in');

    const event = dispatchWheel(zoomIn, { deltaY: -240, ctrlKey: true });
    await runFrames();

    expect(event.defaultPrevented).toBe(false);
    expect(getCamera()).toEqual(before);
  });

  test('a pointer gesture over a board object does not pan the board', async () => {
    renderBoard();
    const before = getCamera();

    // later stories put objects with data-board-object inside the world layer
    const world = worldEl();
    const object = document.createElement('div');
    object.setAttribute('data-board-object', 'true');
    object.textContent = 'x';
    world.appendChild(object);

    fireEvent.pointerDown(object, pointer(400, 300));
    fireEvent.pointerMove(object, pointer(600, 400));
    fireEvent.pointerUp(object, pointer(600, 400));
    await runFrames();

    expect(getCamera()).toEqual(before);
  });

  test('panning works far from the start without an edge', async () => {
    renderBoard();
    window.__vidi6?.setCamera({
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await runFrames();
    const start = getCamera();

    fireEvent.pointerDown(viewportEl(), pointer(200, 200));
    fireEvent.pointerMove(viewportEl(), pointer(400, 300));
    fireEvent.pointerUp(viewportEl(), pointer(400, 300));
    await runFrames();

    const after = getCamera();
    expect(Math.abs(after.x - (start.x - 200 / ZOOM_MAX))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(after.y - (start.y - 100 / ZOOM_MAX))).toBeLessThanOrEqual(1e-9);
  });

  test('zoom limits disable further zooming through the wheel', async () => {
    renderBoard();
    for (let i = 0; i < 20; i += 1) {
      dispatchWheel(viewportEl(), { deltaY: -1000, ctrlKey: true, clientX: 10, clientY: 10 });
    }
    await runFrames();
    expect(getCamera().zoom).toBe(ZOOM_MAX);

    const atMax = getCamera();
    dispatchWheel(viewportEl(), { deltaY: -1000, ctrlKey: true, clientX: 10, clientY: 10 });
    await runFrames();
    expect(getCamera()).toEqual(atMax);

    for (let i = 0; i < 40; i += 1) {
      dispatchWheel(viewportEl(), { deltaY: 1000, ctrlKey: true, clientX: 10, clientY: 10 });
    }
    await runFrames();
    expect(getCamera().zoom).toBe(ZOOM_MIN);
  });
});

function computeGridOffset(cam: { x: number; y: number; zoom: number }, spacing: number): string {
  const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;
  return `${mod(-cam.x * cam.zoom, spacing)}px ${mod(-cam.y * cam.zoom, spacing)}px`;
}
