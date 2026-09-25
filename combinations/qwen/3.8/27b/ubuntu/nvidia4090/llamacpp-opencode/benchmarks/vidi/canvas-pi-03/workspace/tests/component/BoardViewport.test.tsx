import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { act } from 'react';
import { renderApp, getCameraTransform } from './helpers';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function dispatchPointerEvent(el: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function dispatchWheelEvent(el: Element, opts: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; clientX?: number; clientY?: number }): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaX: opts.deltaX ?? 0,
    deltaY: opts.deltaY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.clientX !== undefined) Object.defineProperty(event, 'clientX', { value: opts.clientX });
  if (opts.clientY !== undefined) Object.defineProperty(event, 'clientY', { value: opts.clientY });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

describe('BoardViewport input', () => {
  it('TC-13: pointerdown/move(200,100)/up moves world layer transform', () => {
    const { container } = renderApp();
    const viewport = screen.getByTestId('board-viewport');

    dispatchPointerEvent(viewport, 'pointerdown', 640, 400);
    dispatchPointerEvent(viewport, 'pointermove', 840, 500);
    dispatchPointerEvent(viewport, 'pointerup', 840, 500);

    const transform = getCameraTransform(container);
    // Initial camera: resetCamera({1280,800}) = {x:-640, y:-400, zoom:1}
    // After pan by (200, 100): {x:-640-200, y:-400-100, zoom:1} = {x:-840, y:-500, zoom:1}
    // transform: scale(1) translate(840px, 500px)
    expect(transform).toBe('scale(1) translate(840px, 500px)');
  });

  it('TC-14: pointercancel mid-drag freezes camera; later moves ignored', () => {
    const { container } = renderApp();
    const viewport = screen.getByTestId('board-viewport');

    dispatchPointerEvent(viewport, 'pointerdown', 640, 400);
    dispatchPointerEvent(viewport, 'pointermove', 740, 450); // pan 100, 50

    const transformAfterMove = getCameraTransform(container);
    // camera: (-640-100, -400-50, 1) = (-740, -450, 1)
    expect(transformAfterMove).toBe('scale(1) translate(740px, 450px)');

    dispatchPointerEvent(viewport, 'pointercancel', 740, 450);

    // Further moves should be ignored
    dispatchPointerEvent(viewport, 'pointermove', 840, 500);
    expect(getCameraTransform(container)).toBe(transformAfterMove);
  });

  it('TC-15: plain wheel deltaY=+100 pans (content moves up)', () => {
    const { container } = renderApp();
    const viewport = screen.getByTestId('board-viewport');

    const event = dispatchWheelEvent(viewport, { deltaY: 100, deltaX: 0 });
    // panBy(0, -100): camera.y = -400 + 100 = -300
    const transform = getCameraTransform(container);
    expect(transform).toBe('scale(1) translate(640px, 300px)');
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-16: Ctrl+wheel deltaY=-100 at (300,200) zooms in', () => {
    renderApp();
    const viewport = screen.getByTestId('board-viewport');

    const event = dispatchWheelEvent(viewport, {
      deltaY: -100,
      deltaX: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    // factor = exp(1) ≈ 2.718, zoom increases
    const label = screen.getByTestId('zoom-label');
    const pct = parseInt(label.textContent!);
    expect(pct).toBeGreaterThan(100);
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-17: gesturechange scale 2 zooms', () => {
    renderApp();
    const viewport = screen.getByTestId('board-viewport');

    // gesturestart
    const startEvent = new Event('gesturestart', { bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(startEvent);
    });
    expect(startEvent.defaultPrevented).toBe(true);

    // gesturechange with scale=2
    const changeEvent = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(changeEvent, 'scale', { value: 2 });
    Object.defineProperty(changeEvent, 'clientX', { value: 640 });
    Object.defineProperty(changeEvent, 'clientY', { value: 400 });
    act(() => {
      viewport.dispatchEvent(changeEvent);
    });
    expect(changeEvent.defaultPrevented).toBe(true);

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('200%');
  });

  it('TC-18: Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
    renderApp();

    // Ctrl+= → zoom in
    const keyIn = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyIn);
    });
    expect(keyIn.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-label').textContent).toBe('125%');

    // Ctrl+- → zoom out
    const keyOut = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyOut);
    });
    expect(keyOut.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-label').textContent).toBe('100%');

    // Pan away first
    const viewport = screen.getByTestId('board-viewport');
    dispatchPointerEvent(viewport, 'pointerdown', 640, 400);
    dispatchPointerEvent(viewport, 'pointermove', 840, 500);
    dispatchPointerEvent(viewport, 'pointerup', 840, 500);

    // Ctrl+0 → reset
    const keyReset = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyReset);
    });
    expect(keyReset.defaultPrevented).toBe(true);
    expect(screen.getByTestId('zoom-label').textContent).toBe('100%');
  });

  it('TC-29: click without moving leaves camera unchanged, hint not dismissed', () => {
    const { container } = renderApp();
    const viewport = screen.getByTestId('board-viewport');

    const transformBefore = getCameraTransform(container);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    dispatchPointerEvent(viewport, 'pointerdown', 640, 400);
    dispatchPointerEvent(viewport, 'pointerup', 640, 400);

    expect(getCameraTransform(container)).toBe(transformBefore);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
  });

  it('TC-30: Ctrl+wheel over zoom control does not zoom board', () => {
    const { container } = renderApp();
    const controls = screen.getByTestId('zoom-controls');
    const transformBefore = getCameraTransform(container);

    dispatchWheelEvent(controls, {
      deltaY: -100,
      deltaX: 0,
      ctrlKey: true,
      clientX: 1200,
      clientY: 780,
    });

    expect(getCameraTransform(container)).toBe(transformBefore);
  });
});
