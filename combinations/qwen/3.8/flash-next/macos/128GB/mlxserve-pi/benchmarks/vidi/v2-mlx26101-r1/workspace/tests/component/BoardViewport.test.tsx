import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Camera } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
} from '../../src/shared/config';
import App from '../../src/client/App';

function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}
function world(): HTMLElement {
  return screen.getByTestId('world-layer');
}
function label(): HTMLElement {
  return screen.getByTestId('zoom-label');
}
function readCamera(): Camera {
  const d = world().dataset;
  return { x: Number(d.x), y: Number(d.y), zoom: Number(d.zoom) };
}
function interaction(): string {
  return surface().dataset.interaction ?? '';
}

function pointer(type: string, x: number, y: number): void {
  fireEvent(
    surface(),
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

function wheel(
  x: number,
  y: number,
  opts: { deltaX?: number; deltaY?: number; ctrlKey?: boolean } = {},
): boolean {
  const ev = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    deltaX: opts.deltaX ?? 0,
    deltaY: opts.deltaY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
  });
  act(() => {
    surface().dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

function key(k: string, ctrl = true): boolean {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: k,
    ctrlKey: ctrl,
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

describe('viewport.input', () => {
  it('TC-13 drag pans content by exactly the pointer delta (Idle→Panning→Idle)', () => {
    render(<App />);
    const before = readCamera();
    expect(interaction()).toBe('Idle');

    pointer('pointerdown', 100, 100);
    expect(interaction()).toBe('Panning');
    pointer('pointermove', 300, 200); // +200, +100

    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 4);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 4);
    // World layer transform tracks the camera: content moves +200,+100 on screen.
    expect(world().style.transform).toContain('scale(');

    pointer('pointerup', 300, 200);
    expect(interaction()).toBe('Idle');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    render(<App />);
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 150, 130);
    const atCancel = readCamera();
    pointer('pointercancel', 150, 130);
    expect(interaction()).toBe('Idle');

    // A later move (even a spurious one) must not move the board.
    pointer('pointermove', 600, 600);
    const after = readCamera();
    expect(after.x).toBeCloseTo(atCancel.x, 6);
    expect(after.y).toBeCloseTo(atCancel.y, 6);
  });

  it('TC-15 plain wheel pans the camera and is preventDefault-ed', () => {
    render(<App />);
    const before = readCamera();
    const prevented = wheel(10, 10, { deltaY: 100 });
    expect(prevented).toBe(true);
    const after = readCamera();
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 4);
    expect(after.x).toBeCloseTo(before.x, 6);
  });

  it('TC-16 Ctrl + wheel zooms in and is preventDefault-ed', () => {
    render(<App />);
    const before = readCamera();
    const prevented = wheel(300, 200, { deltaY: -100, ctrlKey: true });
    expect(prevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const factor = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    expect(after.zoom).toBeCloseTo(
      Math.min(before.zoom * factor, ZOOM_MAX),
      6,
    );
  });

  it('TC-17 Safari gesturechange doubles zoom and is preventDefault-ed', () => {
    render(<App />);
    const before = readCamera();
    const ev = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'scale', { value: 2 });
    Object.defineProperty(ev, 'clientX', { value: 300 });
    Object.defineProperty(ev, 'clientY', { value: 200 });
    act(() => {
      surface().dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 6);
  });

  it('TC-18 Ctrl + = / - / 0 step and reset, each preventDefault-ed', () => {
    render(<App />);
    expect(label().textContent).toBe('100%');

    expect(key('=')).toBe(true);
    expect(label().textContent).toBe('125%');

    expect(key('-')).toBe(true);
    expect(label().textContent).toBe('100%');

    // Pan away, then Ctrl+0 returns zoom to 100% and recentres the origin.
    wheel(0, 0, { deltaY: 500 });
    expect(key('0')).toBe(true);
    expect(label().textContent).toBe('100%');
    // Viewport is 1280x800 (fake ResizeObserver) so reset centres the origin.
    const c = readCamera();
    expect(c.x).toBeCloseTo(-1280 / 2, 4);
    expect(c.y).toBeCloseTo(-800 / 2, 4);
  });

  it('TC-29 click without moving leaves camera and hint unchanged', () => {
    render(<App />);
    const before = readCamera();
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    pointer('pointerdown', 400, 300);
    pointer('pointerup', 400, 300);
    const after = readCamera();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Hint is still present (nav.hint: no-op does not dismiss it).
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
  });

  it('TC-30 Ctrl + wheel over the zoom control does not zoom the board', () => {
    render(<App />);
    const before = readCamera();
    const controls = screen.getByTestId('zoom-controls');
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -300,
      ctrlKey: true,
    });
    controls.dispatchEvent(ev);
    const after = readCamera();
    expect(after.zoom).toBe(before.zoom);
    // Browser default is not suppressed over the controls.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('grid background scales with zoom', () => {
    render(<App />);
    const zoom = readCamera().zoom;
    expect(surface().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * zoom}px ${GRID_SPACING_WORLD * zoom}px`,
    );
  });
});
