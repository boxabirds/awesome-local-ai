import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { resetCamera, type Camera } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { TEST_VIEWPORT } from './setup';

const FRAME_MS = 20;
const EPSILON = 1e-9;
const PRECISION_DIGITS = 9;
const DRAG = { dx: 200, dy: 100 } as const;
const START = { x: 400, y: 300 } as const;
const WHEEL_DELTA = 100;
const POINTER = { x: 300, y: 200 } as const;
const PINCH_SCALE = 2;
const HALF = 2;

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.getCamera();
}

function board() {
  return screen.getByTestId('board-viewport');
}

function worldTransform(): string {
  return (screen.getByTestId('board-world') as HTMLElement).style.transform;
}

function expectedTransform(c: Camera): string {
  return `scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
}

function dispatchWheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function hintShown(): boolean {
  return screen.queryByText(NAVIGATION_HINT_TEXT) !== null;
}

const INITIAL = resetCamera(TEST_VIEWPORT);

describe('viewport.input', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] });
    render(<App />);
    flushFrame();
  });

  it('starts at 100% with the starting point centred and the dot grid attached', () => {
    expect(camera()).toEqual(INITIAL);
    expect(worldTransform()).toBe(expectedTransform(INITIAL));
    expect(board().style.backgroundSize).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
  });

  it('TC-13 drag moves the world layer by exactly the pointer delta; Idle→Panning→Idle', () => {
    expect(board().dataset.mode).toBe('idle');
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    expect(board().dataset.mode).toBe('panning');
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    flushFrame();
    fireEvent.pointerUp(board(), { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    flushFrame();
    expect(board().dataset.mode).toBe('idle');
    const c = camera();
    expect(c).toEqual({ x: INITIAL.x - DRAG.dx, y: INITIAL.y - DRAG.dy, zoom: 1 });
    expect(worldTransform()).toBe(expectedTransform(c));
  });

  it('several moves inside one frame compose into one render', () => {
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx / HALF, clientY: START.y });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    // Not yet committed to the DOM until the next animation frame.
    expect(worldTransform()).toBe(expectedTransform(INITIAL));
    flushFrame();
    expect(worldTransform()).toBe(expectedTransform({ x: INITIAL.x - DRAG.dx, y: INITIAL.y - DRAG.dy, zoom: 1 }));
  });

  it('TC-14 pointercancel ends the drag; later moves are ignored', () => {
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    fireEvent.pointerCancel(board(), { pointerId: 1 });
    flushFrame();
    const atCancel = camera();
    expect(board().dataset.mode).toBe('idle');
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx * HALF, clientY: START.y });
    flushFrame();
    expect(camera()).toBe(atCancel);
    expect(worldTransform()).toBe(expectedTransform(atCancel));
  });

  it('lostpointercapture ends the drag', () => {
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    fireEvent.lostPointerCapture(board(), { pointerId: 1 });
    expect(board().dataset.mode).toBe('idle');
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y });
    flushFrame();
    expect(camera()).toEqual(INITIAL);
  });

  it('TC-15 plain wheel pans: camera y increases by deltaY/zoom and page scroll is prevented', () => {
    const e = dispatchWheel(board(), { deltaY: WHEEL_DELTA, clientX: POINTER.x, clientY: POINTER.y });
    flushFrame();
    expect(e.defaultPrevented).toBe(true);
    expect(camera()).toEqual({ x: INITIAL.x, y: INITIAL.y + WHEEL_DELTA / INITIAL.zoom, zoom: 1 });
  });

  it('plain horizontal wheel pans horizontally (content moves left on scroll right)', () => {
    dispatchWheel(board(), { deltaX: WHEEL_DELTA });
    flushFrame();
    expect(camera().x).toBe(INITIAL.x + WHEEL_DELTA);
  });

  it('TC-16 Ctrl wheel zooms in around the pointer and prevents page zoom', () => {
    const before = { x: POINTER.x / INITIAL.zoom + INITIAL.x, y: POINTER.y / INITIAL.zoom + INITIAL.y };
    const e = dispatchWheel(board(), {
      deltaY: -WHEEL_DELTA,
      ctrlKey: true,
      clientX: POINTER.x,
      clientY: POINTER.y,
    });
    flushFrame();
    expect(e.defaultPrevented).toBe(true);
    const c = camera();
    expect(c.zoom).toBeCloseTo(Math.exp(WHEEL_DELTA * WHEEL_ZOOM_SENSITIVITY), PRECISION_DIGITS);
    expect(c.zoom).toBeGreaterThan(1);
    expect(Math.abs(POINTER.x / c.zoom + c.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(POINTER.y / c.zoom + c.y - before.y)).toBeLessThan(EPSILON);
  });

  it('Cmd (meta) wheel zooms too', () => {
    dispatchWheel(board(), { deltaY: -WHEEL_DELTA, metaKey: true, clientX: POINTER.x, clientY: POINTER.y });
    flushFrame();
    expect(camera().zoom).toBeGreaterThan(1);
  });

  it('TC-17 Safari gesturechange scale 2 doubles the zoom and is prevented', () => {
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperties(change, {
      scale: { value: PINCH_SCALE },
      clientX: { value: POINTER.x },
      clientY: { value: POINTER.y },
    });
    act(() => {
      board().dispatchEvent(start);
      board().dispatchEvent(change);
    });
    flushFrame();
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(camera().zoom).toBe(Math.min(PINCH_SCALE, ZOOM_MAX));
  });

  it('TC-18 Ctrl+=, Ctrl+-, Ctrl+0 step and reset, each preventing page zoom', () => {
    act(() => window.__vidi6?.setCamera({ x: 5, y: 7, zoom: 1 }));
    flushFrame();
    const plus = fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
    flushFrame();
    expect(plus).toBe(false); // dispatchEvent returns false when default was prevented
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);
    const minus = fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true });
    flushFrame();
    expect(minus).toBe(false);
    expect(camera().zoom).toBe(1);
    const zero = fireEvent.keyDown(window, { key: '0', code: 'Digit0', metaKey: true });
    flushFrame();
    expect(zero).toBe(false);
    expect(camera()).toEqual(INITIAL);
    expect(screen.getByRole('status', { name: 'Zoom level' }).textContent).toBe('100%');
  });

  it('keys without Ctrl/Cmd are left to the browser', () => {
    const plain = fireEvent.keyDown(window, { key: '=', code: 'Equal' });
    flushFrame();
    expect(plain).toBe(true);
    expect(camera()).toEqual(INITIAL);
  });

  it('TC-29 click without moving leaves the camera unchanged and keeps the hint', () => {
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    fireEvent.pointerUp(board(), { pointerId: 1, clientX: START.x, clientY: START.y });
    flushFrame();
    expect(camera()).toEqual(INITIAL);
    expect(hintShown()).toBe(true);
  });

  it('TC-29 Reset view on the untouched start view does not dismiss the hint', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    flushFrame();
    expect(hintShown()).toBe(true);
  });

  it('TC-29 a no-op zoom at the limit does not dismiss the hint', () => {
    act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX }));
    flushFrame();
    const atMax = camera();
    fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
    dispatchWheel(board(), { deltaY: -WHEEL_DELTA, ctrlKey: true, clientX: POINTER.x, clientY: POINTER.y });
    flushFrame();
    expect(camera()).toBe(atMax);
    expect(hintShown()).toBe(true);
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or suppress the browser default', () => {
    const controls = screen.getByRole('group', { name: 'Zoom' });
    const e = dispatchWheel(controls, { deltaY: -WHEEL_DELTA, ctrlKey: true });
    flushFrame();
    expect(e.defaultPrevented).toBe(false);
    expect(camera()).toEqual(INITIAL);
  });

  it('zoom buttons step around the centre; label and disabled flags follow', () => {
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    const label = screen.getByRole('status', { name: 'Zoom level' });
    fireEvent.click(zoomIn);
    flushFrame();
    expect(label.textContent).toBe(`${Math.round(ZOOM_STEP_FACTOR * 100)}%`);
    act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX }));
    flushFrame();
    expect(label.textContent).toBe('400%');
    expect(zoomIn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    flushFrame();
    expect(zoomIn.disabled).toBe(false);
  });

  it('pointerdown on a child element (not empty board) does not start a pan', () => {
    fireEvent.pointerDown(screen.getByTestId('board-world'), {
      pointerId: 1,
      button: 0,
      clientX: START.x,
      clientY: START.y,
    });
    expect(board().dataset.mode).toBe('idle');
  });
});
