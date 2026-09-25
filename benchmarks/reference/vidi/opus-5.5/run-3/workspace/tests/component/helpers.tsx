import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';

export const FRAME_MS = 16;

export function renderBoard() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const utils = render(<BoardViewport />);
  const viewport = screen.getByTestId('board-viewport');
  const world = screen.getByTestId('board-world');
  return { ...utils, viewport, world };
}

export function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.getCamera();
}

export function setCamera(cam: Camera) {
  act(() => window.__vidi6!.setCamera(cam));
}

/** Advance one animation frame so batched camera updates render. */
export function nextFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export function pointer(el: Element, type: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, pointerId = 1) {
  const init = { clientX: x, clientY: y, pointerId, button: 0, buttons: type === 'up' ? 0 : 1 };
  act(() => {
    if (type === 'down') fireEvent.pointerDown(el, init);
    if (type === 'move') fireEvent.pointerMove(el, init);
    if (type === 'up') fireEvent.pointerUp(el, init);
    if (type === 'cancel') fireEvent.pointerCancel(el, init);
  });
}

/** Dispatches an event and returns whether the default was prevented. */
export function dispatchPrevented(target: EventTarget, event: Event): boolean {
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}
