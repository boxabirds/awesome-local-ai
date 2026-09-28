import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import {
  dispatchBoardEvent,
  flushFrames,
  renderBoard,
  startFakeFrames,
  stopFakeFrames,
  type BoardHarness,
} from './harness';

let h: BoardHarness;

beforeEach(() => {
  startFakeFrames();
  h = renderBoard();
});

afterEach(() => {
  stopFakeFrames();
});

/** The standard view: 100% with the board's starting point centred. */
function standardView() {
  return { x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 };
}

describe('drag to pan', () => {
  it('TC-13: moves the board by exactly the pointer delta and runs Idle -> Panning -> Idle', () => {
    const before = h.camera();
    expect(h.board.dataset.panning).toBe('false');

    fireEvent.pointerDown(h.board, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    expect(h.board.dataset.panning).toBe('true');

    fireEvent.pointerMove(h.board, { pointerId: 1, clientX: 300, clientY: 200 });
    flushFrames();
    const during = h.camera();
    expect(during.x).toBeCloseTo(before.x - 200, 6);
    expect(during.y).toBeCloseTo(before.y - 100, 6);
    expect(during.zoom).toBe(before.zoom);

    fireEvent.pointerUp(h.board, { pointerId: 1, clientX: 300, clientY: 200 });
    flushFrames();
    expect(h.board.dataset.panning).toBe('false');

    // The world layer transform is derived from the camera.
    const cam = h.camera();
    expect(h.worldTransform()).toBe(`scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`);
  });

  it('TC-14: pointercancel freezes the camera; later moves are ignored', () => {
    const start = h.camera();
    fireEvent.pointerDown(h.board, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(h.board, { pointerId: 1, clientX: 150, clientY: 120 });
    flushFrames();
    const frozen = h.camera();
    // The drag really moved the board (so this test cannot pass vacuously).
    expect(frozen.x).toBeCloseTo(start.x - 50, 6);

    fireEvent.pointerCancel(h.board, { pointerId: 1, clientX: 150, clientY: 120 });
    flushFrames();
    expect(h.board.dataset.panning).toBe('false');

    fireEvent.pointerMove(h.board, { pointerId: 1, clientX: 900, clientY: 900 });
    flushFrames();
    expect(h.camera()).toEqual(frozen);
  });

  it('TC-14b: lostpointercapture ends the drag like pointercancel', () => {
    const start = h.camera();
    fireEvent.pointerDown(h.board, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(h.board, { pointerId: 1, clientX: 140, clientY: 110 });
    flushFrames();
    const frozen = h.camera();
    expect(frozen.x).toBeCloseTo(start.x - 40, 6);

    dispatchBoardEvent(h.board, 'lostpointercapture', { pointerId: 1 });
    flushFrames();
    fireEvent.pointerMove(h.board, { pointerId: 1, clientX: 600, clientY: 600 });
    flushFrames();
    expect(h.camera()).toEqual(frozen);
    expect(h.board.dataset.panning).toBe('false');
  });

  it('TC-29: a click without movement leaves the camera unchanged and keeps the hint', () => {
    const before = h.camera();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    fireEvent.pointerDown(h.board, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(h.board, { pointerId: 1, clientX: 60, clientY: 60 });
    flushFrames();

    expect(h.camera()).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });
});

describe('wheel', () => {
  it('TC-15: plain wheel pans in the scroll direction and suppresses the page default', () => {
    const before = h.camera();
    const prevented = fireEvent.wheel(h.board, { deltaX: 0, deltaY: 100, deltaMode: 0 });
    flushFrames();

    expect(prevented).toBe(false); // fireEvent returns false when defaultPrevented
    const after = h.camera();
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-15b: trackpad scroll right moves content left, LINE deltaMode is converted to pixels', () => {
    const before = h.camera();
    // Content screen position of the board origin, before and after.
    const originBefore = (0 - before.x) * before.zoom;
    fireEvent.wheel(h.board, { deltaX: 5, deltaY: 0, deltaMode: 1 });
    flushFrames();
    const after = h.camera();
    const originAfter = (0 - after.x) * after.zoom;
    // Scrolling right pans the view right: the camera advances and the content
    // slides left by 5 lines worth of pixels.
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.x).toBeCloseTo(before.x + (5 * WHEEL_LINE_HEIGHT_PX) / before.zoom, 6);
    expect(originAfter).toBeCloseTo(originBefore - 5 * WHEEL_LINE_HEIGHT_PX, 6);
  });

  it('TC-16: Ctrl/Cmd + wheel zooms around the pointer and suppresses the page default', () => {
    const before = h.camera();
    const pointer = { x: 300, y: 200 };
    const prevented = fireEvent.wheel(h.board, {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    flushFrames();

    expect(prevented).toBe(false);
    const after = h.camera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 6);
    // The board location under the pointer did not move.
    const beforeWorld = screenToWorld(before, pointer);
    const afterWorld = screenToWorld(after, pointer);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
  });

  it('TC-16b: Meta + wheel also zooms (macOS pinch sends metaKey)', () => {
    const before = h.camera();
    fireEvent.wheel(h.board, { deltaY: -50, deltaMode: 0, metaKey: true, clientX: 100, clientY: 100 });
    flushFrames();
    expect(h.camera().zoom).toBeGreaterThan(before.zoom);
  });
});

describe('Safari gesture (pinch)', () => {
  it('TC-17: gesturechange doubles the zoom and suppresses the page default', () => {
    const before = h.camera();
    dispatchBoardEvent(h.board, 'gesturestart', { scale: 1, clientX: 300, clientY: 200 });
    const change = dispatchBoardEvent(h.board, 'gesturechange', {
      scale: 2,
      clientX: 300,
      clientY: 200,
    });
    flushFrames();

    expect(change.defaultPrevented).toBe(true);
    expect(h.camera().zoom).toBeCloseTo(before.zoom * 2, 6);
  });

  it('TC-17b: gesturechange is clamped at the maximum zoom', () => {
    dispatchBoardEvent(h.board, 'gesturestart', { scale: 1, clientX: 300, clientY: 200 });
    dispatchBoardEvent(h.board, 'gesturechange', { scale: 1e6, clientX: 300, clientY: 200 });
    flushFrames();
    expect(h.zoomLabel()).toBe('400%');
  });
});

describe('keyboard shortcuts', () => {
  it('TC-18: Ctrl + = zooms in, Ctrl + - zooms out, Ctrl + 0 resets, all default-prevented', () => {
    const before = h.camera();

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(h.camera().zoom).toBeCloseTo(before.zoom * ZOOM_STEP_FACTOR, 10);
    expect(h.zoomLabel()).toBe('125%');

    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(h.camera().zoom).toBe(before.zoom);

    // Move away, then reset returns to the standard view.
    h.drag({ x: 100, y: 100 }, { x: 400, y: 300 });
    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false);
    flushFrames();
    const standard = standardView();
    expect(h.camera().x).toBeCloseTo(standard.x, 6);
    expect(h.camera().y).toBeCloseTo(standard.y, 6);
    expect(h.camera().zoom).toBe(1);
  });

  it('TC-18b: Cmd + = zooms in (macOS)', () => {
    const before = h.camera();
    fireEvent.keyDown(window, { key: '=', metaKey: true });
    flushFrames();
    expect(h.camera().zoom).toBeCloseTo(before.zoom * ZOOM_STEP_FACTOR, 10);
  });

  it('ignores plain keys and modified keys that are not ours', () => {
    const before = h.camera();
    expect(fireEvent.keyDown(window, { key: '=' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '0', altKey: true, ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(true);
    flushFrames();
    expect(h.camera()).toEqual(before);
  });
});

describe('grid rendering', () => {
  it('grid spacing and position follow the camera', () => {
    const cam = h.camera();
    expect(Number(h.board.dataset.gridSpacing)).toBeCloseTo(GRID_SPACING_WORLD * cam.zoom, 6);

    h.drag({ x: 100, y: 100 }, { x: 150, y: 100 });
    const moved = h.camera();
    expect(Number(h.board.dataset.gridSpacing)).toBeCloseTo(GRID_SPACING_WORLD * moved.zoom, 6);

    // Zooming changes the on-screen spacing.
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    flushFrames();
    const zoomed = h.camera();
    expect(Number(h.board.dataset.gridSpacing)).toBeCloseTo(GRID_SPACING_WORLD * zoomed.zoom, 6);
  });
});

describe('wheel over the zoom control', () => {
  it('TC-30: Ctrl + wheel over the control does not zoom the board and the page default is suppressed', () => {
    const before = h.camera();
    const controls = screen.getByTestId('zoom-controls');
    const event = new WheelEvent('wheel', {
      deltaY: -240,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      controls.dispatchEvent(event);
    });
    flushFrames();

    // The board never sees the event, so it does not zoom...
    expect(h.camera()).toEqual(before);
    // ...and the event does not reach the document either: the control
    // suppresses the browser default so the page zoom stays unchanged.
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('origin marker', () => {
  it('sits at the screen position of the board starting point', () => {
    // jsdom does no layout, so assert on the inline position the marker is given.
    const marker = screen.getByTestId('origin-marker');
    const cam = h.camera();
    const origin = worldToScreen(cam, { x: 0, y: 0 });
    expect(marker.style.left).toBe(`${origin.x}px`);
    expect(marker.style.top).toBe(`${origin.y}px`);
  });
});
