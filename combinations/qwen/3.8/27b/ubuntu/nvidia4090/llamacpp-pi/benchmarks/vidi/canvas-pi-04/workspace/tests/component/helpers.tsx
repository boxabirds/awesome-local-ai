import { act, cleanup } from '@testing-library/react';
import type { JSX } from 'react';
import { vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import type { Camera, Size } from '../../src/client/canvas/camera';
import {
  resetBoardForTests,
  useCamera,
} from '../../src/client/canvas/useCamera';

export { cleanup, resetBoardForTests };

/** Viewport size used by every component test. */
export const TEST_VIEWPORT: Size = { width: 1280, height: 800 };

/**
 * Full board composition (viewport + zoom controls + hint) wired to the
 * shared camera store with a fixed viewport size, mirroring App.tsx.
 */
export function BoardHarness(): JSX.Element {
  const { camera, hasNavigated, zoomStep, reset } = useCamera(TEST_VIEWPORT);
  return (
    <div>
      <BoardViewport />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}

/** jsdom lacks several event constructors; map types to their constructor. */
const EVENT_CTORS: Record<string, string> = {
  pointerdown: 'PointerEvent',
  pointermove: 'PointerEvent',
  pointerup: 'PointerEvent',
  pointercancel: 'PointerEvent',
  wheel: 'WheelEvent',
  keydown: 'KeyboardEvent',
  keyup: 'KeyboardEvent',
  gesturestart: 'GestureEvent',
  gesturechange: 'GestureEvent',
  gestureend: 'GestureEvent',
};

/**
 * Create a DOM event. jsdom lacks PointerEvent/WheelEvent/GestureEvent, so
 * fall back to a plain Event and assign the extra properties.
 */
export function makeEvent(type: string, props: Record<string, unknown>): Event {
  const name = EVENT_CTORS[type] ?? 'Event';
  const ctor = (window as unknown as Record<string, unknown>)[name] as
    | (new (t: string, init?: EventInit) => Event)
    | undefined;
  if (ctor) {
    // Prefer the real constructor: properties like WheelEvent.deltaX are
    // getter-only and must be set via the event init, not Object.assign.
    try {
      return new ctor(type, { bubbles: true, cancelable: true, ...props });
    } catch {
      // Fall through to the generic Event below.
    }
  }
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

/** Advance fake timers by one frame so rAF-coalesced camera commits land. */
export function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

/** The world layer's transform string for a given camera. */
export function transformOf(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

/** The scale factor out of a `scale(x) translate(...)` transform string. */
export function transformScale(transform: string): number {
  const match = /scale\(([^)]+)\)/.exec(transform);
  return match ? Number(match[1]) : Number.NaN;
}
