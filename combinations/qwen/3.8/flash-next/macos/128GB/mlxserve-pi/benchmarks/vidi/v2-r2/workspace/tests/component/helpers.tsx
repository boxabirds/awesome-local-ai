// Shared helpers for the jsdom component tests: render the whole app, flush the
// requestAnimationFrame-batched camera updates with fake timers, and read the
// camera / grid / transform the board rendered.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import App from '../../src/client/App';
import { resetCamera, type Camera, type Point, type Size } from '../../src/client/canvas/camera';

function number(value: string | undefined): number {
  if (value === undefined) throw new Error('missing data attribute');
  return Number(value);
}

/** Render the app and return the board's DOM handles. */
export function renderBoard() {
  const utils = render(<App />);
  return utils;
}

/** The board area size the app measured (jsdom has no ResizeObserver). */
export function boardSize(): Size {
  const value = screen.getByTestId('board-area').dataset.viewport;
  const match = /^(-?[\d.]+)x(-?[\d.]+)$/.exec(value ?? '');
  if (match === null) throw new Error(`unparsable data-viewport: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The camera as rendered by the board (data attributes on the viewport). */
export function readCamera(): Camera {
  const el = screen.getByTestId('board-viewport');
  return {
    x: number(el.dataset.cameraX),
    y: number(el.dataset.cameraY),
    zoom: number(el.dataset.cameraZoom),
  };
}

/** Camera the board starts with: Reset view for the measured board size. */
export function initialCamera(): Camera {
  return resetCamera(boardSize());
}

export function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function worldEl(): HTMLElement {
  return screen.getByTestId('board-world');
}

/** The world layer's inline transform, as numbers. */
export function worldTransform(): { scale: number; translateX: number; translateY: number } {
  const transform = worldEl().style.transform;
  const match = /scale\(([-\d.e+]+)\)\s*translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
    transform,
  );
  if (match === null) throw new Error(`unparsable transform: ${transform}`);
  return {
    scale: Number(match[1]),
    translateX: Number(match[2]),
    translateY: Number(match[3]),
  };
}

/** Dot-grid geometry as computed by the board (CSS pixels). */
export function gridGeometry(): {
  spacing: number;
  offsetX: number;
  offsetY: number;
  cssSize: string;
  cssPosition: string;
} {
  const el = viewportEl();
  const computed = getComputedStyle(el);
  return {
    spacing: number(el.dataset.gridSpacing),
    offsetX: number(el.dataset.gridOffsetX),
    offsetY: number(el.dataset.gridOffsetY),
    // the CSS the browser actually renders with
    cssSize: computed.backgroundSize,
    cssPosition: computed.backgroundPosition,
  };
}

export function mode(): string {
  return viewportEl().dataset.mode ?? '';
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-label').textContent ?? '';
}

export function hintVisible(): boolean {
  return screen.queryByTestId('nav-hint') !== null;
}

export function hintText(): string | null {
  return screen.queryByTestId('nav-hint')?.textContent ?? null;
}

/**
 * Flush the camera update: the board coalesces camera changes into one
 * requestAnimationFrame, so advance a couple of frames inside act().
 */
export function flushFrames(frames = 2): void {
  act(() => {
    vi.advanceTimersByTime(16 * frames);
  });
}

export function pointerDown(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

export function pointerMove(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerMove(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

export function pointerUp(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerUp(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

/** Drag the board from one screen point to another in several pointermove steps. */
export function dragTo(from: Point, to: Point, steps = 4): void {
  pointerDown(from);
  flushFrames();
  for (let i = 1; i <= steps; i++) {
    pointerMove({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
    flushFrames();
  }
  pointerUp(to);
  flushFrames();
}

export function wheelAt(
  target: Element,
  init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number },
): Event {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  target.dispatchEvent(event);
  return event;
}

/** Safari gesture event (not standardised; jsdom has no constructor for it). */
export function gestureAt(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'rotation', { value: 0 });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  target.dispatchEvent(event);
  return event;
}

export function pressKey(key: string, init: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
  // The board listens on window, the way browser zoom shortcuts arrive.
  window.dispatchEvent(event);
  return event;
}

/**
 * Install fake timers. Vitest's fake timers also replace requestAnimationFrame,
 * which is how the board coalesces camera updates into one render per frame.
 */
export function installFakeFrames(): void {
  vi.useFakeTimers();
}

export function useBoardTestLifecycle(): void {
  beforeEach(() => {
    installFakeFrames();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
}
