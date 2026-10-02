import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESS_VIEWPORT, Harness } from './harness';

// Camera commits are coalesced with requestAnimationFrame; fake the timers
// and flush frames explicitly.
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

interface WorldLayerTransform {
  zoom: number;
  tx: number;
  ty: number;
}

function readWorldLayerTransform(): WorldLayerTransform {
  const el = screen.getByTestId('world-layer');
  const m = /scale\(([-\d.eE+]+)\) translate\(([-\d.eE+]+)px,\s*([-\d.eE+]+)px\)/.exec(
    el.style.transform,
  );
  if (!m) throw new Error(`unexpected world layer transform: ${el.style.transform}`);
  return { zoom: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) };
}

/** World x coordinate under a screen point, given the world layer transform. */
function worldXUnder(screenX: number, t: WorldLayerTransform): number {
  return screenX / t.zoom - t.tx;
}

/** World y coordinate under a screen point, given the world layer transform. */
function worldYUnder(screenY: number, t: WorldLayerTransform): number {
  return screenY / t.zoom - t.ty;
}

// button: 0 (primary) mirrors a real PointerEvent; jsdom's fallback Event
// leaves it undefined.
const DRAG_START = { clientX: 640, clientY: 400, button: 0, pointerId: 1, pointerType: 'mouse' };
const DRAG_END = { clientX: 840, clientY: 500, button: 0, pointerId: 1, pointerType: 'mouse' };

describe('viewport.input (BoardViewport)', () => {
  it('TC-13 drag pans the board exactly; state goes Idle -> Panning -> Idle', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');
    expect(vp.dataset.state).toBe('idle');

    act(() => {
      fireEvent.pointerDown(vp, DRAG_START);
    });
    expect(vp.dataset.state).toBe('panning');

    act(() => {
      fireEvent.pointerMove(vp, DRAG_END);
    });
    flushFrame();

    // 200px right, 100px down: camera (-640,-400) -> (-840,-500)
    const t = readWorldLayerTransform();
    expect(t.zoom).toBe(1);
    expect(t.tx).toBeCloseTo(HARNESS_VIEWPORT.width / 2 + 200, 6);
    expect(t.ty).toBeCloseTo(HARNESS_VIEWPORT.height / 2 + 100, 6);

    act(() => {
      fireEvent.pointerUp(vp, DRAG_END);
    });
    expect(vp.dataset.state).toBe('idle');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');

    act(() => {
      fireEvent.pointerDown(vp, DRAG_START);
    });
    act(() => {
      fireEvent.pointerMove(vp, { clientX: 740, clientY: 450, button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    act(() => {
      fireEvent.pointerCancel(vp, { button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    flushFrame();

    const atCancel = readWorldLayerTransform();
    expect(atCancel.tx).toBeCloseTo(HARNESS_VIEWPORT.width / 2 + 100, 6);
    expect(atCancel.ty).toBeCloseTo(HARNESS_VIEWPORT.height / 2 + 50, 6);

    act(() => {
      fireEvent.pointerMove(vp, { clientX: 900, clientY: 600, button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    flushFrame();

    const after = readWorldLayerTransform();
    expect(after.tx).toBe(atCancel.tx);
    expect(after.ty).toBe(atCancel.ty);
    expect(vp.dataset.state).toBe('idle');
  });

  it('TC-15 plain wheel pans in the scroll direction and is defaultPrevented', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');
    const before = readWorldLayerTransform();

    const notCancelled = fireEvent.wheel(vp, {
      clientX: 100,
      clientY: 100,
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
    });
    flushFrame();

    expect(notCancelled).toBe(false); // preventDefault was called
    const after = readWorldLayerTransform();
    // Scroll down (deltaY +100): content moves up; camera y += 100/zoom
    // (the world layer translate ty = -camera.y, so it decreases).
    expect(before.ty - after.ty).toBeCloseTo(100 / before.zoom, 6);
    expect(after.tx).toBeCloseTo(before.tx, 6);
  });

  it('TC-16 Ctrl-wheel zooms in around the pointer and is defaultPrevented', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');
    const before = readWorldLayerTransform();

    const notCancelled = fireEvent.wheel(vp, {
      clientX: 300,
      clientY: 200,
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
    });
    flushFrame();

    expect(notCancelled).toBe(false);
    const after = readWorldLayerTransform();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // The world point under the pointer stays under the pointer.
    expect(worldXUnder(300, after)).toBeCloseTo(worldXUnder(300, before), 6);
    expect(worldYUnder(200, after)).toBeCloseTo(worldYUnder(200, before), 6);
  });

  it('TC-17 Safari gesturechange zooms by the scale ratio and is defaultPrevented', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');

    const ev = new Event('gesturechange', { cancelable: true });
    Object.defineProperty(ev, 'scale', { value: 2 });
    let notCancelled = true;
    act(() => {
      notCancelled = vp.dispatchEvent(ev);
    });
    flushFrame();

    expect(notCancelled).toBe(false);
    const after = readWorldLayerTransform();
    expect(after.zoom).toBeCloseTo(2, 6);
  });

  it('TC-18 Ctrl/Cmd + = / - / 0 zoom in, zoom out, reset; each defaultPrevented', () => {
    render(<Harness />);
    const vp = screen.getByTestId('board-viewport');

    const p1 = fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    flushFrame();
    let t = readWorldLayerTransform();
    expect(p1).toBe(false);
    expect(t.zoom).toBeCloseTo(1.25, 6);

    const p2 = fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    flushFrame();
    t = readWorldLayerTransform();
    expect(p2).toBe(false);
    expect(t.zoom).toBe(1);

    // Move away, then reset back to the standard view.
    fireEvent.wheel(vp, {
      clientX: 100,
      clientY: 100,
      deltaX: 300,
      deltaY: 200,
      deltaMode: 0,
    });
    flushFrame();

    const p3 = fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    flushFrame();
    t = readWorldLayerTransform();
    expect(p3).toBe(false);
    expect(t.zoom).toBe(1);
    expect(t.tx).toBeCloseTo(HARNESS_VIEWPORT.width / 2, 6);
    expect(t.ty).toBeCloseTo(HARNESS_VIEWPORT.height / 2, 6);
  });

  it('TC-29 a click without movement leaves the camera unchanged and the hint visible', () => {
    render(<Harness withHint />);
    const vp = screen.getByTestId('board-viewport');
    const before = readWorldLayerTransform();

    act(() => {
      fireEvent.pointerDown(vp, DRAG_START);
      fireEvent.pointerUp(vp, DRAG_START);
    });
    flushFrame();

    const after = readWorldLayerTransform();
    expect(after).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('TC-30 Ctrl-wheel over the zoom controls does not zoom the board', () => {
    render(<Harness withControls />);
    const before = readWorldLayerTransform();

    const controls = screen
      .getByRole('button', { name: 'Zoom in' })
      .closest('.zoom-controls') as HTMLElement;
    fireEvent.wheel(controls, {
      clientX: 10,
      clientY: 10,
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
    });
    flushFrame();

    const after = readWorldLayerTransform();
    expect(after).toEqual(before);
  });
});
