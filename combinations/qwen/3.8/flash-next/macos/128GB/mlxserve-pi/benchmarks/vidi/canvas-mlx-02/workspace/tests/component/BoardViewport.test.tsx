import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport.tsx';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  ZOOM_STEP_FACTOR,
  ZOOM_MAX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../src/shared/config.ts';

// requestAnimationFrame is faked; advancing past a frame flushes the
// coalesced camera update (the board batches at most one render per frame).
function flush() {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

function cam() {
  const el = screen.getByTestId('world-layer');
  return {
    x: Number(el.getAttribute('data-cam-x')),
    y: Number(el.getAttribute('data-cam-y')),
    zoom: Number(el.getAttribute('data-cam-zoom')),
    transform: el.getAttribute('data-transform') ?? '',
  };
}

function originScreen(): { x: number; y: number } {
  const el = screen.getByTestId('origin-screen');
  return { x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')) };
}

function scaleOf(transform: string): number {
  const m = /scale\(([-\d.]+)\)/.exec(transform);
  return m ? Number(m[1]) : NaN;
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('viewport drag (pan)', () => {
  // TC-13: press + move (200,100) + up moves the board exactly that far, world
  // layer transform matches the camera, and it returns to Idle.
  it('TC-13 moves the board by exactly the pointer delta', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');
    const before = cam();

    fireEvent.pointerDown(vp, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 300, clientY: 200, pointerId: 1 });
    flush();
    fireEvent.pointerUp(vp, { clientX: 300, clientY: 200, pointerId: 1 });
    flush();

    const after = cam();
    expect(after.x).toBeCloseTo(before.x - 200, 3);
    expect(after.y).toBeCloseTo(before.y - 100, 3);
    // world layer transform encodes the same camera (translate = -cam.x, -cam.y)
    expect(scaleOf(after.transform)).toBeCloseTo(before.zoom, 6);
    // the world origin now sits 200,100 further right/down on screen
    expect(originScreen().x).toBeCloseTo(0 - after.x, 3);
    expect(originScreen().y).toBeCloseTo(0 - after.y, 3);

    // Idle: further moves do nothing without a new pointerdown
    fireEvent.pointerMove(vp, { clientX: 0, clientY: 0, pointerId: 1 });
    flush();
    expect(cam().x).toBeCloseTo(after.x, 6);
  });

  // TC-14: pointercancel freezes the camera at interruption; later moves ignored.
  it('TC-14 freezes the camera at pointercancel and ignores later moves', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');

    fireEvent.pointerDown(vp, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 150, clientY: 40, pointerId: 1 });
    flush();
    const atCancel = cam();
    fireEvent.pointerCancel(vp, { pointerId: 1 });
    flush();

    fireEvent.pointerMove(vp, { clientX: 999, clientY: 999, pointerId: 1 });
    flush();
    const after = cam();
    expect(after.x).toBeCloseTo(atCancel.x, 6);
    expect(after.y).toBeCloseTo(atCancel.y, 6);
  });

  // TC-29 (negative): a click with no movement leaves the camera unchanged.
  it('TC-29 leaves the camera unchanged for a click with no movement', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');
    const before = cam();

    fireEvent.pointerDown(vp, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    flush();
    fireEvent.pointerUp(vp, { clientX: 200, clientY: 200, pointerId: 1 });
    flush();

    const after = cam();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('viewport wheel', () => {
  // TC-15: plain wheel down moves content up (camera.y += deltaY/zoom); prevented.
  it('TC-15 pans on a plain wheel and prevents default', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');
    const before = cam();

    const ev = fireEvent.wheel(vp, { deltaX: 0, deltaY: 100, deltaMode: 0 });
    flush();

    const after = cam();
    expect(after.y).toBeCloseTo(before.y + 100, 3);
    // content moved up => origin screen y shrank by 100
    expect(originScreen().y).toBeCloseTo(-after.y, 3);
    // fireEvent returns false when the event was defaultPrevented
    expect(ev).toBe(false);
  });

  // TC-16: Ctrl+wheel zooms (zoom increases); prevented.
  it('TC-16 zooms on ctrl+wheel and prevents default', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');
    const before = cam();
    const expected = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);

    const ev = fireEvent.wheel(vp, {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    flush();

    const after = cam();
    expect(after.zoom).toBeCloseTo(before.zoom * expected, 4);
    expect(ev).toBe(false);
  });
});

describe('viewport safari gesture', () => {
  // TC-17: synthetic gesturechange scale 2 doubles the zoom (clamped); prevented.
  it('TC-17 zooms on gesturechange and prevents default', () => {
    render(<BoardViewport />);
    const vp = screen.getByTestId('viewport');

    fireEvent(vp, new Event('gesturestart', { bubbles: true, cancelable: true }));

    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 2, clientX: 300, clientY: 200 });
    const prevented = fireEvent(vp, change);
    flush();

    expect(cam().zoom).toBeCloseTo(2, 3);
    expect(prevented).toBe(false);
    expect(change.defaultPrevented).toBe(true);
  });
});

describe('viewport keyboard shortcuts', () => {
  // TC-18: Ctrl+=, Ctrl+-, Ctrl+0 -> 1.0 -> 1.25 -> 1.0 -> reset; each prevented.
  it('TC-18 zooms with keyboard and prevents default each time', () => {
    render(<BoardViewport />);

    const eq = fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    flush();
    expect(cam().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
    expect(eq).toBe(false);

    const minus = fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    flush();
    expect(cam().zoom).toBeCloseTo(1, 9);
    expect(minus).toBe(false);

    const zero = fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    flush();
    expect(cam().zoom).toBeCloseTo(1, 9);
    expect(cam().x).toBeCloseTo(-window.innerWidth / 2, 1);
    expect(cam().y).toBeCloseTo(-window.innerHeight / 2, 1);
    expect(zero).toBe(false);
  });

  it('clamps keyboard zoom-in at ZOOM_MAX', () => {
    render(<BoardViewport />);
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(window, { key: '=', ctrlKey: true });
      flush();
    }
    expect(cam().zoom).toBeCloseTo(ZOOM_MAX, 6);
  });
});

describe('wheel over the zoom controls', () => {
  // TC-30 (negative): Ctrl+wheel over the controls must not zoom the board.
  it('TC-30 does not zoom the board when ctrl+wheel is over the controls', () => {
    render(<BoardApp boardId={newBoardId()} />);
    const controls = screen.getByTestId('zoom-controls');
    const before = cam();

    fireEvent.wheel(controls, {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 1200,
      clientY: 780,
    });
    flush();

    const after = cam();
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
