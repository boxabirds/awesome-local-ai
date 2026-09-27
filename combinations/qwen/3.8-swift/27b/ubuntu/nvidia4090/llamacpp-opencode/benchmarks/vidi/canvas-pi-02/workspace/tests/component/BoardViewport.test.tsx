// Component tests for board viewport input (TC-13 to TC-18, TC-29, TC-30).

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import { WHEEL_ZOOM_SENSITIVITY } from '../../src/shared/config';

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true });
  return e;
}

/** Dispatch a synthetic event and let React flush the resulting work. */
function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

function worldTransform(): { scale: number; tx: number; ty: number } {
  const transform = screen.getByTestId('board-world').style.transform;
  const scale = Number.parseFloat(transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1');
  const inner = transform.match(/translate\(([^)]+)\)/)?.[1] ?? '0px, 0px';
  const [rawX, rawY] = inner.split(',');
  return {
    scale,
    tx: Number.parseFloat(rawX),
    ty: Number.parseFloat(rawY),
  };
}

/** Flush the rAF-batched camera update (fake timers). */
function flush(): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input', () => {
  it('TC-13: drag pans the world layer; state goes Idle to Panning to Idle', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    expect(viewport.dataset.panState).toBe('idle');

    fire(viewport, pointerEvent('pointerdown', 100, 100));
    expect(viewport.dataset.panState).toBe('panning');

    fire(viewport, pointerEvent('pointermove', 300, 200));
    await flush();
    const t = worldTransform();
    expect(t.tx).toBeCloseTo(200, 6);
    expect(t.ty).toBeCloseTo(100, 6);

    fire(viewport, pointerEvent('pointerup', 300, 200));
    expect(viewport.dataset.panState).toBe('idle');
  });

  it('TC-14: pointercancel freezes the camera and later moves are ignored', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');

    fire(viewport, pointerEvent('pointerdown', 100, 100));
    fire(viewport, pointerEvent('pointermove', 200, 200));
    await flush();
    fire(viewport, pointerEvent('pointercancel', 200, 200));
    const atCancel = worldTransform();

    fire(viewport, pointerEvent('pointermove', 400, 400));
    await flush();
    expect(worldTransform()).toEqual(atCancel);
    expect(viewport.dataset.panState).toBe('idle');
  });

  it('TC-15: a plain wheel pans by the delta and is default-prevented', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: 100 });
    fire(viewport, e);
    expect(e.defaultPrevented).toBe(true);

    await flush();
    const t = worldTransform();
    // camera y increased by 100/zoom; content moves up on screen.
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.ty).toBeCloseTo(-100, 6);
  });

  it('TC-16: a Ctrl wheel zooms around the pointer and is default-prevented', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const e = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: 300,
      clientY: 200,
    });
    fire(viewport, e);
    expect(e.defaultPrevented).toBe(true);

    await flush();
    const t = worldTransform();
    expect(t.scale).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 6);
  });

  it('TC-17: a Safari gesturechange zooms by the scale and is default-prevented', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const e = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(e, { scale: 2, clientX: 0, clientY: 0 });
    fire(viewport, e);
    expect(e.defaultPrevented).toBe(true);

    await flush();
    expect(worldTransform().scale).toBeCloseTo(2, 6);
  });

  it('TC-18: Ctrl+=, Ctrl+-, Ctrl+0 zoom step in, out and reset, each prevented', async () => {
    render(<App />);
    const press = async (key: string): Promise<void> => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ctrlKey: true });
      fire(window, e);
      expect(e.defaultPrevented).toBe(true);
      await flush();
    };

    await press('=');
    expect(worldTransform().scale).toBeCloseTo(1.25, 6);

    await press('-');
    expect(worldTransform().scale).toBeCloseTo(1, 6);

    await press('0');
    const t = worldTransform();
    expect(t.scale).toBeCloseTo(1, 6);
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.ty).toBeCloseTo(0, 6);
  });

  it('TC-29: a click without moving leaves the camera and the hint unchanged', async () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    expect(screen.getByTestId('nav-hint')).toBeTruthy();

    fire(viewport, pointerEvent('pointerdown', 50, 50));
    fire(viewport, pointerEvent('pointerup', 50, 50));
    await flush();

    expect(screen.getByTestId('nav-hint')).toBeTruthy();
    const t = worldTransform();
    expect(t.scale).toBeCloseTo(1, 6);
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.ty).toBeCloseTo(0, 6);
  });

  it('TC-30: a Ctrl wheel over the zoom controls does not zoom the board', async () => {
    render(<App />);
    const controls = screen.getByTestId('zoom-controls');
    const e = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaX: 0,
      deltaY: -100,
    });
    fire(controls, e);
    await flush();

    expect(worldTransform().scale).toBeCloseTo(1, 6);
  });
});
