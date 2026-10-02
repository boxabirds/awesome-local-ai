import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { resetCamera, screenToWorld, type Size } from '../../src/client/canvas/camera';

/**
 * The board area in jsdom has no layout, so the app falls back to the window
 * size; every expectation is derived from that.
 */
const VIEW: Size = { width: window.innerWidth, height: window.innerHeight };
const INITIAL = resetCamera(VIEW);

/** jsdom has no layout: getBoundingClientRect is all zeros, so screen == client. */
const board = () => screen.getByTestId('board-viewport');
const world = () => screen.getByTestId('world-layer');
const hint = () => screen.queryByTestId('navigation-hint');
const camera = () => {
  const hook = window.__vidi6;
  if (!hook) throw new Error('expected the test camera hook to be installed in test mode');
  return hook.getCamera();
};

/** Run the requestAnimationFrame that coalesces camera updates. */
function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

function dispatch(target: EventTarget, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
  flushFrame();
  return event;
}

const wheelEvent = (init: WheelEventInit) =>
  new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
const keyEvent = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init });

const worldTransform = () => world().style.transform;

function drag(clientX: number, clientY: number, dx: number, dy: number, pointerId = 1) {
  fireEvent.pointerDown(board(), { clientX, clientY, button: 0, pointerId });
  fireEvent.pointerMove(board(), { clientX: clientX + dx, clientY: clientY + dy, pointerId });
  flushFrame();
  fireEvent.pointerUp(board(), { clientX: clientX + dx, clientY: clientY + dy, pointerId });
  flushFrame();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input — pan by dragging', () => {
  it('TC-13 moves the world layer transform with the pointer and returns to Idle', () => {
    render(<App />);
    flushFrame();
    expect(worldTransform()).toBe(`scale(1) translate(${VIEW.width / 2}px, ${VIEW.height / 2}px)`);
    expect(board().dataset.panning).toBe('false');

    fireEvent.pointerDown(board(), { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    expect(board().dataset.panning).toBe('true');
    expect(board().style.cursor).toBe('grabbing');

    fireEvent.pointerMove(board(), { clientX: 300, clientY: 200, pointerId: 1 });
    flushFrame();

    expect(camera().x).toBeCloseTo(INITIAL.x - 200, 6);
    expect(camera().y).toBeCloseTo(INITIAL.y - 100, 6);
    expect(worldTransform()).toBe(
      `scale(1) translate(${VIEW.width / 2 + 200}px, ${VIEW.height / 2 + 100}px)`,
    );

    fireEvent.pointerUp(board(), { clientX: 300, clientY: 200, pointerId: 1 });
    expect(board().dataset.panning).toBe('false');
    expect(board().style.cursor).toBe('grab');
    expect(camera().x).toBeCloseTo(INITIAL.x - 200, 6);
  });

  it('TC-13b follows a drag in several small moves exactly', () => {
    render(<App />);
    flushFrame();
    fireEvent.pointerDown(board(), { clientX: 400, clientY: 400, button: 0, pointerId: 3 });
    for (let i = 1; i <= 5; i += 1) {
      fireEvent.pointerMove(board(), { clientX: 400 + i * 10, clientY: 400 - i * 4, pointerId: 3 });
    }
    flushFrame();
    expect(camera().x).toBeCloseTo(INITIAL.x - 50, 6);
    expect(camera().y).toBeCloseTo(INITIAL.y + 20, 6);
  });

  it('TC-14 freezes the camera at pointercancel and ignores later moves', () => {
    render(<App />);
    flushFrame();
    fireEvent.pointerDown(board(), { clientX: 100, clientY: 100, button: 0, pointerId: 2 });
    fireEvent.pointerMove(board(), { clientX: 150, clientY: 150, pointerId: 2 });
    flushFrame();
    const frozen = camera();

    fireEvent.pointerCancel(board(), { clientX: 150, clientY: 150, pointerId: 2 });
    expect(board().dataset.panning).toBe('false');

    fireEvent.pointerMove(board(), { clientX: 900, clientY: 900, pointerId: 2 });
    flushFrame();
    expect(camera()).toBe(frozen);
  });

  it('TC-14b ends the drag when pointer capture is lost', () => {
    render(<App />);
    flushFrame();
    fireEvent.pointerDown(board(), { clientX: 100, clientY: 100, button: 0, pointerId: 4 });
    fireEvent.pointerMove(board(), { clientX: 120, clientY: 120, pointerId: 4 });
    flushFrame();
    const frozen = camera();

    fireEvent.lostPointerCapture(board(), { clientX: 120, clientY: 120, pointerId: 4 });
    expect(board().dataset.panning).toBe('false');
    fireEvent.pointerMove(board(), { clientX: 600, clientY: 600, pointerId: 4 });
    flushFrame();
    expect(camera()).toBe(frozen);
  });

  it('TC-29 a click without moving changes nothing and keeps the hint', () => {
    render(<App />);
    flushFrame();
    const before = camera();

    fireEvent.pointerDown(board(), { clientX: 222, clientY: 333, button: 0, pointerId: 5 });
    fireEvent.pointerUp(board(), { clientX: 222, clientY: 333, pointerId: 5 });
    flushFrame();

    expect(camera()).toBe(before);
    expect(hint()).not.toBeNull();
  });

  it('ignores drags that start on a board object (objects own their pointer)', () => {
    render(<App />);
    flushFrame();
    const before = camera();
    const object = document.createElement('div');
    object.className = 'future-board-object';
    world().appendChild(object);

    fireEvent.pointerDown(object, { clientX: 10, clientY: 10, button: 0, pointerId: 6 });
    fireEvent.pointerMove(board(), { clientX: 210, clientY: 110, pointerId: 6 });
    flushFrame();

    expect(camera()).toBe(before);
  });
});

describe('viewport.input — pan by scrolling', () => {
  it('TC-15 scrolls the board with the wheel and cancels page scroll', () => {
    render(<App />);
    flushFrame();

    const event = dispatch(
      board(),
      wheelEvent({ deltaX: 0, deltaY: 100, clientX: 300, clientY: 200 }),
    );

    expect(event.defaultPrevented).toBe(true);
    expect(camera().y).toBeCloseTo(INITIAL.y + 100, 6);
    expect(camera().x).toBeCloseTo(INITIAL.x, 6);
  });

  it('TC-15b scrolls horizontally the other way against the scroll', () => {
    render(<App />);
    flushFrame();

    dispatch(board(), wheelEvent({ deltaX: 60, deltaY: 0, clientX: 10, clientY: 10 }));

    expect(camera().x).toBeCloseTo(INITIAL.x + 60, 6);
  });

  it('converts line and page wheel deltas to pixels', () => {
    render(<App />);
    flushFrame();

    dispatch(board(), wheelEvent({ deltaY: 1, deltaMode: 1 }));
    expect(camera().y).toBeCloseTo(INITIAL.y + 16, 6);

    dispatch(board(), wheelEvent({ deltaY: 1, deltaMode: 2 }));
    expect(camera().y).toBeCloseTo(INITIAL.y + 16 + 100, 6);
  });
});

describe('viewport.input — zoom around the pointer', () => {
  it('TC-16 zooms on Ctrl + wheel and cancels the page zoom', () => {
    render(<App />);
    flushFrame();
    const pointer = { x: 300, y: 200 };
    const before = camera();

    const event = dispatch(
      board(),
      wheelEvent({ deltaY: -100, ctrlKey: true, clientX: pointer.x, clientY: pointer.y }),
    );

    expect(event.defaultPrevented).toBe(true);
    expect(camera().zoom).toBeGreaterThan(before.zoom);
    const worldBefore = screenToWorld(before, pointer);
    const worldAfter = screenToWorld(camera(), pointer);
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
  });

  it('zooms out with a positive Ctrl + wheel delta and honours the limits', () => {
    render(<App />);
    flushFrame();

    for (let i = 0; i < 40; i += 1) {
      dispatch(board(), wheelEvent({ deltaY: 500, ctrlKey: true, clientX: 100, clientY: 100 }));
    }
    expect(camera().zoom).toBe(ZOOM_MIN);

    for (let i = 0; i < 80; i += 1) {
      dispatch(board(), wheelEvent({ deltaY: -500, ctrlKey: true, clientX: 100, clientY: 100 }));
    }
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('treats a Meta (Cmd) wheel as a pinch too', () => {
    render(<App />);
    flushFrame();
    const before = camera();

    dispatch(board(), wheelEvent({ deltaY: -100, metaKey: true, clientX: 200, clientY: 100 }));

    expect(camera().zoom).toBeGreaterThan(before.zoom);
  });

  it('TC-17 doubles the zoom on a Safari gesturechange and cancels page zoom', () => {
    render(<App />);
    flushFrame();

    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    dispatch(board(), start);
    expect(start.defaultPrevented).toBe(true);

    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 2, clientX: 300, clientY: 200 });
    const pointer = { x: 300, y: 200 };
    const before = camera();
    dispatch(board(), change);

    expect(change.defaultPrevented).toBe(true);
    expect(camera().zoom).toBeCloseTo(2, 9);
    const worldBefore = screenToWorld(before, pointer);
    const worldAfter = screenToWorld(camera(), pointer);
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
  });

  it('TC-17b applies Safari gesture scale as a ratio between events and clamps it', () => {
    render(<App />);
    flushFrame();

    dispatch(board(), new Event('gesturestart', { bubbles: true, cancelable: true }));
    for (const scale of [1.5, 2, 3, 4, 8]) {
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale, clientX: 400, clientY: 300 });
      dispatch(board(), change);
    }

    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('ignores a gesturechange with a missing or invalid scale', () => {
    render(<App />);
    flushFrame();
    const before = camera();

    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    dispatch(board(), change);

    expect(camera()).toBe(before);
  });
});

describe('viewport.input — keyboard zoom shortcuts', () => {
  it('TC-18 Ctrl + = then Ctrl + - steps zoom and Ctrl + 0 resets, all cancelled', () => {
    render(<App />);
    flushFrame();

    const inEvent = dispatch(window, keyEvent('=', { ctrlKey: true }));
    expect(inEvent.defaultPrevented).toBe(true);
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    const outEvent = dispatch(window, keyEvent('-', { ctrlKey: true }));
    expect(outEvent.defaultPrevented).toBe(true);
    expect(camera().zoom).toBe(1);

    const resetEvent = dispatch(window, keyEvent('0', { ctrlKey: true }));
    expect(resetEvent.defaultPrevented).toBe(true);
    expect(camera()).toEqual(INITIAL);
  });

  it('works with Cmd on macOS and with the plus key', () => {
    render(<App />);
    flushFrame();

    dispatch(window, keyEvent('=', { metaKey: true }));
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    dispatch(window, keyEvent('0', { metaKey: true }));
    expect(camera().zoom).toBe(1);

    dispatch(window, keyEvent('+', { metaKey: true }));
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    dispatch(window, keyEvent('_', { metaKey: true }));
    expect(camera().zoom).toBe(1);
  });

  it('leaves plain keys and other shortcuts to the browser', () => {
    render(<App />);
    flushFrame();
    const before = camera();

    expect(dispatch(window, keyEvent('=')).defaultPrevented).toBe(false);
    expect(dispatch(window, keyEvent('-', { shiftKey: true, altKey: true })).defaultPrevented).toBe(
      false,
    );
    expect(dispatch(window, keyEvent('1', { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(camera()).toBe(before);
  });
});

describe('viewport.input — the control is chrome, not board', () => {
  it('TC-30 a Ctrl + wheel over the zoom control does not zoom the board', () => {
    render(<App />);
    flushFrame();
    const before = camera();

    const event = dispatch(
      screen.getByTestId('zoom-controls'),
      wheelEvent({ deltaY: -100, ctrlKey: true, clientX: 1200, clientY: 760 }),
    );

    expect(camera()).toBe(before);
    // the browser default (page zoom) is not suppressed outside the board
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('viewport.input — rendering of grid, world and origin marker', () => {
  it('moves the dot grid with the camera', () => {
    render(<App />);
    flushFrame();
    const before = board().style.backgroundPosition;

    drag(100, 100, 200, 100);

    expect(board().style.backgroundPosition).not.toBe(before);
    expect(board().style.backgroundSize).toBe('24px 24px');
  });

  it('keeps the origin crosshair centred at 100% and centred after reset', () => {
    render(<App />);
    flushFrame();
    expect(screen.getByTestId('origin-marker')).not.toBeNull();

    drag(100, 100, 200, 100);
    dispatch(window, keyEvent('0', { ctrlKey: true }));

    expect(camera()).toEqual(INITIAL);
  });
});
