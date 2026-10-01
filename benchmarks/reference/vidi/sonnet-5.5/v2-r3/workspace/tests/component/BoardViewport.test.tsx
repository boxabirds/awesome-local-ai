import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

function readCamera() {
  const t = screen.getByTestId('board-world').style.transform;
  const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(t);
  if (!m) throw new Error(`unparseable transform: ${t}`);
  return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function setup() {
  render(<BoardViewport />);
  const viewport = screen.getByTestId('board-viewport');
  const start = readCamera();
  return { viewport, start };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BoardViewport', () => {
  it('TC-13 drag pans the board by the pointer delta and cycles Idle→Panning→Idle', () => {
    const { viewport, start } = setup();
    expect(viewport.dataset.state).toBe('idle');
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    expect(viewport.dataset.state).toBe('panning');
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    flush();
    expect(readCamera()).toEqual({ zoom: 1, x: start.x - 200, y: start.y - 100 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    const { viewport, start } = setup();
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 50, clientY: 20, pointerId: 1 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 500, clientY: 500, pointerId: 1 });
    flush();
    expect(viewport.dataset.state).toBe('idle');
    expect(readCamera()).toEqual({ zoom: 1, x: start.x - 50, y: start.y - 20 });
  });

  it('TC-15 plain wheel pans and prevents default', () => {
    const { viewport, start } = setup();
    const e = createEvent.wheel(viewport, { deltaY: 100, deltaX: 20 });
    fireEvent(viewport, e);
    flush();
    expect(e.defaultPrevented).toBe(true);
    expect(readCamera()).toEqual({ zoom: 1, x: start.x + 20, y: start.y + 100 });
  });

  it('TC-16 Ctrl wheel zooms around the pointer and prevents default', () => {
    const { viewport, start } = setup();
    const e = createEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent(viewport, e);
    flush();
    expect(e.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(1);
    expect(300 / after.zoom + after.x).toBeCloseTo(300 / start.zoom + start.x, 6);
    expect(200 / after.zoom + after.y).toBeCloseTo(200 / start.zoom + start.y, 6);
  });

  it('TC-17 Safari gesturechange zooms by the scale ratio and prevents default', () => {
    const { viewport } = setup();
    fireEvent(viewport, new Event('gesturestart', { cancelable: true, bubbles: true }));
    const e = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.assign(e, { scale: 2 });
    fireEvent(viewport, e);
    flush();
    expect(e.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(2);
  });

  it('TC-18 Ctrl+=, Ctrl+-, Ctrl+0 step, step back, reset; each prevented', () => {
    const { start } = setup();
    const press = (key: string) => {
      const e = createEvent.keyDown(window, { key, ctrlKey: true });
      fireEvent(window, e);
      flush();
      expect(e.defaultPrevented).toBe(true);
    };
    press('=');
    expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    press('-');
    expect(readCamera().zoom).toBe(1);
    fireEvent.pointerDown(screen.getByTestId('board-viewport'), { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId('board-viewport'), { clientX: 77, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId('board-viewport'), { pointerId: 1 });
    press('0');
    expect(readCamera()).toEqual(start);
  });

  it('TC-29 click without moving leaves the camera and the hint alone', () => {
    const { viewport, start } = setup();
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 10, clientY: 10, pointerId: 1 });
    flush();
    expect(readCamera()).toEqual(start);
    expect(screen.queryByText(HINT)).not.toBeNull();
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or get suppressed', () => {
    const { start } = setup();
    const e = createEvent.wheel(screen.getByRole('button', { name: 'Reset view' }), {
      deltaY: -100,
      ctrlKey: true,
    });
    fireEvent(screen.getByRole('button', { name: 'Reset view' }), e);
    flush();
    expect(readCamera()).toEqual(start);
    expect(e.defaultPrevented).toBe(false);
  });

  it('zoom buttons are wired and respect the max limit', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flush();
    expect(screen.getByRole('status').textContent).toBe('125%');
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      flush();
    }
    expect(readCamera().zoom).toBe(ZOOM_MAX);
    expect(screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')).toBe(true);
  });

  it('hides the hint after the first pan', () => {
    const { viewport } = setup();
    expect(screen.queryByText(HINT)).not.toBeNull();
    fireEvent(viewport, createEvent.wheel(viewport, { deltaY: 10 }));
    flush();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
