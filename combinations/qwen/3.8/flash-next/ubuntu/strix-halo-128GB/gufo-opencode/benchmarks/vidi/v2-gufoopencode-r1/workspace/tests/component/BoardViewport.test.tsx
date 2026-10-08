import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { panBy, resetCamera, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, WHEEL_ZOOM_SENSITIVITY } from '../../src/shared/config';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

const initialCamera = (): Camera => resetCamera({ width: window.innerWidth, height: window.innerHeight });
const camera = (): Camera => window.__vidi6!.getCamera();
const viewportEl = (): HTMLElement => screen.getByTestId('board-viewport');
const worldLayer = (): HTMLElement => screen.getByTestId('world-layer');
const normalize = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

function dispatchNativeWheel(
  target: EventTarget,
  init: WheelEventInit & { clientX?: number; clientY?: number }
): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('viewport.input', () => {
  test('TC-13 pointer drag pans the board and moves Idle -> Panning -> Idle', () => {
    render(<BoardViewport />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
    expect(viewportEl().getAttribute('data-interaction')).toBe('idle');
    fireEvent.pointerDown(viewportEl(), { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    expect(viewportEl().getAttribute('data-interaction')).toBe('panning');
    fireEvent.pointerMove(viewportEl(), { pointerId: 1, clientX: 600, clientY: 400 });
    flush();
    const expected = panBy(initialCamera(), 200, 100);
    expect(camera().x).toBe(expected.x);
    expect(camera().y).toBe(expected.y);
    expect(normalize(worldLayer().style.transform)).toBe(
      normalize(`scale(${expected.zoom}) translate(${-expected.x}px, ${-expected.y}px)`)
    );
    // the hint latches away after the first camera change
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    fireEvent.pointerUp(viewportEl(), { pointerId: 1 });
    expect(viewportEl().getAttribute('data-interaction')).toBe('idle');
  });

  test('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    render(<BoardViewport />);
    fireEvent.pointerDown(viewportEl(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewportEl(), { pointerId: 1, clientX: 200, clientY: 100 });
    flush();
    const atCancel = camera();
    fireEvent.pointerCancel(viewportEl(), { pointerId: 1 });
    fireEvent.pointerMove(viewportEl(), { pointerId: 1, clientX: 700, clientY: 600 });
    flush();
    expect(camera()).toBe(atCancel);
  });

  test('TC-15 plain wheel moves the camera by delta/zoom and is preventDefaulted', () => {
    render(<BoardViewport />);
    const before = camera();
    const event = dispatchNativeWheel(viewportEl(), { deltaY: 100, deltaMode: 0 });
    flush();
    expect(camera().y).toBeCloseTo(before.y + 100 / before.zoom, 10);
    expect(camera().x).toBe(before.x);
    expect(event.defaultPrevented).toBe(true);
  });

  test('TC-16 Ctrl-wheel zooms around the pointer and is preventDefaulted', () => {
    render(<BoardViewport />);
    const before = camera();
    const event = dispatchNativeWheel(viewportEl(), { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200 });
    flush();
    expect(camera().zoom).toBeGreaterThan(before.zoom);
    expect(camera().zoom).toBeCloseTo(before.zoom * Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 10);
    expect(event.defaultPrevented).toBe(true);
  });

  test('TC-17 Safari gesturechange doubles the zoom and is preventDefaulted', () => {
    render(<BoardViewport />);
    const before = camera();
    const start = new Event('gesturestart', { cancelable: true });
    Object.assign(start, { scale: 1, clientX: 400, clientY: 300 });
    viewportEl().dispatchEvent(start);
    const change = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.assign(change, { scale: 2, clientX: 400, clientY: 300 });
    viewportEl().dispatchEvent(change);
    flush();
    expect(camera().zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 10);
    expect(change.defaultPrevented).toBe(true);
  });

  test('TC-18 Ctrl+= / Ctrl+- / Ctrl+0 zoom in, zoom out and reset, each preventDefaulted', () => {
    render(<BoardViewport />);
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    flush();
    expect(camera().zoom).toBe(1.25);
    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    flush();
    expect(camera().zoom).toBe(1);
    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false);
    flush();
    expect(camera()).toEqual(initialCamera());
  });

  test('TC-29 click without movement leaves the camera and the hint alone', () => {
    render(<BoardViewport />);
    const before = camera();
    fireEvent.pointerDown(viewportEl(), { button: 0, pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(viewportEl(), { pointerId: 1 });
    flush();
    expect(camera()).toBe(before);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  test('TC-30 Ctrl-wheel over the zoom controls does not zoom the board', () => {
    render(<BoardViewport />);
    const before = camera();
    const event = dispatchNativeWheel(screen.getByLabelText('Zoom in'), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 1200,
      clientY: 760
    });
    flush();
    expect(camera()).toBe(before);
    // the board does not suppress the browser default over the controls
    expect(event.defaultPrevented).toBe(false);
  });

  test('hint stays hidden after a second camera change', () => {
    render(<BoardViewport />);
    fireEvent.pointerDown(viewportEl(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewportEl(), { pointerId: 1, clientX: 150, clientY: 100 });
    flush();
    fireEvent.pointerUp(viewportEl(), { pointerId: 1 });
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    flush();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
