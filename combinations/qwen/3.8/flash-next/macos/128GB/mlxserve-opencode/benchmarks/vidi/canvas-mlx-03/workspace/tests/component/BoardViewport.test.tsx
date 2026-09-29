import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { ZOOM_STEP_FACTOR, ZOOM_MAX } from '../../src/shared/config.ts';

function flush() {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

// Parse the world-layer CSS transform into scale + translate (the camera view).
function view(): { scale: number; tx: number; ty: number } {
  const t = screen.getByTestId('world-layer').style.transform;
  const s = /scale\(([-\d.]+)\)/.exec(t);
  const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
  return {
    scale: Number(s?.[1]),
    tx: Number(tr?.[1]),
    ty: Number(tr?.[2]),
  };
}

function zoomLabel(): string {
  return screen.getByTestId('zoom-label').textContent ?? '';
}

// jsdom's PointerEvent does not carry clientX, so dispatch a MouseEvent of the
// pointer type (React delegates by event name). Coordinates arrive correctly.
function firePointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}

function fire(ev: Event, el: Element) {
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input', () => {
  it('TC-13 drag 200,100 moves the world layer by the camera delta', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 20, 30);
    firePointer(vp, 'pointermove', 220, 130);
    firePointer(vp, 'pointerup', 220, 130);
    flush();
    const v = view();
    expect(v.scale).toBeCloseTo(1, 6);
    // camera x,y = -200,-100 => world layer translate by +200,+100
    expect(v.tx).toBeCloseTo(200, 3);
    expect(v.ty).toBeCloseTo(100, 3);
  });

  it('TC-14 pointercancel freezes the camera; later moves ignored', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 10, 10);
    firePointer(vp, 'pointermove', 110, 60);
    flush();
    const atCancel = view();
    expect(atCancel.tx).toBeCloseTo(100, 3);
    expect(atCancel.ty).toBeCloseTo(50, 3);
    firePointer(vp, 'pointercancel', 110, 60);
    firePointer(vp, 'pointermove', 900, 900);
    flush();
    const after = view();
    expect(after.tx).toBeCloseTo(100, 3);
    expect(after.ty).toBeCloseTo(50, 3);
  });

  it('TC-15 plain wheel moves camera by delta/zoom and prevents default', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    const ev = new WheelEvent('wheel', {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
      bubbles: true,
      clientX: 100,
      clientY: 100,
    });
    fire(ev, vp);
    flush();
    const v = view();
    // scroll down => camera y increases by 100/zoom => translate y -100
    expect(v.ty).toBeCloseTo(-100, 3);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('TC-16 ctrl wheel increases zoom and prevents default', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    const ev = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
      clientX: 300,
      clientY: 200,
    });
    fire(ev, vp);
    flush();
    expect(view().scale).toBeGreaterThan(1);
    expect(zoomLabel()).toMatch(/\d+%/);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('TC-17 Safari gesturechange scale 2 doubles zoom and prevents default', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    const start = new Event('gesturestart', { cancelable: true, bubbles: true }) as Event & { scale: number };
    start.scale = 1;
    fire(start, vp);
    const change = new Event('gesturechange', { cancelable: true, bubbles: true }) as Event & { scale: number };
    change.scale = 2;
    fire(change, vp);
    flush();
    expect(view().scale).toBeCloseTo(2, 3);
    expect(change.defaultPrevented).toBe(true);
  });

  it('TC-18 Ctrl+=, Ctrl+-, Ctrl+0 each preventDefault and step / reset zoom', () => {
    render(<BoardApp />);
    const key = (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(ev);
      });
      flush();
      expect(ev.defaultPrevented).toBe(true);
    };
    key('=');
    expect(zoomLabel()).toBe(`${Math.round(ZOOM_STEP_FACTOR * 100)}%`);
    key('-');
    expect(zoomLabel()).toBe('100%');
    // Pan away, then reset.
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 0, 0);
    firePointer(vp, 'pointermove', 500, 500);
    firePointer(vp, 'pointerup', 500, 500);
    flush();
    key('0');
    expect(zoomLabel()).toBe('100%');
    const v = view();
    // resetCamera for the 1280x800 default viewport => translate(640, 400)
    expect(v.scale).toBeCloseTo(1, 6);
    expect(v.tx).toBeCloseTo(640, 3);
    expect(v.ty).toBeCloseTo(400, 3);
  });

  it('TC-18b step in reaches ZOOM_MAX after many presses', () => {
    render(<BoardApp />);
    for (let i = 0; i < 20; i++) {
      const ev = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => window.dispatchEvent(ev));
      flush();
    }
    expect(zoomLabel()).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  it('TC-29 click without moving leaves camera unchanged and keeps the hint', () => {
    render(<BoardApp />);
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 40, 40);
    firePointer(vp, 'pointerup', 40, 40);
    flush();
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();
    const v = view();
    expect(v.tx).toBeCloseTo(0, 6);
    expect(v.ty).toBeCloseTo(0, 6);
    expect(v.scale).toBeCloseTo(1, 6);
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    render(<BoardApp />);
    const controls = screen.getByTestId('zoom-controls');
    const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    fire(ev, controls);
    flush();
    const v = view();
    expect(v.scale).toBeCloseTo(1, 6);
    expect(v.tx).toBeCloseTo(0, 6);
    // browser default not suppressed over the control
    expect(ev.defaultPrevented).toBe(false);
  });
});
