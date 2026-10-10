import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  canZoomIn,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../../src/client/canvas/camera';
import { GRID_SPACING_WORLD, ZOOM_MAX } from '../../src/shared/config';
import {
  dispatchGesture,
  dispatchKey,
  dispatchWheel,
  flushFrame,
  hintElement,
  isPanning,
  pointerEvent,
  readCamera,
  readGrid,
  renderBoard,
  VIEWPORT_SIZE,
  viewportElement,
  worldElement,
  zoomLabel,
} from './helpers/board';
import { pointerCaptureRecorder } from './helpers/shims';

const DRAG = { x: 200, y: 100 };
const POINTER: { x: number; y: number } = { x: 300, y: 200 };

afterEach(() => {
  cleanup();
  pointerCaptureRecorder.reset();
});

describe('BoardViewport: pan by dragging (TC-13)', () => {
  it('moves the board by exactly the pointer distance and returns to idle', async () => {
    renderBoard();
    const before = readCamera();
    expect(before.zoom).toBe(1);
    expect(isPanning()).toBe(false);

    pointerEvent('pointerDown', viewportElement(), { x: 100, y: 50 });
    expect(isPanning()).toBe(true);
    expect(pointerCaptureRecorder.capturedPointerIds).toContain(1);

    pointerEvent('pointerMove', viewportElement(), { x: 100 + DRAG.x, y: 50 + DRAG.y });
    pointerEvent('pointerUp', viewportElement(), { x: 100 + DRAG.x, y: 50 + DRAG.y });
    expect(isPanning()).toBe(false);

    await flushFrame();

    const after = readCamera();
    const expected = panBy(before, DRAG.x, DRAG.y);
    expect(after.x).toBeCloseTo(expected.x, 9);
    expect(after.y).toBeCloseTo(expected.y, 9);
    expect(after.zoom).toBe(expected.zoom);

    // The rendered world-layer transform is derived from the camera.
    expect(normalise(worldElement().style.transform)).toBe(
      normalise(`scale(${expected.zoom}) translate(${-expected.x}px, ${-expected.y}px)`),
    );
  });

  it('keeps the dot grid attached to the board while panning', async () => {
    renderBoard();
    const before = readGrid();
    expect(before.spacing).toBeCloseTo(GRID_SPACING_WORLD, 9);

    pointerEvent('pointerDown', viewportElement(), { x: 10, y: 10 });
    pointerEvent('pointerMove', viewportElement(), { x: 10 + DRAG.x, y: 10 + DRAG.y });
    pointerEvent('pointerUp', viewportElement(), { x: 10 + DRAG.x, y: 10 + DRAG.y });
    await flushFrame();

    const after = readGrid();
    expect(after.spacing).toBeCloseTo(before.spacing, 9);
    // The dots moved with the board: the offset advanced by the drag distance,
    // modulo the tile size.
    expect(wrap(after.offsetX - before.offsetX, before.spacing)).toBeCloseTo(
      wrap(DRAG.x, before.spacing),
      6,
    );
    expect(wrap(after.offsetY - before.offsetY, before.spacing)).toBeCloseTo(
      wrap(DRAG.y, before.spacing),
      6,
    );
  });
});

describe('BoardViewport: interrupted drag (TC-14)', () => {
  it('freezes the camera at the point of cancellation and ignores later moves', async () => {
    renderBoard();

    pointerEvent('pointerDown', viewportElement(), { x: 0, y: 0 });
    pointerEvent('pointerMove', viewportElement(), { x: DRAG.x, y: DRAG.y });
    await flushFrame();
    const atCancel = readCamera();

    pointerEvent('pointerCancel', viewportElement(), { x: DRAG.x, y: DRAG.y });
    expect(isPanning()).toBe(false);

    pointerEvent('pointerMove', viewportElement(), { x: DRAG.x + 500, y: DRAG.y + 500 });
    await flushFrame();

    expect(readCamera()).toEqual(atCancel);
  });

  it('ends the drag on lostpointercapture', async () => {
    renderBoard();
    pointerEvent('pointerDown', viewportElement(), { x: 0, y: 0 });
    fireEvent.lostPointerCapture(viewportElement(), { pointerId: 1 });
    expect(isPanning()).toBe(false);
    pointerEvent('pointerMove', viewportElement(), { x: 300, y: 300 });
    await flushFrame();
    const afterLost = readCamera();
    pointerEvent('pointerMove', viewportElement(), { x: 900, y: 900 });
    await flushFrame();
    expect(readCamera()).toEqual(afterLost);
  });
});

describe('BoardViewport: pan by scrolling (TC-15)', () => {
  it('moves the board with a plain wheel event and cancels the page scroll', async () => {
    renderBoard();
    const before = readCamera();

    const event = dispatchWheel(viewportElement(), { deltaY: 100 });
    expect(event.defaultPrevented).toBe(true);
    await flushFrame();

    const after = readCamera();
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
  });

  it('moves the board sideways with a horizontal wheel/trackpad scroll', async () => {
    renderBoard();
    const before = readCamera();

    dispatchWheel(viewportElement(), { deltaX: 60 });
    await flushFrame();

    expect(readCamera().x).toBeCloseTo(before.x + 60 / before.zoom, 9);
  });

  it('converts LINE and PAGE delta modes to pixels', async () => {
    renderBoard();
    const before = readCamera();

    dispatchWheel(viewportElement(), { deltaY: 2, deltaMode: 1 });
    await flushFrame();

    const linePixels = readCamera().y - before.y;
    expect(linePixels).toBeGreaterThan(0);

    dispatchWheel(viewportElement(), { deltaY: 2, deltaMode: 2 });
    await flushFrame();
    const pagePixels = readCamera().y - before.y - linePixels;
    expect(pagePixels).toBeGreaterThan(linePixels);
  });
});

describe('BoardViewport: zoom around the pointer (TC-16)', () => {
  it('zooms with a Ctrl + wheel and keeps the board location under the pointer', async () => {
    renderBoard();
    const before = readCamera();

    const event = dispatchWheel(viewportElement(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: POINTER.x,
      clientY: POINTER.y,
    });
    expect(event.defaultPrevented).toBe(true);
    await flushFrame();

    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);

    // The same board location is still at the same screen position.
    const underPointer = screenToWorld(before, POINTER);
    const stillOnScreen = worldToScreen(after, underPointer);
    expect(stillOnScreen.x).toBeCloseTo(POINTER.x, 4);
    expect(stillOnScreen.y).toBeCloseTo(POINTER.y, 4);
  });

  it('zooms with Cmd + wheel too (macOS pinch)', async () => {
    renderBoard();
    const before = readCamera();
    dispatchWheel(viewportElement(), { deltaY: -50, metaKey: true });
    await flushFrame();
    expect(readCamera().zoom).toBeGreaterThan(before.zoom);
  });

  it('clamps a Ctrl + wheel burst to the zoom limits', async () => {
    renderBoard();
    dispatchWheel(viewportElement(), { deltaY: -10_000, ctrlKey: true });
    await flushFrame();
    expect(readCamera().zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(readCamera())).toBe(false);
    expect(zoomLabel()).toBe('400%');
  });
});

describe('BoardViewport: Safari gestures (TC-17)', () => {
  it('zooms by the gesture scale ratio and cancels the browser gesture', async () => {
    renderBoard();
    const before = readCamera();

    const start = dispatchGesture(viewportElement(), 'gesturestart', { scale: 1 });
    expect(start.defaultPrevented).toBe(true);
    const change = dispatchGesture(viewportElement(), 'gesturechange', {
      scale: 2,
      clientX: POINTER.x,
      clientY: POINTER.y,
    });
    expect(change.defaultPrevented).toBe(true);
    await flushFrame();

    const after = readCamera();
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 9);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
  });
});

describe('BoardViewport: keyboard shortcuts (TC-18)', () => {
  it('zooms one step with Ctrl + = and Ctrl + -, and resets with Ctrl + 0', async () => {
    renderBoard();
    const start = readCamera();
    expect(start.zoom).toBe(1);

    const zoomIn = dispatchKey({ key: '=', ctrlKey: true });
    expect(zoomIn.defaultPrevented).toBe(true);
    await flushFrame();
    expect(zoomLabel()).toBe('125%');

    const zoomOut = dispatchKey({ key: '-', ctrlKey: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    await flushFrame();
    expect(zoomLabel()).toBe('100%');

    const resetKey = dispatchKey({ key: '0', ctrlKey: true });
    expect(resetKey.defaultPrevented).toBe(true);
    await flushFrame();
    expect(zoomLabel()).toBe('100%');
    expect(readCamera()).toEqual({
      x: -VIEWPORT_SIZE.width / 2,
      y: -VIEWPORT_SIZE.height / 2,
      zoom: 1,
    });
  });

  it('zooms around the centre of the board area (zoom.step)', async () => {
    renderBoard();
    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const before = readCamera();

    dispatchKey({ key: '=', ctrlKey: true });
    await flushFrame();
    const after = readCamera();

    const expected = zoomAt(before, centre, 1.25);
    expect(after.x).toBeCloseTo(expected.x, 9);
    expect(after.y).toBeCloseTo(expected.y, 9);
  });

  it('leaves editable targets alone so later object stories can type', async () => {
    renderBoard();
    const input = document.createElement('input');
    document.body.append(input);
    const before = readCamera();

    const event = dispatchKey({ key: '=', ctrlKey: true }, input);
    expect(event.defaultPrevented).toBe(false);
    await flushFrame();
    expect(readCamera()).toEqual(before);

    input.remove();
  });
});

describe('BoardViewport: negative cases', () => {
  // TC-29
  it('TC-29 does not move the camera or dismiss the hint for a click without movement', async () => {
    renderBoard();
    const before = readCamera();
    expect(hintElement()).not.toBeNull();

    pointerEvent('pointerDown', viewportElement(), { x: 42, y: 24 });
    await flushFrame();
    pointerEvent('pointerUp', viewportElement(), { x: 42, y: 24 });
    await flushFrame();

    expect(readCamera()).toEqual(before);
    expect(hintElement()).not.toBeNull();
    expect(zoomLabel()).toBe('100%');
  });

  it('does not start a drag when the pointerdown is not on the board surface', async () => {
    renderBoard();
    const before = readCamera();
    const control = screen.getByTestId('zoom-controls');

    pointerEvent('pointerDown', control, { x: 10, y: 10 });
    pointerEvent('pointerMove', control, { x: 300, y: 300 });
    pointerEvent('pointerUp', control, { x: 300, y: 300 });
    await flushFrame();

    expect(isPanning()).toBe(false);
    expect(readCamera()).toEqual(before);
  });

  // TC-30
  it('TC-30 does not zoom the board for a Ctrl + wheel over the zoom control', async () => {
    renderBoard();
    const before = readCamera();

    const event = dispatchWheel(screen.getByTestId('zoom-in'), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 10,
      clientY: 10,
    });

    // TC-30: the control stops propagation but leaves the browser default.
    expect(event.defaultPrevented).toBe(false);
    await flushFrame();
    expect(readCamera()).toEqual(before);
    expect(zoomLabel()).toBe('100%');
  });
});

function normalise(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}
