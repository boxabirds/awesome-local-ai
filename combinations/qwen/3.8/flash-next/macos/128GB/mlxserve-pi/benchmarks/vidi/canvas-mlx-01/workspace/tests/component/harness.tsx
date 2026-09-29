import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App.js';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config.js';
import type { Camera, Size } from '../../src/client/canvas/camera.js';

/** jsdom is pinned to this laptop viewport in setup.ts. */
export const VIEWPORT: Size = { width: 1280, height: 800 };

/** The initial view: 100% with the board's starting point centred. */
export const INITIAL_CAMERA: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** One zoom step. */
export const STEP = ZOOM_STEP_FACTOR;

export const boardElement = (): HTMLElement =>
  screen.getByTestId('board-viewport') as HTMLElement;

export const gridElement = (): HTMLElement => screen.getByTestId('board-grid') as HTMLElement;

export const worldElement = (): HTMLElement => screen.getByTestId('world-layer') as HTMLElement;

export const controlElement = (): HTMLElement =>
  screen.getByTestId('zoom-controls') as HTMLElement;

export const button = (testId: string): HTMLButtonElement =>
  screen.getByTestId(testId) as HTMLButtonElement;

/** Whether a zoom control button currently carries the disabled attribute. */
export const isDisabled = (testId: string): boolean => button(testId).disabled;

/** The camera exactly as the DOM renders it (data attributes mirror the transform). */
export function readCamera(): Camera {
  const data = worldElement().dataset;
  return {
    x: Number(data.cameraX),
    y: Number(data.cameraY),
    zoom: Number(data.cameraZoom),
  };
}

export function readZoomLabel(): string {
  return screen.getByTestId('zoom-label').textContent ?? '';
}

export const worldTransformOf = (cam: Camera): string =>
  `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;

/** World point currently under a screen point. */
export const worldUnder = (cam: Camera, screenPoint: { x: number; y: number }): {
  x: number;
  y: number;
} => ({
  x: screenPoint.x / cam.zoom + cam.x,
  y: screenPoint.y / cam.zoom + cam.y,
});

/** Render the whole app: board, zoom controls and navigation hint. */
export function renderBoard(): void {
  render(<App />);
}

/** Let React flush updates that came from outside React (native event listeners). */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** Let the board's requestAnimationFrame-batched update run, then flush React. */
export async function flushFrames(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
        });
      });
    });
  }
}

/** Assert something that a camera update must have settled. */
export async function expectSettled(assert: () => void): Promise<void> {
  await waitFor(assert, { timeout: 2000, interval: 10 });
}

/**
 * jsdom has no PointerEvent, and the testing-library helper for pointer events drops
 * coordinates it cannot type. Build a MouseEvent carrying the pointer fields instead:
 * the event type is just a string, so the board's pointer handlers receive real
 * client coordinates.
 */
export function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  target: Element,
  clientX: number,
  clientY: number,
  buttons: number,
): boolean {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    buttons,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1, configurable: true },
    pointerType: { value: 'mouse', configurable: true },
    isPrimary: { value: true, configurable: true },
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Press the left button on the empty board. */
export async function boardDown(clientX: number, clientY: number): Promise<void> {
  pointerEvent('pointerdown', boardElement(), clientX, clientY, 1);
  await flush();
}

/** Drag the held pointer to a new position (the board batches this per frame). */
export async function boardMove(clientX: number, clientY: number): Promise<void> {
  pointerEvent('pointermove', boardElement(), clientX, clientY, 1);
  await flushFrames();
}

/** Release the pointer. */
export async function boardUp(clientX: number, clientY: number): Promise<void> {
  pointerEvent('pointerup', boardElement(), clientX, clientY, 0);
  await flush();
}

/** A drag from one point to another, leaving the button held. */
export async function dragTo(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await boardDown(fromX, fromY);
  await boardMove(toX, toY);
}

export async function endDrag(x: number, y: number): Promise<void> {
  await boardUp(x, y);
}

export async function fireBoardEvent(type: string): Promise<void> {
  fireEvent(boardElement(), new Event(type, { bubbles: true }));
  await flush();
}

/** A wheel event of the given deltas; returns whether the default was prevented. */
export async function wheel(
  target: Element,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
  },
): Promise<boolean> {
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
  await flush();
  return event.defaultPrevented;
}

/** A Safari pinch (`gesturechange`) event. */
export async function gesture(
  target: Element,
  init: { scale: number; clientX?: number; clientY?: number },
): Promise<boolean> {
  const event = new Event('gesturechange', { bubbles: true, cancelable: true });
  Object.assign(event, {
    scale: init.scale,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  target.dispatchEvent(event);
  await flush();
  return event.defaultPrevented;
}

/** A window key event; returns whether the default was prevented. */
export async function key(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): Promise<boolean> {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
  });
  window.dispatchEvent(event);
  await flush();
  return event.defaultPrevented;
}

export { fireEvent };
