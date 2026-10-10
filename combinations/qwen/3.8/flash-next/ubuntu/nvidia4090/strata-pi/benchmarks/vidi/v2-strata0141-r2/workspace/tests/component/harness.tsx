import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera, type Size } from '../../src/client/canvas/camera';
import {
  BoardControllerContext,
  useCamera,
  type CameraController,
} from '../../src/client/canvas/useCamera';

/** Viewport used by every component test (1200x800 so centres are predictable). */
export const TEST_VIEWPORT: Size = { width: 1200, height: 800 };

interface HarnessProps {
  children?: ReactNode;
  controllerRef: { current: CameraController | null };
}

/** Mirrors App.tsx wiring so tests exercise the real component tree. */
function BoardHarness({ children, controllerRef }: HarnessProps) {
  const controller = useCamera(TEST_VIEWPORT);
  controllerRef.current = controller;
  const { camera } = controller;
  return (
    <div className="board-root">
      <BoardControllerContext.Provider value={controller}>
        <BoardViewport>{children}</BoardViewport>
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => controller.zoomStep('in')}
          onZoomOut={() => controller.zoomStep('out')}
          onReset={controller.reset}
        />
        <NavigationHint visible={!controller.hasNavigated} />
      </BoardControllerContext.Provider>
    </div>
  );
}

export interface BoardHarnessResult {
  view: RenderResult;
  controller(): CameraController;
  getCamera(): Camera;
  flushFrames(): Promise<void>;
  viewport(): HTMLElement;
  grid(): HTMLElement;
  world(): HTMLElement;
  marker(): HTMLElement;
  zoomLabel(): HTMLElement;
  zoomIn(): HTMLButtonElement;
  zoomOut(): HTMLButtonElement;
  resetButton(): HTMLButtonElement;
  controls(): HTMLElement;
  hint(): HTMLElement | null;
}

export function renderBoard(children?: ReactNode): BoardHarnessResult {
  const controllerRef: { current: CameraController | null } = { current: null };
  const view = render(<BoardHarness controllerRef={controllerRef}>{children}</BoardHarness>);

  const controller = (): CameraController => {
    const current = controllerRef.current;
    if (!current) {
      throw new Error('harness did not mount a camera controller');
    }
    return current;
  };

  const testId = (id: string): HTMLElement => view.getByTestId(id);
  const optional = (id: string): HTMLElement | null => view.queryByTestId(id);

  return {
    view,
    controller,
    getCamera: () => controller().camera,
    flushFrames,
    viewport: () => testId('board-viewport'),
    grid: () => testId('board-grid'),
    world: () => testId('board-world'),
    marker: () => testId('origin-marker'),
    zoomLabel: () => testId('zoom-label'),
    zoomIn: () => testId('zoom-in') as HTMLButtonElement,
    zoomOut: () => testId('zoom-out') as HTMLButtonElement,
    resetButton: () => testId('reset-view') as HTMLButtonElement,
    controls: () => testId('zoom-controls'),
    hint: () => optional('navigation-hint'),
  };
}

/** Camera updates are coalesced into one render per animation frame. */
export async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function setCamera(harness: BoardHarnessResult, camera: Camera): void {
  harness.controller().setCamera(camera);
}

/** `scale(z) translate(-x px, -y px)` -> { zoom, x, y } of the world layer. */
export function readWorldTransform(world: HTMLElement): { zoom: number; x: number; y: number } {
  const transform = world.getAttribute('data-transform') ?? world.style.transform;
  const scale = /scale\(([-0-9.]+)\)/.exec(transform);
  const translate = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
  if (!scale || !translate) {
    throw new Error(`unexpected world transform: ${transform}`);
  }
  return {
    zoom: Number(scale[1]),
    x: -Number(translate[1]),
    y: -Number(translate[2]),
  };
}

export function markerCentre(marker: HTMLElement): { x: number; y: number } {
  const transform = marker.style.transform;
  const match = /translate3d\(([-0-9.]+)px,\s*([-0-9.]+)px,\s*(?:0px|0)\)/.exec(transform);
  if (!match) {
    throw new Error(`unexpected origin marker transform: ${transform}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function fireWheel(
  el: HTMLElement,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

export function fireKey(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Safari gesture events are not standard DOM events, so they are built by hand. */
export function fireGesture(
  el: HTMLElement,
  type: string,
  init: { scale: number; initialScale?: number; clientX?: number; clientY?: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Pointer events need explicit coordinates in jsdom. */
export function pointerCoordinates(clientX: number, clientY: number): {
  clientX: number;
  clientY: number;
  pointerId: number;
  button: number;
  buttons: number;
  isPrimary: boolean;
  pointerType: 'mouse';
} {
  return {
    clientX,
    clientY,
    pointerId: 1,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: 'mouse',
  };
}

beforeEach(() => {
  // jsdom's default viewport keeps getBoundingClientRect at zero, so screen
  // coordinates equal client coordinates in component tests.
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});
