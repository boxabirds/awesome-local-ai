import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const viewportEl = () => screen.getByTestId('board-viewport');
const worldEl = () => screen.getByTestId('world-layer');
const zoomLabel = () => screen.getByTestId('zoom-label');

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function readCamera(): { x: number; y: number; zoom: number } {
  const raw = worldEl().getAttribute('data-camera')!;
  const [x, y, zoom] = raw.split(',').map(Number);
  return { x, y, zoom };
}

function dispatchWheel(
  el: Element,
  init: { deltaY: number; ctrlKey?: boolean; clientX?: number; clientY?: number; deltaX?: number },
): WheelEvent {
  const ev = new WheelEvent('wheel', {
    deltaY: init.deltaY,
    deltaX: init.deltaX ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

function keyDown(key: string, mods: { ctrl?: boolean; meta?: boolean }): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

describe('viewport.input', () => {
  it('TC-13: drag pans the world layer; state goes Idle -> Panning -> Idle', () => {
    render(<App />);
    flush();
    expect(viewportEl().getAttribute('data-interaction')).toBe('idle');
    const start = readCamera();

    fireEvent.pointerDown(viewportEl(), { clientX: 300, clientY: 300, pointerId: 1 });
    expect(viewportEl().getAttribute('data-interaction')).toBe('panning');
    fireEvent.pointerMove(viewportEl(), { clientX: 500, clientY: 400, pointerId: 1 });
    flush();

    const moved = readCamera();
    expect(moved.x).toBeCloseTo(start.x - 200, 6);
    expect(moved.y).toBeCloseTo(start.y - 100, 6);
    expect(worldEl().style.transform).toBe(
      `scale(1) translate(${-moved.x}px, ${-moved.y}px)`,
    );

    fireEvent.pointerUp(viewportEl(), { pointerId: 1 });
    expect(viewportEl().getAttribute('data-interaction')).toBe('idle');
  });

  it('TC-14: pointercancel freezes the camera; later moves are ignored', () => {
    render(<App />);
    flush();
    fireEvent.pointerDown(viewportEl(), { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewportEl(), { clientX: 180, clientY: 160, pointerId: 1 });
    flush();
    const frozen = readCamera();

    fireEvent.pointerCancel(viewportEl(), { pointerId: 1 });
    fireEvent.pointerMove(viewportEl(), { clientX: 400, clientY: 900, pointerId: 1 });
    flush();

    expect(readCamera()).toEqual(frozen);
    expect(viewportEl().getAttribute('data-interaction')).toBe('idle');
  });

  it('TC-15: plain wheel scrolls; camera.y += deltaY/zoom; default prevented', () => {
    render(<App />);
    flush();
    const start = readCamera();
    const ev = dispatchWheel(viewportEl(), { deltaY: 100 });
    flush();
    const after = readCamera();
    expect(ev.defaultPrevented).toBe(true);
    expect(after.y).toBeCloseTo(start.y + 100 / start.zoom, 6);
    expect(after.zoom).toBe(start.zoom);
  });

  it('TC-16: ctrl wheel over the board zooms in; default prevented', () => {
    render(<App />);
    flush();
    const start = readCamera();
    const ev = dispatchWheel(viewportEl(), { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    flush();
    const after = readCamera();
    expect(ev.defaultPrevented).toBe(true);
    expect(after.zoom).toBeGreaterThan(start.zoom);
  });

  it('TC-17: Safari gesturechange with scale 2 doubles zoom; default prevented', () => {
    render(<App />);
    flush();
    const start = readCamera();
    const ev = new Event('gesturechange', { bubbles: true, cancelable: true }) as Event & {
      scale: number;
    };
    ev.scale = 2;
    act(() => {
      viewportEl().dispatchEvent(ev);
    });
    flush();
    const after = readCamera();
    expect(ev.defaultPrevented).toBe(true);
    expect(after.zoom).toBeCloseTo(Math.min(start.zoom * 2, 4), 6);
  });

  it('TC-18: Ctrl+=, Ctrl+-, Ctrl+0 step and reset; each default prevented', () => {
    render(<App />);
    flush();
    expect(zoomLabel().textContent).toBe('100%');

    expect(keyDown('=', { ctrl: true }).defaultPrevented).toBe(true);
    flush();
    expect(zoomLabel().textContent).toBe('125%');

    expect(keyDown('-', { ctrl: true }).defaultPrevented).toBe(true);
    flush();
    expect(zoomLabel().textContent).toBe('100%');

    expect(keyDown('0', { ctrl: true }).defaultPrevented).toBe(true);
    flush();
    expect(zoomLabel().textContent).toBe('100%');
    const cam = readCamera();
    expect(cam.zoom).toBe(1);
  });

  it('TC-29: click without moving leaves camera unchanged and keeps the hint', () => {
    render(<App />);
    flush();
    const start = readCamera();
    expect(screen.queryByTestId('navigation-hint')).not.toBeNull();
    fireEvent.pointerDown(viewportEl(), { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(viewportEl(), { pointerId: 1 });
    flush();
    expect(readCamera()).toEqual(start);
    expect(screen.queryByTestId('navigation-hint')).not.toBeNull();
  });

  it('TC-30: ctrl wheel over the zoom controls does not zoom the board', () => {
    render(<App />);
    flush();
    const start = readCamera();
    const controls = screen.getByTestId('zoom-controls');
    const ev = dispatchWheel(controls, { deltaY: -100, ctrlKey: true });
    flush();
    expect(readCamera()).toEqual(start);
    expect(ev.defaultPrevented).toBe(false);
  });
});
