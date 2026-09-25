import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { screenToWorld } from '../../src/client/canvas/camera';
import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { VIEWPORT_SIZE, StubResizeObserver } from './setup';
import {
  fireGesture,
  fireKey,
  firePointer,
  fireWheel,
  renderBoard,
  settle,
} from './helpers';

afterEach(cleanup);

const START = { x: 0, y: 0, zoom: 1 };

describe('BoardViewport drag to pan', () => {
  // TC-13
  it('TC-13 moves the board by exactly the pointer movement and tracks Idle -> Panning -> Idle', async () => {
    const board = renderBoard();
    expect(board.camera()).toEqual(START);
    expect(board.viewport.dataset.panning).toBe('false');

    firePointer(board.viewport, 'pointerdown', 100, 100);
    expect(board.viewport.dataset.panning).toBe('true');

    firePointer(board.viewport, 'pointermove', 300, 200);
    await settle();

    // The camera moved so that world (0,0) sits 200px right and 100px down.
    expect(board.camera()).toEqual({ x: -200, y: -100, zoom: 1 });
    expect(board.world.style.transform).toContain('translate(200px, 100px)');

    // A second move segment keeps following the pointer exactly.
    firePointer(board.viewport, 'pointermove', 350, 180);
    await settle();
    expect(board.camera()).toEqual({ x: -250, y: -80, zoom: 1 });

    firePointer(board.viewport, 'pointerup', 350, 180);
    expect(board.viewport.dataset.panning).toBe('false');
    await settle();
    expect(board.camera()).toEqual({ x: -250, y: -80, zoom: 1 });
  });

  it('shows a grabbing cursor only while dragging', async () => {
    const board = renderBoard();
    expect(board.viewport.style.cursor).toBe('grab');
    firePointer(board.viewport, 'pointerdown', 10, 10);
    expect(board.viewport.style.cursor).toBe('grabbing');
    firePointer(board.viewport, 'pointerup', 10, 10);
    await settle();
    expect(board.viewport.style.cursor).toBe('grab');
  });

  // TC-14
  it('TC-14 ends the drag on pointercancel, keeping the camera at the moment of interruption', async () => {
    const board = renderBoard();

    firePointer(board.viewport, 'pointerdown', 100, 100);
    firePointer(board.viewport, 'pointermove', 150, 150);
    await settle();
    const atCancel = board.camera();
    expect(atCancel).toEqual({ x: -50, y: -50, zoom: 1 });

    firePointer(board.viewport, 'pointercancel', 150, 150);
    expect(board.viewport.dataset.panning).toBe('false');

    // Pointer events after the interruption are ignored.
    firePointer(board.viewport, 'pointermove', 900, 900);
    await settle();
    expect(board.camera()).toEqual(atCancel);
  });

  it('ends the drag when pointer capture is lost', async () => {
    const board = renderBoard();
    firePointer(board.viewport, 'pointerdown', 100, 100);
    firePointer(board.viewport, 'pointermove', 120, 120);
    await settle();
    const atLoss = board.camera();

    firePointer(board.viewport, 'lostpointercapture', 400, 400);
    firePointer(board.viewport, 'pointermove', 400, 400);
    await settle();

    expect(board.viewport.dataset.panning).toBe('false');
    expect(board.camera()).toEqual(atLoss);
  });

  // TC-29
  it('TC-29 ignores a click on empty space with no movement', async () => {
    const board = renderBoard();

    firePointer(board.viewport, 'pointerdown', 500, 500);
    firePointer(board.viewport, 'pointerup', 500, 500);
    await settle();

    expect(board.camera()).toEqual(START);
    expect(board.hasNavigated()).toBe(false);
    expect(board.hint()).not.toBeNull();
  });

  it('ignores a pointerdown that targets board content', async () => {
    const board = renderBoard();
    const content = document.createElement('div');
    content.style.width = '50px';
    content.style.height = '50px';
    board.world.appendChild(content);

    firePointer(content, 'pointerdown', 100, 100);
    firePointer(board.viewport, 'pointermove', 300, 300);
    await settle();

    expect(board.camera()).toEqual(START);
  });
});

describe('BoardViewport wheel navigation', () => {
  // TC-15
  it('TC-15 pans with a plain wheel event and prevents the page from scrolling', async () => {
    const board = renderBoard();

    const event = fireWheel(board.viewport, { deltaY: 100 });
    await settle();

    expect(board.camera().y).toBeCloseTo(100, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it('pans horizontally with a trackpad scroll and honours line/page delta modes', async () => {
    const board = renderBoard();
    const event = fireWheel(board.viewport, { deltaX: 60 });
    await settle();
    expect(board.camera().x).toBeCloseTo(60, 6);
    expect(event.defaultPrevented).toBe(true);

    // deltaMode 1 == lines: one line is WHEEL_LINE_HEIGHT_PX pixels.
    fireWheel(board.viewport, { deltaY: 3, deltaMode: 1 });
    await settle();
    expect(board.camera().y).toBeCloseTo(3 * 16, 6);

    // deltaMode 2 == pages: one page is the viewport height.
    fireWheel(board.viewport, { deltaY: 1, deltaMode: 2 });
    await settle();
    expect(board.camera().y).toBeCloseTo(3 * 16 + VIEWPORT_SIZE.height, 6);
  });

  // TC-16
  it('TC-16 zooms with a ctrl wheel around the pointer and prevents page zoom', async () => {
    const board = renderBoard();
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(START, pointer);

    const event = fireWheel(board.viewport, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200 });
    await settle();

    const camera = board.camera();
    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.zoom).toBeCloseTo(Math.exp(1), 6);
    // The board location under the pointer did not move.
    const after = screenToWorld(camera, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it('treats Cmd + wheel like Ctrl + wheel (macOS)', async () => {
    const board = renderBoard();
    fireWheel(board.viewport, { metaKey: true, deltaY: -50, clientX: 100, clientY: 100 });
    await settle();
    expect(board.camera().zoom).toBeGreaterThan(1);
  });
});

describe('BoardViewport pinch gesture (Safari)', () => {
  // TC-17
  it('TC-17 zooms with a gesturechange scale and prevents the default', async () => {
    const board = renderBoard();

    fireGesture(board.viewport, 'gesturestart', { scale: 1, clientX: 400, clientY: 300 });
    const event = fireGesture(board.viewport, 'gesturechange', { scale: 2, clientX: 400, clientY: 300 });
    await settle();

    expect(board.camera().zoom).toBeCloseTo(2, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it('clamps a huge pinch-out to ZOOM_MAX', async () => {
    const board = renderBoard();
    fireGesture(board.viewport, 'gesturestart', { scale: 1, clientX: 600, clientY: 400 });
    const event = fireGesture(board.viewport, 'gesturechange', { scale: 1000, clientX: 600, clientY: 400 });
    await settle();

    expect(board.camera().zoom).toBe(ZOOM_MAX);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('BoardViewport keyboard shortcuts', () => {
  // TC-18
  it('TC-18 zooms one step with Ctrl+= and Ctrl+- and resets with Ctrl+0', async () => {
    const board = renderBoard();

    const zoomIn = fireKey({ key: '=', code: 'Equal', ctrlKey: true });
    await settle();
    expect(board.camera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
    expect(zoomIn.defaultPrevented).toBe(true);

    const zoomOut = fireKey({ key: '-', code: 'Minus', ctrlKey: true });
    await settle();
    expect(board.camera().zoom).toBe(1);
    expect(zoomOut.defaultPrevented).toBe(true);

    const resetView = fireKey({ key: '0', code: 'Digit0', ctrlKey: true });
    await settle();
    expect(board.camera()).toEqual({
      x: -VIEWPORT_SIZE.width / 2,
      y: -VIEWPORT_SIZE.height / 2,
      zoom: 1,
    });
    expect(resetView.defaultPrevented).toBe(true);
  });

  it('supports the Cmd variants and ignores keys without a modifier', async () => {
    const board = renderBoard();

    fireKey({ key: '=', code: 'Equal', metaKey: true });
    await settle();
    expect(board.camera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);

    const unmodified = fireKey({ key: '=', code: 'Equal' });
    await settle();
    expect(board.camera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
    expect(unmodified.defaultPrevented).toBe(false);
  });
});

describe('BoardViewport layout', () => {
  it('renders a dot grid whose size and offset follow the camera', async () => {
    const board = renderBoard();
    expect(board.viewport.style.backgroundSize).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    fireKey({ key: '=', code: 'Equal', ctrlKey: true });
    await settle();

    const { zoom } = board.camera();
    const tile = GRID_SPACING_WORLD * zoom;
    expect(board.viewport.style.backgroundSize).toBe(`${tile}px ${tile}px`);
    const [offsetX] = (board.viewport.style.backgroundPosition ?? '').split(' ');
    expect(Number.parseFloat(offsetX)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(offsetX)).toBeLessThan(tile);
  });

  it('keeps the camera untouched when the window is resized', async () => {
    const board = renderBoard();
    firePointer(board.viewport, 'pointerdown', 100, 100);
    firePointer(board.viewport, 'pointermove', 260, 140);
    await settle();
    const before = board.camera();

    StubResizeObserver.resize({ width: 1920, height: 1080 });
    await settle();

    expect(board.camera()).toEqual(before);
  });
});

describe('zoom controls do not drive the board', () => {
  // TC-30
  it('TC-30 ignores ctrl wheel over the zoom control and does not cancel it', async () => {
    const board = renderBoard();
    const before = board.camera();

    const event = fireWheel(board.controls, { ctrlKey: true, deltaY: -100 });
    await settle();

    expect(board.camera()).toEqual(before);
    expect(board.zoomLabel()).toBe('100%');
    expect(event.defaultPrevented).toBe(false);
  });
});
