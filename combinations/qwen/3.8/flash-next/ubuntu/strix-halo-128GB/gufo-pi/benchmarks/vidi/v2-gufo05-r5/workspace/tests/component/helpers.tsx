import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { CameraProvider } from '../../src/client/canvas/CameraProvider';
import { Board } from '../../src/client/Board';
import type { Camera } from '../../src/client/canvas/camera';

/** The board id used in component tests (matches setup.ts default path). */
export const TEST_BOARD_ID = 'abcdefghijklmnopqrstuv';

/**
 * Renders the board UI (stories 1–4) with the providers it needs.
 * Used by all component tests that test board functionality.
 */
export function renderBoard() {
  return render(
    <CameraProvider>
      <Board boardId={TEST_BOARD_ID} />
    </CameraProvider>,
  );
}

/** The live camera (test-mode hook; enabled because Vitest runs with MODE=test). */
export function getCamera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getCamera();
}

/**
 * Runs animation frames so coalesced camera updates are applied and rendered. Camera
 * updates are scheduled with requestAnimationFrame, so a test has to let a frame (plus
 * React's commit) happen before reading the result. Under fake timers the frames are
 * driven manually; otherwise the test waits for real frames.
 */
export async function runFrames(count = 2): Promise<void> {
  await act(async () => {
    for (let i = 0; i < count; i += 1) {
      if (vi.isFakeTimers()) {
        vi.advanceTimersByTime(20);
        await Promise.resolve();
      } else {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
  });
}

/** Dispatches a non-passive wheel event on an element, like a browser would. */
export function dispatchWheel(
  target: Element,
  init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number; deltaMode?: number },
): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatches a key event on a target (usually window) and returns it for preventDefault checks. */
export function dispatchKey(
  target: EventTarget,
  init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatches a Safari gesture event (jsdom has no GestureEvent constructor). */
export function dispatchGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: { x: number; y: number } = { x: 0, y: 0 },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    scale: { value: scale },
    rotation: { value: 0 },
    clientX: { value: point.x },
    clientY: { value: point.y },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
