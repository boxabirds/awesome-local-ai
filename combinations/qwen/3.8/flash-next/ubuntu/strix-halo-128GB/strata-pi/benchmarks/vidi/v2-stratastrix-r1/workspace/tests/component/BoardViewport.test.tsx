import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../src/shared/config';
import { resetCamera, screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import {
  camera,
  hint,
  originMarker,
  renderBoard,
  resetButton,
  settled,
  VIEWPORT_SIZE,
  viewport,
  world,
  worldTransform,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers';

const start = () => resetCamera(VIEWPORT_SIZE);

beforeEach(() => {
  renderBoard();
});

function dragBy(dx: number, dy: number, from = { x: 300, y: 200 }): void {
  fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: from.x, clientY: from.y, button: 0 });
  fireEvent.pointerMove(viewport(), {
    pointerId: 1,
    clientX: from.x + dx,
    clientY: from.y + dy,
  });
  fireEvent.pointerUp(viewport(), {
    pointerId: 1,
    clientX: from.x + dx,
    clientY: from.y + dy,
  });
}

describe('BoardViewport: pan by dragging', () => {
  // TC-13
  it('TC-13: moves the board by exactly the pointer delta and runs Idle -> Panning -> Idle', async () => {
    const before = camera();
    expect(viewport().dataset.interactionMode).toBe('idle');

    fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    expect(viewport().dataset.interactionMode).toBe('panning');
    expect(viewport().className).toContain('is-panning');

    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 500, clientY: 300 });
    await settled();

    const after = camera();
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 6);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 6);
    // The world layer transform matches the camera, so every board point - a grid
    // dot included - moved 200 px right and 100 px down.
    expect(worldTransform()).toEqual({ zoom: after.zoom, x: -after.x, y: -after.y });
    const dotBefore = worldToScreen(before, { x: 0, y: 0 });
    const dotAfter = worldToScreen(after, { x: 0, y: 0 });
    expect(dotAfter.x - dotBefore.x).toBeCloseTo(200, 6);
    expect(dotAfter.y - dotBefore.y).toBeCloseTo(100, 6);

    fireEvent.pointerUp(viewport(), { pointerId: 1, clientX: 500, clientY: 300 });
    expect(viewport().dataset.interactionMode).toBe('idle');
    expect(viewport().className).not.toContain('is-panning');
  });

  it('moves a fraction of a pixel exactly, with no rounding anywhere', async () => {
    const before = camera();

    fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 301.5, clientY: 300.5 });
    await settled();

    const after = camera();
    expect(after.x).toBeCloseTo(before.x - 1.5 / before.zoom, 9);
    expect(after.y).toBeCloseTo(before.y - 0.5 / before.zoom, 9);
    // The CSS transform carries the unrounded translation.
    expect(world().style.transform).toContain(`${-after.x}px, ${-after.y}px`);

    fireEvent.pointerUp(viewport(), { pointerId: 1, clientX: 301.5, clientY: 300.5 });
  });

  it('ends the drag on lostpointercapture and keeps the camera where it was', async () => {
    fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 150, clientY: 120 });
    await settled();
    const during = camera();

    fireEvent.lostPointerCapture(viewport(), { pointerId: 1 });
    expect(viewport().dataset.interactionMode).toBe('idle');

    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 400, clientY: 400 });
    await settled();
    expect(camera()).toEqual(during);
  });

  it('only starts a drag on empty board space, not on board content', async () => {
    const before = camera();
    fireEvent.pointerDown(world(), { pointerId: 2, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(world(), { pointerId: 2, clientX: 300, clientY: 300 });
    await settled();

    expect(viewport().dataset.interactionMode).toBe('idle');
    expect(camera()).toBe(before);
  });

  // TC-14
  it('TC-14: a cancelled drag freezes the camera and later moves are ignored', async () => {
    fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 260, clientY: 230 });
    await settled();
    const atCancel = camera();

    fireEvent.pointerCancel(viewport(), { pointerId: 1 });
    expect(viewport().dataset.interactionMode).toBe('idle');

    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 900, clientY: 900 });
    await settled();
    expect(camera()).toEqual(atCancel);
  });

  // TC-29
  it('TC-29: a click without moving leaves the camera alone and keeps the hint', async () => {
    const before = camera();
    expect(hint()).not.toBeNull();

    fireEvent.pointerDown(viewport(), { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerUp(viewport(), { pointerId: 1, clientX: 300, clientY: 300 });
    await settled();

    expect(camera()).toBe(before);
    expect(hint()).not.toBeNull();
  });
});

describe('BoardViewport: pan and zoom with the wheel', () => {
  // TC-15
  it('TC-15: a plain scroll moves the board with the scroll and is not passed on', async () => {
    const before = camera();
    const notPrevented = fireEvent.wheel(viewport(), { deltaX: 0, deltaY: 100 });
    await settled();

    expect(notPrevented).toBe(false);
    const after = camera();
    expect(after.y - before.y).toBeCloseTo(100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);

    // Scrolling right moves content left; the camera goes the other way.
    const beforeX = camera();
    fireEvent.wheel(viewport(), { deltaX: 60, deltaY: 0 });
    await settled();
    expect(camera().x - beforeX.x).toBeCloseTo(60 / beforeX.zoom, 6);
  });

  // TC-16
  it('TC-16: a Ctrl+wheel zooms around the pointer and is not passed on', async () => {
    const before = camera();
    const point = { x: 300, y: 200 };

    const notPrevented = fireEvent.wheel(viewport(), {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      clientX: point.x,
      clientY: point.y,
    });
    await settled();

    expect(notPrevented).toBe(false);
    const after = camera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 6);
    // The board location under the pointer did not move.
    const worldPoint = screenToWorld(before, point);
    expect(worldToScreen(after, worldPoint).x).toBeCloseTo(point.x, 6);
    expect(worldToScreen(after, worldPoint).y).toBeCloseTo(point.y, 6);
  });

  it('clamps a Ctrl+wheel zoom to ZOOM_MAX and leaves the camera alone at the limit', async () => {
    let zoom = ZOOM_DEFAULT;
    for (let i = 0; i < 40; i += 1) {
      fireEvent.wheel(viewport(), { deltaY: -1000, ctrlKey: true, clientX: 640, clientY: 400 });
      await settled();
      zoom = camera().zoom;
    }
    expect(zoom).toBe(ZOOM_MAX);

    const atLimit = camera();
    fireEvent.wheel(viewport(), { deltaY: -1000, ctrlKey: true, clientX: 640, clientY: 400 });
    await settled();
    expect(camera()).toBe(atLimit);
  });
});

describe('BoardViewport: Safari pinch gestures', () => {
  // TC-17
  it('TC-17: gesturechange doubles the zoom and is not passed to the browser', async () => {
    const before = camera();

    const gesture = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(gesture, 'scale', { value: 2 });
    Object.defineProperty(gesture, 'clientX', { value: 400 });
    Object.defineProperty(gesture, 'clientY', { value: 250 });

    const notPrevented = viewport().dispatchEvent(gesture);
    await settled();

    expect(notPrevented).toBe(false);
    const after = camera();
    expect(after.zoom).toBeCloseTo(before.zoom * 2, 6);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);

    const worldPoint = screenToWorld(before, { x: 400, y: 250 });
    expect(worldToScreen(after, worldPoint).x).toBeCloseTo(400, 6);
    expect(worldToScreen(after, worldPoint).y).toBeCloseTo(250, 6);
  });

  it('tracks a gesture relative to where it started', async () => {
    const before = camera();

    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'scale', { value: 1 });
    viewport().dispatchEvent(start);

    for (const scale of [1.2, 1.5]) {
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.defineProperty(change, 'scale', { value: scale });
      Object.defineProperty(change, 'clientX', { value: 100 });
      Object.defineProperty(change, 'clientY', { value: 100 });
      viewport().dispatchEvent(change);
      await settled();
    }

    // The last event of the gesture sets the zoom: 1.5x the camera as it was
    // when the fingers went down, not 1.2 * 1.5.
    expect(camera().zoom).toBeCloseTo(before.zoom * 1.5, 6);

    const end = new Event('gestureend', { bubbles: true, cancelable: true });
    viewport().dispatchEvent(end);
    await settled();
  });
});

describe('BoardViewport: keyboard shortcuts', () => {
  // TC-18
  it('TC-18: Ctrl/Cmd + = then - steps the zoom, Ctrl/Cmd + 0 resets, all prevented', async () => {
    const before = camera();
    expect(before.zoom).toBe(ZOOM_DEFAULT);

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true, code: 'Equal' })).toBe(false);
    await settled();
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomLabel().textContent).toBe(
      `${Math.round(ZOOM_STEP_FACTOR * 100)}%`,
    );

    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true, code: 'Minus' })).toBe(false);
    await settled();
    expect(camera().zoom).toBe(ZOOM_DEFAULT);

    dragBy(300, 200);
    await settled();
    const panned = camera();
    expect(panned.x).not.toBe(before.x);

    expect(fireEvent.keyDown(window, { key: '0', metaKey: true, code: 'Digit0' })).toBe(false);
    await settled();
    expect(camera()).toEqual(start());
  });

  // TC-30
  it('TC-30: a Ctrl+wheel over the zoom control does not zoom the board and keeps the browser default', async () => {
    const before = camera();
    const controls = document.querySelector('[data-testid="zoom-controls"]')!;

    // The board does not receive the event at all, so the browser is free to
    // zoom the page there.
    expect(fireEvent.wheel(controls, { deltaY: -100, ctrlKey: true })).toBe(true);
    await settled();

    expect(camera()).toBe(before);
    expect(zoomLabel().textContent).toBe('100%');
  });

  it('ignores keystrokes that are not the board shortcuts', async () => {
    const before = camera();
    expect(fireEvent.keyDown(window, { key: '=', code: 'Equal' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: false })).toBe(true);
    await settled();
    expect(camera()).toBe(before);
  });

  it('steps the zoom around the centre of the board area', async () => {
    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const before = camera();
    const centreWorld = screenToWorld(before, centre);

    fireEvent.keyDown(window, { key: '=', ctrlKey: true, code: 'Equal' });
    await settled();

    const after = screenToWorld(camera(), centre);
    expect(after.x).toBeCloseTo(centreWorld.x, 6);
    expect(after.y).toBeCloseTo(centreWorld.y, 6);
  });
});

describe('BoardViewport: zoom control wired to the camera', () => {
  it('steps to ZOOM_MAX, disables Zoom in, and Reset view returns to a centred 100%', async () => {
    expect(zoomLabel().textContent).toBe('100%');

    for (let i = 0; i < 20; i += 1) {
      if (zoomInButton().disabled) break;
      fireEvent.click(zoomInButton());
      await settled();
    }
    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
    expect(zoomLabel().textContent).toBe('400%');
    expect(camera().zoom).toBe(ZOOM_MAX);

    // Pan away, then reset.
    dragBy(240, 160);
    await settled();
    expect(camera().x).not.toBe(start().x);

    fireEvent.click(resetButton());
    await settled();
    expect(camera()).toEqual(start());
    expect(zoomLabel().textContent).toBe('100%');
    expect(zoomInButton().disabled).toBe(false);
    expect(zoomOutButton().disabled).toBe(false);
  });
});

describe('BoardViewport: dot grid and origin marker', () => {
  it('draws the grid from the camera so it stays attached to the board', async () => {
    dragBy(200, 100);
    await settled();

    const after = camera();
    const cell = GRID_SPACING_WORLD * after.zoom;
    expect(viewport().style.backgroundSize).toBe(`${cell}px ${cell}px`);

    const [positionX, positionY] = viewport().style.backgroundPosition
      .split(' ')
      .map((value) => Number.parseFloat(value));
    const modulo = (value: number) => ((value % cell) + cell) % cell;
    expect(positionX).toBeCloseTo(modulo(-after.x * after.zoom) - cell / 2, 4);
    expect(positionY).toBeCloseTo(modulo(-after.y * after.zoom) - cell / 2, 4);

    // The world layer carries the camera transform, and the board's starting
    // point - where a grid dot always sits - is rendered inside it.
    expect(worldTransform()).toEqual({ zoom: after.zoom, x: -after.x, y: -after.y });
    expect(originMarker()).not.toBeNull();
  });
});
