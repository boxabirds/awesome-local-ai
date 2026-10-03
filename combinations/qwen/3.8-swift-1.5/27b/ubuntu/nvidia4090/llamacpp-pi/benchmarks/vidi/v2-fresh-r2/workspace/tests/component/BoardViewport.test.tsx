import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_STEP_FACTOR } from '../../src/shared/config';

/**
 * Viewport input tests (TC-13..TC-18, TC-29, TC-30).
 *
 * rAF is faked: camera updates are coalesced per animation frame, so each
 * interaction is followed by `flushFrame()`.
 */

function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

/** Parse `scale(z) translate(-xpx, -ypx)` back into a camera. */
function readCamera(transform: string): { x: number; y: number; zoom: number } {
  const match = /scale\(([-0-9.e]+)\) translate\(([-0-9.e]+)px, ([-0-9.e]+)px\)/.exec(transform);
  if (!match) throw new Error(`unparseable transform: ${transform}`);
  return {
    zoom: Number(match[1]),
    x: 0 - Number(match[2]),
    y: 0 - Number(match[3]),
  };
}

function worldLayerTransform(): string {
  return screen.getByTestId('world-layer').style.transform;
}

type EventCtor = new (type: string, init?: Record<string, unknown>) => Event;

function firePointer(type: string, x: number, y: number): void {
  const g = globalThis as { PointerEvent?: EventCtor; MouseEvent: EventCtor };
  const Ctor = g.PointerEvent ?? g.MouseEvent;
  const viewport = screen.getByTestId('board-viewport');
  act(() => {
    viewport.dispatchEvent(
      new Ctor(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
      }),
    );
  });
}

function fireWheel(
  target: Element,
  init: WheelEventInit & { clientX?: number; clientY?: number },
): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input', () => {
  it('TC-13 a drag pans the board exactly and the state returns to idle', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');

    firePointer('pointerdown', 100, 100);
    expect(viewport.dataset.mode).toBe('panning');

    firePointer('pointermove', 300, 200);
    firePointer('pointerup', 300, 200);
    expect(viewport.dataset.mode).toBe('idle');

    flushFrame();
    const camera = readCamera(worldLayerTransform());
    expect(camera.x).toBeCloseTo(-200, 6);
    expect(camera.y).toBeCloseTo(-100, 6);
    expect(camera.zoom).toBe(1);
  });

  it('TC-14 pointercancel freezes the camera and later moves are ignored', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');

    firePointer('pointerdown', 100, 100);
    firePointer('pointermove', 200, 150);
    firePointer('pointercancel', 200, 150);
    expect(viewport.dataset.mode).toBe('idle');

    firePointer('pointermove', 500, 400); // not panning: ignored
    flushFrame();
    const camera = readCamera(worldLayerTransform());
    expect(camera.x).toBeCloseTo(-100, 6);
    expect(camera.y).toBeCloseTo(-50, 6);
  });

  it('TC-15 a plain wheel pans and is always prevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const event = fireWheel(viewport, { deltaX: 0, deltaY: 100 });
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    // camera y increases by deltaY / zoom.
    const camera = readCamera(worldLayerTransform());
    expect(camera.x).toBeCloseTo(0, 6);
    expect(camera.y).toBeCloseTo(100, 6);
  });

  it('TC-16 a Ctrl-wheel zooms and is prevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const event = fireWheel(viewport, {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    const camera = readCamera(worldLayerTransform());
    expect(camera.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 6);
  });

  it('TC-17 a Safari gesturechange zooms by the scale ratio and is prevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const event = new Event('gesturechange', { cancelable: true });
    Object.assign(event, { scale: 2, clientX: 300, clientY: 200 });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    const camera = readCamera(worldLayerTransform());
    expect(camera.zoom).toBeCloseTo(2, 6);
  });

  it('TC-18 Ctrl/Cmd + =, - and 0 step the zoom and reset, all prevented', () => {
    render(<App />);
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event;
    };

    let event = press('=');
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    expect(readCamera(worldLayerTransform()).zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);

    event = press('-');
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    expect(readCamera(worldLayerTransform()).zoom).toBeCloseTo(1, 9);

    event = press('0');
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    const camera = readCamera(worldLayerTransform());
    expect(camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('TC-29 a click without moving leaves the camera and the hint unchanged', () => {
    render(<App />);
    const before = worldLayerTransform();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    firePointer('pointerdown', 100, 100);
    firePointer('pointerup', 100, 100);
    flushFrame();

    expect(worldLayerTransform()).toBe(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('TC-30 a Ctrl-wheel over the zoom controls does not zoom the board', () => {
    render(<App />);
    const before = worldLayerTransform();
    const controls = screen.getByTestId('zoom-controls');
    fireWheel(controls, { deltaX: 0, deltaY: -100, ctrlKey: true, clientX: 1200, clientY: 700 });
    flushFrame();
    expect(worldLayerTransform()).toBe(before);
  });
});
