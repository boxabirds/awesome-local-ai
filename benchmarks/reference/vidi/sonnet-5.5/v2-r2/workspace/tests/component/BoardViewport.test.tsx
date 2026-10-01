import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const FRAME_MS = 20;

function readCamera() {
  const t = screen.getByTestId('world-layer').style.transform;
  const m = /scale\(([^)]+)\) translate\(([^p]+)px, ([^p]+)px\)/.exec(t);
  if (!m) throw new Error(`unparseable transform: ${t}`);
  return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
}

function flush() {
  act(() => { vi.advanceTimersByTime(FRAME_MS); });
}

function viewport() {
  return screen.getByTestId('board-viewport');
}

function pointer(type: string, el: Element, x: number, y: number) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('BoardViewport input', () => {
  it('TC-13 drag moves the world layer by the pointer delta; cursor reflects state', () => {
    render(<App />);
    const start = readCamera();
    pointer('pointerdown', viewport(), 100, 100);
    expect(viewport().style.cursor).toBe('grabbing');
    pointer('pointermove', viewport(), 300, 200);
    flush();
    const after = readCamera();
    expect(after.x).toBe(start.x - 200);
    expect(after.y).toBe(start.y - 100);
    pointer('pointerup', viewport(), 300, 200);
    expect(viewport().style.cursor).toBe('grab');
    pointer('pointermove', viewport(), 500, 500);
    flush();
    expect(readCamera()).toEqual(after);
  });

  it('TC-14 pointercancel freezes the camera', () => {
    render(<App />);
    pointer('pointerdown', viewport(), 0, 0);
    pointer('pointermove', viewport(), 50, 20);
    flush();
    const atCancel = readCamera();
    pointer('pointercancel', viewport(), 50, 20);
    pointer('pointermove', viewport(), 400, 400);
    flush();
    expect(readCamera()).toEqual(atCancel);
  });

  it('TC-15 plain wheel pans and is default-prevented', () => {
    render(<App />);
    const start = readCamera();
    const ev = createEvent.wheel(viewport(), { deltaY: 100, deltaX: 20 });
    fireEvent(viewport(), ev);
    flush();
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.y).toBe(start.y + 100 / start.zoom);
    expect(after.x).toBe(start.x + 20 / start.zoom);
  });

  it('TC-16 ctrl wheel zooms around the pointer and is default-prevented', () => {
    render(<App />);
    const start = readCamera();
    const ev = createEvent.wheel(viewport(), { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent(viewport(), ev);
    flush();
    expect(ev.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(start.zoom);
    expect(300 / after.zoom + after.x).toBeCloseTo(300 / start.zoom + start.x, 6);
    expect(200 / after.zoom + after.y).toBeCloseTo(200 / start.zoom + start.y, 6);
  });

  it('TC-17 gesturechange zooms by the scale ratio', () => {
    render(<App />);
    const ev = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(ev, { scale: 2, clientX: 100, clientY: 100 });
    act(() => { viewport().dispatchEvent(ev); });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(2);
  });

  it('TC-18 keyboard shortcuts zoom and reset, preventing page zoom', () => {
    render(<App />);
    const press = (key: string) => {
      const ev = createEvent.keyDown(window, { key, ctrlKey: true });
      fireEvent(window, ev);
      flush();
      expect(ev.defaultPrevented).toBe(true);
    };
    press('=');
    expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    press('-');
    expect(readCamera().zoom).toBe(1);
    press('=');
    press('=');
    press('0');
    expect(readCamera().zoom).toBe(1);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('zoom keys stop at the maximum', () => {
    render(<App />);
    for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: '=', metaKey: true });
    flush();
    expect(readCamera().zoom).toBe(ZOOM_MAX);
    expect(screen.getByLabelText('Zoom in')).toHaveProperty('disabled', true);
  });

  it('TC-29 click without moving leaves camera and hint alone', () => {
    render(<App />);
    const start = readCamera();
    pointer('pointerdown', viewport(), 10, 10);
    pointer('pointerup', viewport(), 10, 10);
    flush();
    expect(readCamera()).toEqual(start);
    expect(screen.queryByText(HINT)).not.toBeNull();
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    render(<App />);
    const start = readCamera();
    const ev = createEvent.wheel(screen.getByLabelText('Zoom in'), { deltaY: -100, ctrlKey: true });
    fireEvent(screen.getByLabelText('Zoom in'), ev);
    flush();
    expect(readCamera()).toEqual(start);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('wheel with page deltaMode is converted to pixels', () => {
    render(<App />);
    const start = readCamera();
    fireEvent.wheel(viewport(), { deltaY: 1, deltaMode: 1 });
    flush();
    expect(readCamera().y).toBe(start.y + 16);
  });
});
