import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';

export function useFakeFrames() {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
}

/** Run pending requestAnimationFrame callbacks (camera updates are batched per frame). */
export function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

export function renderBoard() {
  const result = render(<BoardViewport />);
  return {
    ...result,
    viewport: screen.getByTestId('board-viewport'),
    world: screen.getByTestId('world-layer'),
  };
}

/** Parse the world layer's `scale(z) translate(-x px, -y px)` back into a camera. */
export function cameraFromDom(): Camera {
  const transform = screen.getByTestId('world-layer').style.transform;
  const m = /scale\(([^)]+)\)\s*translate\(([^,]+)px,\s*([^)]+)px\)/.exec(transform);
  if (!m) throw new Error(`Unexpected world transform: ${transform}`);
  return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
}

export function initialCamera(): Camera {
  return { x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 };
}

export function dispatchWheel(target: Element, init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function dispatchKey(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}
