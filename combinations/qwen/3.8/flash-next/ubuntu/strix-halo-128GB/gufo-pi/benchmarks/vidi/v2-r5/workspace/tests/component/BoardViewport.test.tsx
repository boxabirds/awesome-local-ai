import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  PERCENT,
  WHEEL_PIXELS_PER_LINE,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  advanceFrame,
  backgroundSpacingPixels,
  dispatchGesture,
  dispatchWheel,
  homeCamera,
  readCamera,
  renderBoard,
  transformNumbers,
} from './boardHarness';

const board = () => screen.getByTestId('board-viewport');
const world = () => screen.getByTestId('world-layer');

describe('viewport.input: pan by dragging', () => {
  it('TC-13 moves the world layer with the pointer and cycles Idle -> Panning -> Idle', () => {
    renderBoard();
    const start = homeCamera();
    expect(board()).toHaveAttribute('data-panning', 'false');

    fireEvent.pointerDown(board(), {
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 400,
      clientY: 300,
    });
    expect(board()).toHaveAttribute('data-panning', 'true');

    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 600, clientY: 400 });
    advanceFrame();

    const cam = readCamera();
    expect(cam.x).toBeCloseTo(start.x - 200, 6);
    expect(cam.y).toBeCloseTo(start.y - 100, 6);
    // The world layer transform matches the camera: scale(zoom) translate(-x, -y).
    const numbers = transformNumbers(world().style.transform);
    expect(numbers).toHaveLength(3);
    expect(numbers[0]).toBeCloseTo(cam.zoom, 9);
    expect(numbers[1]).toBeCloseTo(-cam.x, 6);
    expect(numbers[2]).toBeCloseTo(-cam.y, 6);

    fireEvent.pointerUp(board(), { pointerId: 1 });
    advanceFrame();
    expect(board()).toHaveAttribute('data-panning', 'false');
  });

  it('TC-13b a multi-move drag accumulates the exact pointer distance', () => {
    renderBoard();
    const start = homeCamera();

    fireEvent.pointerDown(board(), {
      pointerId: 3,
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(board(), { pointerId: 3, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(board(), { pointerId: 3, clientX: 300, clientY: 180 });
    advanceFrame();

    const cam = readCamera();
    expect(cam.x).toBeCloseTo(start.x - 200, 6);
    expect(cam.y).toBeCloseTo(start.y - 80, 6);
  });

  it('TC-14 freezes the camera at the moment of a pointercancel and ignores later moves', () => {
    renderBoard();
    const start = homeCamera();

    fireEvent.pointerDown(board(), {
      pointerId: 2,
      button: 0,
      pointerType: 'mouse',
      clientX: 400,
      clientY: 300,
    });
    fireEvent.pointerMove(board(), { pointerId: 2, clientX: 500, clientY: 350 });
    advanceFrame();

    const atCancel = readCamera();
    expect(atCancel.x).toBeCloseTo(start.x - 100, 6);
    expect(atCancel.y).toBeCloseTo(start.y - 50, 6);

    fireEvent.pointerCancel(board(), { pointerId: 2 });
    advanceFrame();
    expect(board()).toHaveAttribute('data-panning', 'false');

    fireEvent.pointerMove(board(), { pointerId: 2, clientX: 900, clientY: 900 });
    advanceFrame();
    expect(readCamera()).toEqual(atCancel);
  });
});

describe('viewport.input: pan by scrolling', () => {
  it('TC-15 scrolls the board in the scroll direction and prevents the page default', () => {
    renderBoard();
    const start = homeCamera();

    const down = dispatchWheel(board(), { deltaY: 100, deltaX: 0, deltaMode: 0 });
    advanceFrame();

    expect(down.defaultPrevented).toBe(true);
    const afterVertical = readCamera();
    expect(afterVertical.y).toBeCloseTo(start.y + 100 / start.zoom, 6);

    const right = dispatchWheel(board(), { deltaY: 0, deltaX: 60, deltaMode: 0 });
    advanceFrame();

    expect(right.defaultPrevented).toBe(true);
    expect(readCamera().x).toBeCloseTo(afterVertical.x + 60 / start.zoom, 6);
  });

  it('converts LINE and PAGE wheel deltas to pixels', () => {
    renderBoard();
    const start = homeCamera();

    dispatchWheel(board(), { deltaY: 3, deltaMode: 1 });
    advanceFrame();
    expect(readCamera().y).toBeCloseTo(start.y + 3 * WHEEL_PIXELS_PER_LINE, 6);
  });
});

describe('viewport.input: zoom around the pointer', () => {
  it('TC-16 zooms on a Ctrl-wheel, keeps the point under the pointer and prevents the page default', () => {
    renderBoard();
    const start = homeCamera();
    const point = { x: 300, y: 200 };

    const event = dispatchWheel(board(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: point.x,
      clientY: point.y,
    });
    advanceFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = readCamera();
    expect(cam.zoom).toBeGreaterThan(start.zoom);
    expect(cam.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 9);

    const before = screenToWorld(start, point);
    const after = screenToWorld(cam, point);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zooms out with a positive Ctrl-wheel deltaY', () => {
    renderBoard();
    const start = homeCamera();

    dispatchWheel(board(), { deltaY: 100, ctrlKey: true, clientX: 400, clientY: 300 });
    advanceFrame();

    expect(readCamera().zoom).toBeLessThan(start.zoom);
  });

  it('TC-17 doubles the zoom on a Safari gesturechange and prevents the page default', () => {
    renderBoard();
    const start = homeCamera();

    const event = dispatchGesture(board(), 'gesturechange', 2, { x: 300, y: 200 });
    advanceFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = readCamera();
    expect(cam.zoom).toBeCloseTo(start.zoom * 2, 9);

    const before = screenToWorld(start, { x: 300, y: 200 });
    const after = screenToWorld(cam, { x: 300, y: 200 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-17b clamps a Safari gesture that would exceed the zoom limits', () => {
    renderBoard();

    dispatchGesture(board(), 'gesturechange', ZOOM_MAX * 10, { x: 300, y: 200 });
    advanceFrame();

    expect(readCamera().zoom).toBe(ZOOM_MAX);
  });
});

describe('viewport.input: keyboard shortcuts', () => {
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    window.dispatchEvent(event);
    advanceFrame();
    return event;
  };

  it('TC-18 Ctrl+ = , Ctrl+ - and Ctrl+ 0 step and reset, each preventing the page default', () => {
    renderBoard();
    const home = homeCamera();

    const zoomIn = press('=', { ctrlKey: true });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
    expect(Math.round(readCamera().zoom * PERCENT)).toBe(125);

    const zoomOut = press('-', { ctrlKey: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(1);

    const reset = press('0', { ctrlKey: true });
    expect(reset.defaultPrevented).toBe(true);
    expect(readCamera().x).toBeCloseTo(home.x, 6);
    expect(readCamera().y).toBeCloseTo(home.y, 6);
    expect(readCamera().zoom).toBe(1);
  });

  it('accepts the Cmd equivalents and ignores plain keys', () => {
    renderBoard();
    const home = homeCamera();

    expect(press('=', { metaKey: true }).defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);

    const plain = press('=');
    expect(plain.defaultPrevented).toBe(false);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);

    expect(press('0', { metaKey: true }).defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(1);
    expect(readCamera().x).toBeCloseTo(home.x, 6);
  });
});

describe('viewport.input: grid rendering', () => {
  it('draws the dot grid at GRID_SPACING_WORLD * zoom pixels and moves it with the camera', () => {
    renderBoard();
    const home = homeCamera();
    expect(backgroundSpacingPixels(board())).toBeCloseTo(GRID_SPACING_WORLD * home.zoom, 6);

    fireEvent.pointerDown(board(), {
      pointerId: 5,
      button: 0,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(board(), { pointerId: 5, clientX: 5, clientY: 5 });
    advanceFrame();

    expect(backgroundSpacingPixels(board())).toBeCloseTo(GRID_SPACING_WORLD, 6);

    dispatchGesture(board(), 'gesturechange', 2, { x: 0, y: 0 });
    advanceFrame();
    expect(backgroundSpacingPixels(board())).toBeCloseTo(GRID_SPACING_WORLD * 2, 6);
  });
});

describe('viewport.input: negative scenarios', () => {
  it('TC-29 a click without movement leaves the camera alone and keeps the hint', () => {
    renderBoard();
    const home = homeCamera();

    fireEvent.pointerDown(board(), {
      pointerId: 7,
      button: 0,
      pointerType: 'mouse',
      clientX: 424,
      clientY: 202,
    });
    fireEvent.pointerUp(board(), { pointerId: 7 });
    advanceFrame();

    expect(readCamera()).toEqual(home);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('TC-30 a Ctrl-wheel over the zoom control does not zoom the board and keeps its default', () => {
    renderBoard();
    const home = readCamera();
    const controls = screen.getByTestId('zoom-controls');

    const event = dispatchWheel(controls, { deltaY: -240, ctrlKey: true, clientX: 900, clientY: 700 });
    advanceFrame();

    expect(event.defaultPrevented).toBe(false);
    expect(readCamera()).toEqual(home);
  });

  it('ignores drags that start on board content rather than empty space', () => {
    renderBoard();
    const home = homeCamera();
    const marker = screen.getByTestId('origin-marker');

    fireEvent.pointerDown(marker, {
      pointerId: 8,
      button: 0,
      pointerType: 'mouse',
      clientX: 512,
      clientY: 384,
    });
    fireEvent.pointerMove(board(), { pointerId: 8, clientX: 712, clientY: 484 });
    advanceFrame();

    expect(readCamera()).toEqual(home);
    expect(board()).toHaveAttribute('data-panning', 'false');
  });
});
