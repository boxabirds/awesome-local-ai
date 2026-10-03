import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { App } from '../../src/client/App.js';
import type { Camera, Point } from '../../src/client/canvas/camera.js';
import { zoomAt } from '../../src/client/canvas/camera.js';
import { drainFrames } from './setup.js';

/** Board area used by component tests (the design's default laptop size). */
export const VIEWPORT = { width: 1280, height: 800 };

/** The standard view: 100% zoom with the board's start centred in the area. */
export const STANDARD_VIEW: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** A drag of 200 px right and 100 px down (the PRD's verification). */
export const DRAG: Point = { x: 200, y: 100 };
/** A pointer position away from the centre, used for zoom-at-pointer tests. */
export const POINTER: Point = { x: 300, y: 200 };
/** The centre of the board area: keyboard/button zoom is anchored here. */
export const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** Where the wheel gesture is delivered when a test does not say otherwise. */
export const WHEEL_POINT: Point = CENTRE;

/** Zoom about the viewport centre, as the zoom buttons and shortcuts do. */
export const centreZoom = (cam: Camera, factor: number): Camera => zoomAt(cam, CENTRE, factor);

export const board = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
export const worldLayer = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
export const zoomLabel = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="zoom-label"]')!;

/**
 * Camera updates are batched onto the next animation frame (design
 * "camera.hook"), so every dispatched interaction advances that frame before
 * the test looks at the DOM.
 */
function settle(): void {
  act(() => {
    drainFrames();
  });
}

/** Advance the frame queue so queued camera updates are rendered. */
export function flushFrames(): void {
  settle();
}

export function renderApp(): void {
  // Tests that loop over several renders would otherwise stack containers.
  cleanup();
  act(() => {
    render(<App />);
  });
  flushFrames();
}

/** The camera the app currently holds (test hook, present in test mode). */
export function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not registered');
  return hooks.getCamera();
}

/** Read the rendered world layer transform back into a camera. */
export function renderedCamera(): Camera {
  const match = /scale\(([-0-9.e+]+)\)\s+translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(
    worldLayer().style.transform,
  );
  if (!match) throw new Error(`unexpected world transform: ${worldLayer().style.transform}`);
  return { x: -Number(match[2]), y: -Number(match[3]), zoom: Number(match[1]) };
}

/** The rendered dot grid: screen spacing and the phase of the lattice. */
export function grid(): { spacing: number; offsetX: number; offsetY: number } {
  const style = board().style;
  const [sizeX] = style.backgroundSize.split(' ');
  const [posX, posY] = style.backgroundPosition.split(' ');
  const spacing = parseFloat(sizeX ?? '');
  const offsetX = parseFloat(posX ?? '');
  const offsetY = parseFloat(posY ?? '0');
  if (!Number.isFinite(spacing) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error(`unexpected grid style: ${style.backgroundSize} / ${style.backgroundPosition}`);
  }
  return { spacing, offsetX, offsetY };
}

const POINTER_ID = 1;

export function pointerDown(p: Point, element: Element = board()): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerMove(p: Point, element: Element = board()): void {
  fireEvent.pointerMove(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerUp(p: Point, element: Element = board()): void {
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerCancel(p: Point, element: Element = board()): void {
  fireEvent.pointerCancel(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function lostPointerCapture(p: Point, element: Element = board()): void {
  fireEvent.lostPointerCapture(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export interface WheelInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  point?: Point;
  /** Set false to leave the queued frame undrained (frame batching tests). */
  flush?: boolean;
}

/** Dispatch a cancelable wheel event; check `event.defaultPrevented`. */
export function wheelEvent({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  ctrlKey = false,
  metaKey = false,
  point = { x: 640, y: 400 },
  flush = true,
}: WheelInit, element: Element = board()): Event {
  const event = new WheelEvent('wheel', {
    deltaX,
    deltaY,
    deltaMode,
    ctrlKey,
    metaKey,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  if (flush) settle();
  return event;
}

/** Dispatch a Safari gesture event (GestureEvent does not exist in jsdom). */
export function gestureEvent(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point = { x: 640, y: 400 },
  element: Element = board(),
): Event {
  const event = new MouseEvent(type, {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'scale', { configurable: true, value: scale });
  element.dispatchEvent(event);
  settle();
  return event;
}

/** Dispatch a keydown on window (the shortcuts are listened to there). */
export function keydown(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; flush?: boolean } = {},
): Event {
  const { flush = true } = modifiers;
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  if (flush) settle();
  return event;
}
