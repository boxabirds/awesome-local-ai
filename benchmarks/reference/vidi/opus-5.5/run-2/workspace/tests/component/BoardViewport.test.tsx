import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { resetCamera, screenToWorld, type Point } from '../../src/client/canvas/camera';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { dispatch, flushFrame, readCamera, useFakeFrames } from './helpers';

/** Required precision for camera comparisons read back from CSS. */
const DIGITS = 9;
const START: Point = { x: 100, y: 100 };
const DRAG = { dx: 200, dy: 100 };
const WHEEL_DELTA = 100;
const POINTER: Point = { x: 300, y: 200 };
const PINCH_SCALE = 2;

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function initialCamera() {
  return resetCamera({ width: window.innerWidth, height: window.innerHeight });
}

function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', p: Point): void {
  fireEvent[type](viewportEl(), { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, buttons: 1 });
}

function wheelEvent(init: WheelEventInit): WheelEvent {
  return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('viewport.input (BoardViewport)', () => {
  beforeEach(() => {
    useFakeFrames();
    render(<App />);
  });

  it('starts at 100% with the start point in the centre', () => {
    expect(readCamera()).toEqual(initialCamera());
  });

  it('TC-13 drag moves the world layer by exactly the pointer movement; Idle→Panning→Idle', () => {
    const before = readCamera();
    expect(viewportEl()).toHaveAttribute('data-state', 'idle');
    pointer('pointerDown', START);
    expect(viewportEl()).toHaveAttribute('data-state', 'panning');
    pointer('pointerMove', { x: START.x + DRAG.dx, y: START.y + DRAG.dy });
    pointer('pointerUp', { x: START.x + DRAG.dx, y: START.y + DRAG.dy });
    flushFrame();
    expect(viewportEl()).toHaveAttribute('data-state', 'idle');
    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - DRAG.dx, DIGITS);
    expect(after.y).toBeCloseTo(before.y - DRAG.dy, DIGITS);
    expect(screen.getByTestId('world-layer').style.transform).toBe(
      `scale(1) translate(${-after.x}px, ${-after.y}px)`,
    );
  });

  it('TC-14 pointercancel ends the drag and later moves are ignored', () => {
    const before = readCamera();
    pointer('pointerDown', START);
    pointer('pointerMove', { x: START.x + DRAG.dx, y: START.y + DRAG.dy });
    pointer('pointerCancel', { x: START.x + DRAG.dx, y: START.y + DRAG.dy });
    flushFrame();
    const atCancel = readCamera();
    expect(atCancel.x).toBeCloseTo(before.x - DRAG.dx, DIGITS);
    expect(viewportEl()).toHaveAttribute('data-state', 'idle');
    pointer('pointerMove', { x: START.x + 2 * DRAG.dx, y: START.y + 2 * DRAG.dy });
    flushFrame();
    expect(readCamera()).toEqual(atCancel);
  });

  it('lostpointercapture also ends the drag', () => {
    pointer('pointerDown', START);
    fireEvent.lostPointerCapture(viewportEl(), { pointerId: 1 });
    expect(viewportEl()).toHaveAttribute('data-state', 'idle');
    const before = readCamera();
    pointer('pointerMove', { x: START.x + DRAG.dx, y: START.y + DRAG.dy });
    flushFrame();
    expect(readCamera()).toEqual(before);
  });

  it('TC-15 plain wheel pans by deltaY/zoom and prevents the default', () => {
    const before = readCamera();
    const ev = dispatch(viewportEl(), wheelEvent({ deltaY: WHEEL_DELTA }));
    flushFrame();
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.y).toBeCloseTo(before.y + WHEEL_DELTA / before.zoom, DIGITS);
    expect(after.x).toBe(before.x);
    expect(after.zoom).toBe(before.zoom);
  });

  it('plain horizontal wheel pans horizontally', () => {
    const before = readCamera();
    dispatch(viewportEl(), wheelEvent({ deltaX: WHEEL_DELTA }));
    flushFrame();
    expect(readCamera().x).toBeCloseTo(before.x + WHEEL_DELTA, DIGITS);
  });

  it('TC-16 Ctrl + wheel zooms in around the pointer and prevents page zoom', () => {
    const before = readCamera();
    const ev = dispatch(
      viewportEl(),
      wheelEvent({ deltaY: -WHEEL_DELTA, ctrlKey: true, clientX: POINTER.x, clientY: POINTER.y }),
    );
    flushFrame();
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeCloseTo(Math.exp(WHEEL_DELTA * WHEEL_ZOOM_SENSITIVITY), DIGITS);
    const wBefore = screenToWorld(before, POINTER);
    const wAfter = screenToWorld(after, POINTER);
    expect(wAfter.x).toBeCloseTo(wBefore.x, DIGITS);
    expect(wAfter.y).toBeCloseTo(wBefore.y, DIGITS);
  });

  it('Cmd (meta) + wheel zooms too', () => {
    dispatch(viewportEl(), wheelEvent({ deltaY: -WHEEL_DELTA, metaKey: true }));
    flushFrame();
    expect(readCamera().zoom).toBeGreaterThan(1);
  });

  it('TC-17 Safari gesturechange scale 2 doubles the zoom and prevents the default', () => {
    const start = Object.assign(new Event('gesturestart', { cancelable: true }), { scale: 1 });
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), {
      scale: PINCH_SCALE,
      clientX: POINTER.x,
      clientY: POINTER.y,
    });
    dispatch(viewportEl(), start);
    dispatch(viewportEl(), change);
    flushFrame();
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(PINCH_SCALE);
  });

  it('gesturechange past the limit clamps to ZOOM_MAX', () => {
    const huge = ZOOM_MAX * PINCH_SCALE;
    dispatch(viewportEl(), Object.assign(new Event('gesturechange', { cancelable: true }), { scale: huge }));
    flushFrame();
    expect(readCamera().zoom).toBe(ZOOM_MAX);
  });

  it('TC-18 Ctrl + = / - / 0 step in, step out and reset, each preventing page zoom', () => {
    const e1 = dispatch(window, key({ key: '=', code: 'Equal', ctrlKey: true }));
    flushFrame();
    expect(e1.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent(`${ZOOM_STEP_FACTOR * 100}%`);

    const e2 = dispatch(window, key({ key: '-', code: 'Minus', ctrlKey: true }));
    flushFrame();
    expect(e2.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(1);

    // Move away, zoom in, then reset.
    dispatch(viewportEl(), wheelEvent({ deltaY: WHEEL_DELTA, deltaX: WHEEL_DELTA }));
    dispatch(window, key({ key: '=', code: 'Equal', metaKey: true }));
    flushFrame();
    expect(readCamera()).not.toEqual(initialCamera());
    const e3 = dispatch(window, key({ key: '0', code: 'Digit0', metaKey: true }));
    flushFrame();
    expect(e3.defaultPrevented).toBe(true);
    expect(readCamera()).toEqual(initialCamera());
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('100%');
  });

  it('keys without Ctrl/Cmd are left alone', () => {
    const ev = dispatch(window, key({ key: '=', code: 'Equal' }));
    flushFrame();
    expect(ev.defaultPrevented).toBe(false);
    expect(readCamera()).toEqual(initialCamera());
  });

  it('TC-29 a click without moving leaves the camera unchanged and keeps the hint', () => {
    const before = readCamera();
    pointer('pointerDown', START);
    pointer('pointerUp', START);
    flushFrame();
    expect(readCamera()).toEqual(before);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });

  it('TC-30 Ctrl + wheel over the zoom control does not zoom the board or suppress the browser default', () => {
    const before = readCamera();
    const controls = screen.getByTestId('zoom-controls');
    const ev = dispatch(controls, wheelEvent({ deltaY: -WHEEL_DELTA, ctrlKey: true }));
    flushFrame();
    expect(ev.defaultPrevented).toBe(false);
    expect(readCamera()).toEqual(before);
  });

  it('the dot grid follows the camera', () => {
    const spacing = Number(viewportEl().dataset.gridSpacing);
    expect(spacing).toBeGreaterThan(0);
    const bgBefore = viewportEl().style.backgroundPosition;
    pointer('pointerDown', START);
    pointer('pointerMove', { x: START.x + 1, y: START.y });
    pointer('pointerUp', { x: START.x + 1, y: START.y });
    flushFrame();
    expect(viewportEl().style.backgroundPosition).not.toBe(bgBefore);
  });
});
