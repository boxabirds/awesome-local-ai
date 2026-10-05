import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { useCamera, type CameraController, type CameraPatch } from '../../src/client/canvas/useCamera';

/** Laptop viewport from the design's fixtures. */
export const VIEWPORT: Size = { width: 1280, height: 800 };
export const DRAG_DX = 200;
export const DRAG_DY = 100;
export const POINTER: Point = { x: 300, y: 200 };
export const WHEEL_DELTA = 100;
export const WORLD_DIGITS = 6;
export const PERCENT = 100;
export const INITIAL_ZOOM = 1;
/** Frame wait long enough for the queued requestAnimationFrame to run. */
export const FRAME_MS = 40;

export interface Handle {
  current: CameraController | null;
}

/**
 * App-shaped harness: one `useCamera` shared by the board viewport, the zoom
 * controls and the navigation hint, exactly as `App.tsx` wires them.
 */
export function BoardHarness({
  viewport = VIEWPORT,
  handle,
}: {
  viewport?: Size;
  handle: Handle;
}): React.JSX.Element {
  const controller = useCamera(viewport);
  handle.current = controller;
  const { camera } = controller;
  return (
    <div className="vidi6-app">
      <BoardViewport controller={controller} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}

/** Renders the harness and returns the handle to its camera controller. */
export function renderHarness(viewport: Size = VIEWPORT): Handle {
  const handle: Handle = { current: null };
  render(<BoardHarness handle={handle} viewport={viewport} />);
  return handle;
}

export function board(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

export function zoomLabel(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

/** Camera as currently rendered into the DOM. */
export function renderedCamera(): Camera {
  const values = board().dataset;
  return {
    x: Number(values['cameraX']),
    y: Number(values['cameraY']),
    zoom: Number(values['cameraZoom']),
  };
}

/** Waits for the camera update queued on requestAnimationFrame to render. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
  });
}

/** Jumps the camera somewhere else, as the e2e test hook does. */
export async function setCamera(handle: Handle, patch: CameraPatch): Promise<void> {
  await act(async () => {
    handle.current?.setCamera(patch);
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
  });
}

type PointerType = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

export function pointer(
  type: PointerType,
  target: HTMLElement,
  point: Partial<Point> & { pointerId?: number },
): void {
  const finished = type === 'pointerUp' || type === 'pointerCancel';
  fireEvent[type](target, {
    pointerId: point.pointerId ?? 1,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    buttons: finished ? 0 : 1,
    clientX: point.x ?? 0,
    clientY: point.y ?? 0,
  });
}

/** Drags the board surface by (dx, dy) screen pixels. */
export function dragBy(dx: number, dy: number, from: Point = { x: 400, y: 300 }, pointerId = 1): void {
  const el = board();
  pointer('pointerDown', el, { ...from, pointerId });
  pointer('pointerMove', el, { x: from.x + dx, y: from.y + dy, pointerId });
  pointer('pointerUp', el, { x: from.x + dx, y: from.y + dy, pointerId });
}

export function dispatchWheel(
  target: HTMLElement,
  options: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    point?: Point;
    deltaMode?: number;
  },
): Event {
  const event = new window.WheelEvent('wheel', {
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    clientX: options.point?.x ?? 0,
    clientY: options.point?.y ?? 0,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Safari's non-standard pinch event. */
export function dispatchGesture(target: HTMLElement, scale: number, prevScale?: number): Event {
  const event = new window.Event('gesturechange', { bubbles: true, cancelable: true });
  Object.assign(event, { scale, prevScale, clientX: POINTER.x, clientY: POINTER.y });
  target.dispatchEvent(event);
  return event;
}

/** Ctrl/Cmd keyboard shortcut on the window; false means preventDefault ran. */
export function pressKey(key: string, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey'): boolean {
  return fireEvent.keyDown(window, { key, [modifier]: true });
}
