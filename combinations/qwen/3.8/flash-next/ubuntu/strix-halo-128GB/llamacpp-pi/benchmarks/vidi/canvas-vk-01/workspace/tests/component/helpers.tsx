import { act, render } from '@testing-library/react';

import App, { BoardOverlays } from '../../src/client/App';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { CameraProvider, useCameraApi } from '../../src/client/canvas/useCamera';
import type { Camera } from '../../src/client/canvas/camera';

/** Renders the camera and the hint latch so tests can read board state. */
export function CameraProbe() {
  const { camera, hasNavigated } = useCameraApi();
  return (
    <div
      data-testid="camera-probe"
      data-camera={JSON.stringify(camera)}
      data-has-navigated={String(hasNavigated)}
    />
  );
}

export interface BoardHarness {
  viewport: HTMLElement;
  world: HTMLElement;
  controls: HTMLElement;
  camera(): Camera;
  hasNavigated(): boolean;
  zoomLabel(): string;
  hint(): HTMLElement | null;
}

/** The real app tree (viewport + overlays + probe). */
export function renderBoard(): BoardHarness & ReturnType<typeof render> {
  const view = render(
    <CameraProvider>
      <BoardViewport />
      <BoardOverlays />
      <CameraProbe />
    </CameraProvider>,
  );
  return {
    ...view,
    viewport: view.getByTestId('board-viewport'),
    world: view.getByTestId('world-layer'),
    controls: view.getByTestId('zoom-controls'),
    camera: () => JSON.parse(view.getByTestId('camera-probe').dataset.camera ?? '{}') as Camera,
    hasNavigated: () =>
      view.getByTestId('camera-probe').dataset.hasNavigated === 'true',
    zoomLabel: () => view.getByTestId('zoom-percent').textContent ?? '',
    hint: () => view.queryByTestId('navigation-hint'),
  };
}

/** The real application entry point, for tests that want no harness at all. */
export function renderApp(): ReturnType<typeof render> {
  return render(<App />);
}

/**
 * Camera updates are coalesced into one animation frame, and jsdom has no
 * requestAnimationFrame, so the store falls back to a short timer: wait it out.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

export type PointerType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture';

export function firePointer(
  element: Element,
  type: PointerType,
  x: number,
  y: number,
  init: { pointerId?: number; button?: number; shiftKey?: boolean } = {},
): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    isPrimary: true,
    pointerType: 'mouse',
    shiftKey: init.shiftKey ?? false,
  });
  act(() => {
    element.dispatchEvent(event);
  });
}

export interface WheelInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
}

/** Dispatch a cancelable wheel event; returns it so `defaultPrevented` can be read. */
export function fireWheel(element: Element, init: WheelInit = {}): WheelEvent {
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
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

interface SafariGestureEventInit {
  scale: number;
  clientX?: number;
  clientY?: number;
}

/**
 * Safari-only pinch gesture. jsdom has no GestureEvent, so build a plain event
 * carrying the properties the board reads.
 */
export function fireGesture(
  element: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  init: SafariGestureEventInit,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: init.scale });
  if (init.clientX !== undefined) Object.defineProperty(event, 'clientX', { value: init.clientX });
  if (init.clientY !== undefined) Object.defineProperty(event, 'clientY', { value: init.clientY });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

export interface KeyInit {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Keyboard shortcuts are listened for on window; returns the event. */
export function fireKey(init: KeyInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}
