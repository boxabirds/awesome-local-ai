import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';

import App from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';
import { newBoardId } from '../../src/shared/board-id';

/** Dispatch a native event inside React's act() so updates flush. */
function dispatch<T extends Event>(target: EventTarget, event: T): T {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * Render the real app: viewport, zoom controls and hint wired together, showing
 * one board of its own (the address decides which board the page connects to).
 */
export function renderBoard(boardId = newBoardId()) {
  window.history.pushState({}, '', `/b/${boardId}`);
  return render(<App />);
}

export function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

/** The document of the board the rendered page is showing. */
export function readBoardDoc(): Y.Doc {
  const doc = window.__vidi6?.doc;
  if (!doc) throw new Error('window.__vidi6.doc missing: MODE must be "test"');
  return doc;
}

export function zoomLabel(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

export function hint(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

/**
 * The camera is derived from the world layer transform
 * `scale(zoom) translate(-x px, -y px)` so tests assert what is rendered.
 */
export function readCamera(): Camera {
  const transform = screen.getByTestId('board-world').style.transform;
  const match = /^scale\(([-+0-9.eE-]+)\) translate\(([-+0-9.eE-]+)px, ([-+0-9.eE-]+)px\)$/.exec(
    transform,
  );
  if (!match) {
    throw new Error(`unexpected world layer transform: "${transform}"`);
  }
  return { zoom: Number(match[1]), x: -Number(match[2]), y: -Number(match[3]) };
}

export function readGridSpacing(): number {
  const size = surface().style.backgroundSize;
  const match = /^([-+0-9.eE-]+)px ([-+0-9.eE-]+)px$/.exec(size);
  if (!match) {
    throw new Error(`unexpected grid background-size: "${size}"`);
  }
  return Number(match[1]);
}

/** Let coalesced requestAnimationFrame updates reach the DOM. */
export function flushFrames(frames = 2): void {
  act(() => {
    vi.advanceTimersByTime(16 * frames);
  });
}

type PointerKind =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture';

/**
 * jsdom has no PointerEvent, so pointer events are dispatched as MouseEvent
 * with the pointer type name; React dispatches on the type name.
 */
export function firePointer(el: Element, kind: PointerKind, x: number, y: number): Event {
  const event = new MouseEvent(kind, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: kind === 'pointerup' || kind === 'pointercancel' ? 0 : 1,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return dispatch(el, event);
}

export interface WheelOptions {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  x?: number;
  y?: number;
}

export function fireWheel(el: Element, options: WheelOptions): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    clientX: options.x ?? 0,
    clientY: options.y ?? 0,
  });
  return dispatch(el, event);
}

export function fireGesture(
  el: Element,
  kind: 'gesturestart' | 'gesturechange',
  scale: number,
  x: number,
  y: number,
): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  return dispatch(el, event);
}

export function fireKey(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): Event {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
  });
  return dispatch(window, event);
}

/** Drag the board with the pointer from one screen point to another. */
export function dragBoard(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const el = surface();
  firePointer(el, 'pointerdown', from.x, from.y);
  firePointer(el, 'pointermove', to.x, to.y);
  firePointer(el, 'pointerup', to.x, to.y);
  flushFrames();
}
