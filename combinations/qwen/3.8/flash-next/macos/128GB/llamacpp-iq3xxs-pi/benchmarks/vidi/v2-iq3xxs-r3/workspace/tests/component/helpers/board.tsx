import { act, fireEvent, render, screen } from '@testing-library/react';

import { App } from '../../../src/client/App';
import type { Camera } from '../../../src/client/canvas/camera';
import type { Point } from '../../../src/client/canvas/camera';

/** The size `ResizeObserverStub` reports, so it is also the board area size. */
export const VIEWPORT_SIZE = { width: 1200, height: 800 };

export function renderBoard(): void {
  render(<App />);
}

export function viewportElement(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function gridElement(): HTMLElement {
  return screen.getByTestId('board-grid');
}

export function worldElement(): HTMLElement {
  return screen.getByTestId('board-world');
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-percent').textContent ?? '';
}

export function hintElement(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

export function isPanning(): boolean {
  return viewportElement().dataset.panning === 'true';
}

const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;

function numbers(value: string): number[] {
  return (value.match(NUMBER) ?? []).map(Number);
}

/** The camera the world layer transform renders. */
export function readCamera(): Camera {
  const [zoom, translateX, translateY] = numbers(worldElement().style.transform);
  return { x: -translateX, y: -translateY, zoom };
}

/** Grid geometry as the viewport renders it (CSS pixels). */
export function readGrid(): { spacing: number; offsetX: number; offsetY: number } {
  const style = gridElement().style;
  const [spacing] = numbers(style.backgroundSize);
  const [offsetX, offsetY] = numbers(style.backgroundPosition);
  return { spacing, offsetX, offsetY };
}

/** Await one animation frame, so coalesced camera updates land. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    // React state updates queued by the frame callback.
    await Promise.resolve();
  });
}

export function pointerEvent(kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', target: Element, point: Point, extra: Record<string, unknown> = {}): void {
  const fire = fireEvent[kind as keyof typeof fireEvent] as unknown as (el: Element, init: object) => void;
  fire(target, { pointerId: 1, button: 0, clientX: point.x, clientY: point.y, ...extra });
}

/** Dispatch a wheel event and hand it back so `defaultPrevented` can be read. */
export function dispatchWheel(
  target: Element,
  init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number; deltaMode?: number },
): Event {
  const event = new globalThis.WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a Safari gesture event (jsdom has no GestureEvent). */
export function dispatchGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  init: { scale?: number; clientX?: number; clientY?: number },
): Event {
  const event = new globalThis.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    scale: init.scale ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a keydown event and hand it back so `defaultPrevented` can be read. */
export function dispatchKey(
  init: { key: string; ctrlKey?: boolean; metaKey?: boolean },
  target: Element = document.body,
): Event {
  const event = new globalThis.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
