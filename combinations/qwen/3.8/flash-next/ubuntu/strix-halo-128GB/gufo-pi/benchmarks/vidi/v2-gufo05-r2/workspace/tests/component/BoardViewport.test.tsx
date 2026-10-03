import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  panBy,
  resetCamera,
  screenToWorld,
  zoomAt,
  type Camera,
} from '../../src/client/canvas/camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX } from '../../src/shared/config';
import {
  dragBoard,
  fireGesture,
  fireKey,
  firePointer,
  fireWheel,
  flushFrames,
  hint,
  readCamera,
  readGridSpacing,
  renderBoard,
  surface,
  zoomLabel,
} from './boardHarness';
import { TEST_VIEWPORT } from './setup';

/** The view the board starts in: 100% with the starting point centred. */
const START: Camera = resetCamera(TEST_VIEWPORT);

describe('BoardViewport drag panning', () => {
  it('starts centred at 100% with a board-attached dot grid', () => {
    renderBoard();
    expect(readCamera()).toEqual(START);
    expect(readGridSpacing()).toBe(GRID_SPACING_WORLD * START.zoom);
  });

  it('TC-13: moves the board by exactly the pointer delta and cycles Idle → Panning → Idle', () => {
    renderBoard();
    const el = surface();

    firePointer(el, 'pointerdown', 400, 300);
    expect(el.dataset.panning).toBe('true');

    firePointer(el, 'pointermove', 600, 400);
    flushFrames();

    const expected = panBy(START, 200, 100);
    const camera = readCamera();
    expect(camera.x).toBeCloseTo(expected.x, 9);
    expect(camera.y).toBeCloseTo(expected.y, 9);
    expect(camera.zoom).toBe(1);
    // What is rendered: the world layer carries the camera as a CSS transform.
    expect(screen.getByTestId('board-world').getAttribute('style')).toContain(
      `translate(${-expected.x}px, ${-expected.y}px)`,
    );

    firePointer(el, 'pointerup', 600, 400);
    expect(el.dataset.panning).toBe('false');
    expect(readCamera()).toEqual(camera);
  });

  it('TC-14: ends the drag on pointercancel and ignores later moves', () => {
    renderBoard();
    const el = surface();

    firePointer(el, 'pointerdown', 100, 100);
    firePointer(el, 'pointermove', 200, 150);
    flushFrames();
    const atCancel = readCamera();

    firePointer(el, 'pointercancel', 200, 150);
    flushFrames();
    expect(el.dataset.panning).toBe('false');
    expect(readCamera()).toEqual(atCancel);

    // The pointer is no longer captured: further movement does nothing.
    firePointer(el, 'pointermove', 900, 900);
    flushFrames();
    expect(readCamera()).toEqual(atCancel);
  });

  it('starts a drag again after a cancelled one', () => {
    renderBoard();
    const el = surface();
    firePointer(el, 'pointerdown', 100, 100);
    firePointer(el, 'pointercancel', 100, 100);
    flushFrames();

    dragBoard({ x: 300, y: 300 }, { x: 350, y: 300 });
    expect(readCamera().x).toBeCloseTo(START.x - 50, 9);
  });
});

describe('BoardViewport wheel input', () => {
  it('TC-15: plain scroll pans the board and always prevents the default', () => {
    renderBoard();
    const event = fireWheel(surface(), { deltaY: 100 });
    flushFrames();

    const expected = panBy(START, 0, -100);
    const camera = readCamera();
    expect(camera.y).toBeCloseTo(expected.y, 9);
    expect(camera.y - START.y).toBeCloseTo(100 / START.zoom, 9);
    expect(camera.x).toBeCloseTo(START.x, 9);
    expect(event.defaultPrevented).toBe(true);
  });

  it('pans horizontally with a trackpad scroll, moving content left', () => {
    renderBoard();
    fireWheel(surface(), { deltaX: 60 });
    flushFrames();
    // Scrolling right moves the board content left: the camera pans right.
    expect(readCamera().x).toBeCloseTo(START.x + 60 / START.zoom, 9);
  });

  it('converts line and page wheel deltas to pixels', () => {
    renderBoard();
    fireWheel(surface(), { deltaY: 3, deltaMode: 1 });
    flushFrames();
    const linesInPixels = 3 * 16;
    expect(readCamera().y).toBeCloseTo(START.y + linesInPixels / START.zoom, 9);
  });

  it('TC-16: Ctrl + wheel zooms around the pointer and prevents the default', () => {
    renderBoard();
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(START, pointer);

    const event = fireWheel(surface(), { deltaY: -100, ctrlKey: true, x: pointer.x, y: pointer.y });
    flushFrames();

    const camera = readCamera();
    expect(camera.zoom).toBeGreaterThan(START.zoom);
    expect(camera.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 9);
    const after = screenToWorld(camera, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it('clamps Ctrl + wheel zoom at ZOOM_MAX', () => {
    renderBoard();
    // A far larger delta than any real device sends: exp(10) ≈ 22026.
    fireWheel(surface(), { deltaY: -1000, ctrlKey: true, x: 600, y: 400 });
    flushFrames();
    expect(readCamera().zoom).toBe(ZOOM_MAX);
    expect(zoomLabel().textContent).toBe(`${ZOOM_MAX * 100}%`);
  });

  it('ignores a zoom-out wheel at ZOOM_MIN without moving the board', () => {
    renderBoard();
    // Zoom all the way out with the wheel.
    for (let i = 0; i < 40; i += 1) {
      fireWheel(surface(), { deltaY: 10_000, ctrlKey: true, x: 600, y: 400 });
    }
    flushFrames();
    const atMin = readCamera();
    expect(atMin.zoom).toBeCloseTo(0.1, 6);

    fireWheel(surface(), { deltaY: 10_000, ctrlKey: true, x: 600, y: 400 });
    flushFrames();
    expect(readCamera()).toEqual(atMin);
  });

  it('TC-17: Safari gesturechange zooms around the pointer and prevents the default', () => {
    renderBoard();
    const pointer = { x: 350, y: 250 };
    const before = screenToWorld(START, pointer);

    fireGesture(surface(), 'gesturechange', 2, pointer.x, pointer.y);
    flushFrames();

    expect(readCamera().zoom).toBeCloseTo(START.zoom * 2, 9);
    const after = screenToWorld(readCamera(), pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('keeps the pinch anchor fixed over a whole Safari gesture', () => {
    renderBoard();
    const pointer = { x: 350, y: 250 };
    const before = screenToWorld(START, pointer);

    fireGesture(surface(), 'gesturestart', 1, pointer.x, pointer.y);
    flushFrames();
    for (const scale of [1.2, 1.6, 2.5]) {
      fireGesture(surface(), 'gesturechange', scale, pointer.x, pointer.y);
      flushFrames();
    }

    expect(readCamera().zoom).toBeCloseTo(2.5, 9);
    const after = screenToWorld(readCamera(), pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('prevents the default for Safari gesture events', () => {
    renderBoard();
    const start = fireGesture(surface(), 'gesturestart', 1, 100, 100);
    const change = fireGesture(surface(), 'gesturechange', 1.5, 100, 100);
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
  });
});

describe('BoardViewport keyboard shortcuts', () => {
  it('TC-18: Ctrl/Cmd + = , − and 0 zoom in, out and reset, each prevented', () => {
    renderBoard();

    const inEvent = fireKey('=', { ctrl: true });
    flushFrames();
    expect(readCamera().zoom).toBeCloseTo(1.25, 9);
    expect(inEvent.defaultPrevented).toBe(true);

    const outEvent = fireKey('-', { ctrl: true });
    flushFrames();
    expect(readCamera().zoom).toBe(1);
    expect(outEvent.defaultPrevented).toBe(true);

    // Reset returns to the standard view from anywhere.
    dragBoard({ x: 400, y: 400 }, { x: 900, y: 700 });
    expect(readCamera()).not.toEqual(START);

    const zeroEvent = fireKey('0', { ctrl: true });
    flushFrames();
    expect(readCamera()).toEqual(START);
    expect(zeroEvent.defaultPrevented).toBe(true);
  });

  it('supports Cmd on macOS and keeps the viewport centre fixed', () => {
    renderBoard();
    const centre = { x: TEST_VIEWPORT.width / 2, y: TEST_VIEWPORT.height / 2 };
    const before = screenToWorld(START, centre);

    fireKey('=', { meta: true });
    flushFrames();

    expect(readCamera().zoom).toBeCloseTo(1.25, 9);
    const after = screenToWorld(readCamera(), centre);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('leaves plain keys and other shortcuts to the browser', () => {
    renderBoard();
    expect(fireKey('=').defaultPrevented).toBe(false);
    expect(fireKey('0', { alt: true }).defaultPrevented).toBe(false);
    flushFrames();
    expect(readCamera()).toEqual(START);
  });
});

describe('BoardViewport negative cases', () => {
  it('TC-29: a click without movement leaves the camera and the hint alone', () => {
    renderBoard();
    const el = surface();

    firePointer(el, 'pointerdown', 500, 500);
    firePointer(el, 'pointerup', 500, 500);
    flushFrames();

    expect(readCamera()).toEqual(START);
    expect(hint()).not.toBeNull();
  });

  it('TC-30: a Ctrl+wheel over the zoom control does not zoom the board', () => {
    renderBoard();
    const control = zoomLabel();

    const event = fireWheel(control, { deltaY: -100, ctrlKey: true, x: 1100, y: 780 });
    flushFrames();

    expect(readCamera()).toEqual(START);
    // The browser's own zoom is not suppressed outside the board.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not start a pan from a pointerdown on board content', () => {
    renderBoard();
    const marker = document.querySelector('[data-testid="origin-marker"]');
    if (!marker) throw new Error('origin marker is missing');

    firePointer(marker, 'pointerdown', 600, 400);
    expect(surface().dataset.panning).toBe('false');
    firePointer(marker, 'pointermove', 700, 500);
    flushFrames();
    expect(readCamera()).toEqual(START);
  });

  it('TC-21 support: the dot grid scales and shifts with the camera', () => {
    renderBoard();
    const zoomed = zoomAt(START, { x: 300, y: 200 }, 2);
    for (let i = 0; i < 40; i += 1) {
      fireWheel(surface(), { deltaY: -25, ctrlKey: true, x: 300, y: 200 });
      flushFrames();
      if (readCamera().zoom >= zoomed.zoom - 1e-9) break;
    }

    const camera = readCamera();
    expect(readGridSpacing()).toBeCloseTo(GRID_SPACING_WORLD * camera.zoom, 6);
    const position = surface().style.backgroundPosition;
    const [offsetX] = position.split(' ');
    const value = Number(offsetX.replace('px', ''));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(GRID_SPACING_WORLD * camera.zoom);
  });
});
