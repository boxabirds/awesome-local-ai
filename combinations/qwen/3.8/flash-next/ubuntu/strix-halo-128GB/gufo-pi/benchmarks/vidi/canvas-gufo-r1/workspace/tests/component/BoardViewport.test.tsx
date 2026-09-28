import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZOOM_MAX, GRID_SPACING_WORLD } from '../../src/shared/config';

afterEach(cleanup);

interface CamSnapshot {
  zoom: number;
  x: number;
  y: number;
}

function readCamera(): CamSnapshot {
  const el = screen.getByTestId('world-layer') as HTMLElement;
  const t = el.style.transform;
  const m = t.match(/scale\(([^)]+)\)\s*translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  if (!m) throw new Error(`Unexpected world transform: "${t}"`);
  return { zoom: parseFloat(m[1]), x: -parseFloat(m[2]), y: -parseFloat(m[3]) };
}

function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}
function grid(): HTMLElement {
  return screen.getByTestId('board-grid');
}

function mount() {
  render(<BoardViewport />);
}

// Dispatch inside act() so React flushes state (and re-renders the transform)
// before the next assertion. jsdom has no PointerEvent constructor, so pointer
// events are dispatched as MouseEvent with the pointer type.
function dispatch(target: EventTarget, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
}

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
function pointer(type: PointerType, el: Element, x = 0, y = 0) {
  const ev = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  dispatch(el, ev);
}

describe('BoardViewport input', () => {
  // TC-13
  it('TC-13 drag moves the world layer to match the camera (Idle→Panning→Idle)', () => {
    mount();
    const before = readCamera();
    pointer('pointerdown', grid(), 0, 0);
    expect(surface()).toHaveAttribute('data-interaction', 'panning');
    pointer('pointermove', surface(), 200, 100);
    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 6);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 6);
    pointer('pointerup', surface());
    expect(surface()).toHaveAttribute('data-interaction', 'idle');
  });

  // TC-14
  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    mount();
    pointer('pointerdown', grid(), 0, 0);
    pointer('pointermove', surface(), 100, 50);
    const atCancel = readCamera();
    pointer('pointercancel', surface());
    expect(readCamera()).toEqual(atCancel);
    pointer('pointermove', surface(), 900, 900);
    expect(readCamera()).toEqual(atCancel);
  });

  // TC-15
  it('TC-15 plain wheel pans the camera and prevents the default', () => {
    mount();
    const before = readCamera();
    const ev = new WheelEvent('wheel', {
      deltaY: 100,
      deltaMode: 0,
      clientX: 600,
      clientY: 400,
      bubbles: true,
      cancelable: true,
    });
    dispatch(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeCloseTo(before.zoom, 9);
    expect(after.y - before.y).toBeCloseTo(100 / before.zoom, 6);
  });

  // TC-16
  it('TC-16 Ctrl wheel zooms around the pointer and prevents the default', () => {
    mount();
    const before = readCamera();
    const ev = new WheelEvent('wheel', {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });
    dispatch(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
  });

  // TC-17
  it('TC-17 Safari gesturechange zooms and prevents the default', () => {
    mount();
    const before = readCamera();
    const ev = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(ev, { scale: 2, clientX: 300, clientY: 200 });
    dispatch(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 6);
  });

  // TC-18
  it('TC-18 Ctrl/Cmd = / - / 0 zoom step in, out and reset; each prevented', () => {
    mount();
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('100%');

    const k1 = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    dispatch(window, k1);
    expect(k1.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('125%');

    const k2 = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    dispatch(window, k2);
    expect(k2.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('100%');

    const k0 = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    dispatch(window, k0);
    expect(k0.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('100%');
    const cam = readCamera();
    expect(cam.x).toBeCloseTo(-600, 6);
    expect(cam.y).toBeCloseTo(-400, 6);
  });

  // TC-29 (negative)
  it('TC-29 a click without movement leaves the camera and hint untouched', () => {
    mount();
    const before = readCamera();
    pointer('pointerdown', grid(), 0, 0);
    pointer('pointerup', surface());
    expect(readCamera()).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  // TC-30 (negative)
  it('TC-30 Ctrl wheel over the zoom control does not zoom the board', () => {
    mount();
    const before = readCamera();
    const ev = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    dispatch(screen.getByLabelText('Zoom in'), ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(readCamera()).toEqual(before);
  });

  it('renders a dot grid whose spacing scales with zoom', () => {
    mount();
    const g = grid() as HTMLElement;
    expect(g.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * 1}px ${GRID_SPACING_WORLD * 1}px`,
    );
    const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    dispatch(surface(), ev);
    const zoom = readCamera().zoom;
    expect(g.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * zoom}px ${GRID_SPACING_WORLD * zoom}px`,
    );
  });

  // TC-22 (hint latch driven through the real component)
  it('TC-22 hint is visible, hides after the first navigation and stays hidden', () => {
    mount();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    pointer('pointerdown', grid(), 0, 0);
    pointer('pointermove', surface(), 50, 0);
    pointer('pointerup', surface());
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    pointer('pointerdown', grid(), 0, 0);
    pointer('pointermove', surface(), 0, 80);
    pointer('pointerup', surface());
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});
