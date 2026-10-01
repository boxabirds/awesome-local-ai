import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const WORLD = 'board-world';
const FRAME_MS = 20;

function worldTransform(): { zoom: number; tx: number; ty: number } {
  const t = screen.getByTestId(WORLD).style.transform;
  const m = /scale\(([-\d.e+]+)\) translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)/.exec(t);
  if (!m) throw new Error(`unparseable transform: ${t}`);
  return { zoom: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) };
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

function zoomLabel(): string {
  return screen.getByTestId('zoom-label').textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BoardViewport', () => {
  it('TC-13 drag pans by the pointer delta and returns to idle', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    const before = worldTransform();
    expect(viewport.dataset.mode).toBe('idle');
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    expect(viewport.dataset.mode).toBe('panning');
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    flush();
    const during = worldTransform();
    expect(during.tx - before.tx).toBe(200 / before.zoom);
    expect(during.ty - before.ty).toBe(100 / before.zoom);
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(viewport.dataset.mode).toBe('idle');
  });

  it('TC-14 pointercancel freezes the camera', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(viewport, { clientX: 50, clientY: 20, pointerId: 1 });
    flush();
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    const atCancel = worldTransform();
    fireEvent.pointerMove(viewport, { clientX: 400, clientY: 400, pointerId: 1 });
    flush();
    expect(worldTransform()).toEqual(atCancel);
    expect(viewport.dataset.mode).toBe('idle');
  });

  it('TC-15 plain wheel pans in the scroll direction and is prevented', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    const before = worldTransform();
    const ev = createEvent.wheel(viewport, { deltaX: 40, deltaY: 100 });
    fireEvent(viewport, ev);
    flush();
    const after = worldTransform();
    // camera.y grows by 100/zoom, so translate(-y) shrinks by the same amount.
    expect(before.ty - after.ty).toBe(100 / before.zoom);
    expect(before.tx - after.tx).toBe(40 / before.zoom);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('TC-16 ctrl wheel zooms and is prevented', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    const before = worldTransform();
    const ev = createEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent(viewport, ev);
    flush();
    expect(worldTransform().zoom).toBeGreaterThan(before.zoom);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('TC-17 safari gesturechange zooms by the scale ratio', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    const before = worldTransform();
    const start = new Event('gesturestart', { cancelable: true });
    fireEvent(viewport, start);
    const change = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.assign(change, { scale: 2, clientX: 300, clientY: 200 });
    fireEvent(viewport, change);
    flush();
    expect(worldTransform().zoom).toBe(Math.min(before.zoom * 2, ZOOM_MAX));
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
  });

  it('TC-18 keyboard shortcuts zoom and reset and are prevented', () => {
    render(<BoardViewport />);
    const press = (key: string) => {
      const ev = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(ev);
      });
      flush();
      expect(ev.defaultPrevented).toBe(true);
    };
    press('=');
    expect(worldTransform().zoom).toBe(ZOOM_STEP_FACTOR);
    press('-');
    expect(worldTransform().zoom).toBe(1);
    press('=');
    press('0');
    expect(worldTransform().zoom).toBe(1);
    const reset = worldTransform();
    expect(reset.tx).toBe(window.innerWidth / 2);
    expect(reset.ty).toBe(window.innerHeight / 2);
  });

  it('TC-29 click without moving leaves the camera and hint alone', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    const before = worldTransform();
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 10, clientY: 10, pointerId: 1 });
    flush();
    expect(worldTransform()).toEqual(before);
    expect(screen.queryByTestId('navigation-hint')).not.toBeNull();
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    render(<BoardViewport />);
    const before = worldTransform();
    const ev = createEvent.wheel(screen.getByLabelText('Zoom in'), { deltaY: -100, ctrlKey: true });
    fireEvent(screen.getByLabelText('Zoom in'), ev);
    flush();
    expect(worldTransform()).toEqual(before);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('shows zoom limits through the integrated controls (TC-19/20 wiring)', () => {
    render(<BoardViewport />);
    for (let i = 0; i < 40; i++) {
      fireEvent.click(screen.getByLabelText('Zoom out'));
      flush();
    }
    expect(zoomLabel()).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 40; i++) {
      fireEvent.click(screen.getByLabelText('Zoom in'));
      flush();
    }
    expect(zoomLabel()).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true);
  });
});
