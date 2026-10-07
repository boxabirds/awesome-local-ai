import { act } from '@testing-library/react';
import { newBoardId } from '../../src/shared/board-id';
import type { Camera, Point } from '../../src/client/canvas/camera';
import type { BoardTestApi } from '../../src/client/canvas/testHooks';

/**
 * The address a component-test board reports. It is never created over the API and
 * never joined — `sync={false}` renders a board with no network at all — but from
 * story 5 on every board has an address, so every test board has one too (TC-18).
 */
export const TEST_BOARD_ID = newBoardId();

/** Read the live camera via the test-only hook (updated synchronously). */
export function getCamera(): Camera {
  const api = (window as Window & { __vidi6?: BoardTestApi }).__vidi6;
  if (!api) throw new Error('test hook (window.__vidi6) not installed');
  return api.getCamera();
}

/**
 * Flush frames until `settled` holds (then stop). One frame is normally enough for a
 * board-level change — an undo, a redo, a remote delete — to reach React state, but on a
 * machine running every test file at once it can take a second one, and a test that reads
 * the board right after the click would then see the frame that has not been committed
 * yet. Asserting after this is still asserting the change happened: the caller asserts
 * the value it expected.
 */
export async function flushUntil(settled: () => boolean, frames = 60): Promise<void> {
  for (let i = 0; i < frames; i++) {
    if (settled()) return;
    await flushFrame();
  }
}

/** Advance the coalesced requestAnimationFrame commit so React state catches up. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<undefined>((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
  });
}

/**
 * Dispatch a pointer event on an element inside act. jsdom has no PointerEvent
 * constructor, so build a cancelable Event and assign the pointer properties
 * the handlers read (button, pointerId, clientX, clientY).
 */
export function dispatchPointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  opts: {
    button?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    shiftKey?: boolean;
  } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: opts.button ?? 0,
    buttons: opts.button === undefined ? 1 : 0,
    pointerId: opts.pointerId ?? 1,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    shiftKey: opts.shiftKey ?? false,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a real (cancelable) WheelEvent on an element inside act. */
export function dispatchWheel(
  el: Element,
  opts: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
    deltaMode?: number;
  },
): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: opts.deltaX ?? 0,
    deltaY: opts.deltaY ?? 0,
    deltaMode: opts.deltaMode ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a Safari-style gesture event (jsdom has no native GestureEvent). */
export function dispatchGesture(
  el: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point = { x: 0, y: 0 },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: point.x, clientY: point.y });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a window keydown inside act and report whether it was prevented. */
export function dispatchKey(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}
