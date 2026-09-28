import { act, screen } from '@testing-library/react';
import type { Camera } from '../../../src/client/canvas/camera';

export function viewportEl(): HTMLElement {
  return screen.getByTestId('viewport');
}

export function worldEl(): HTMLElement {
  return screen.getByTestId('world-layer');
}

export function zoomLabelEl(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

export function hintEl(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

/** The camera the app is currently rendering. */
export function cameraFromDom(): Camera {
  const el = worldEl();
  const x = Number(el.dataset.cameraX);
  const y = Number(el.dataset.cameraY);
  const zoom = Number(el.dataset.cameraZoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
    throw new Error(`world layer has no camera attributes: ${el.getAttribute('style')}`);
  }
  return { x, y, zoom };
}

/** Let the hook's requestAnimationFrame-batched camera update land. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Dispatch a cancelable event and report whether the page default survived. */
export function dispatch<T extends Event>(element: Element | Window, event: T): T {
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

export function fireWheel(
  element: Element,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
  },
): WheelEvent {
  return dispatch(
    element,
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: init.deltaX ?? 0,
      deltaY: init.deltaY ?? 0,
      deltaMode: init.deltaMode ?? 0,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
    }),
  );
}

/** Safari's non-standard gesture events, as jsdom cannot build them. */
export function fireGesture(
  element: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: { x: number; y: number } = { x: 0, y: 0 },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'rotation', { value: 0 });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  return dispatch(element, event);
}

export function fireKey(
  key: string,
  init: { ctrlKey?: boolean; metaKey?: boolean; code?: string } = {},
): KeyboardEvent {
  return dispatch(
    window,
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      code: init.code ?? '',
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
    }),
  );
}
