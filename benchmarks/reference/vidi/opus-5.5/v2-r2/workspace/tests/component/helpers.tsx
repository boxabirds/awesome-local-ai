import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';

export const FRAME_MS = 16;

export function renderApp() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const utils = render(<App />);
  return {
    ...utils,
    viewport: () => screen.getByTestId('board-viewport'),
    world: () => screen.getByTestId('board-world'),
  };
}

/** Advance past the requestAnimationFrame that flushes camera updates. */
export function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export function currentCamera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.getCamera();
}

/** Parses the world layer's `scale(z) translate(-x px, -y px)` back into a camera. */
export function renderedCamera(world: HTMLElement): Camera {
  const match = /scale\(([^)]+)\) translate\(([^,]+)px, ([^)]+)px\)/.exec(world.style.transform);
  if (!match) throw new Error(`unexpected transform: ${world.style.transform}`);
  return { zoom: Number(match[1]), x: -Number(match[2]), y: -Number(match[3]) };
}

export function pointer(el: HTMLElement, type: 'down' | 'move' | 'up' | 'cancel', x: number, y: number) {
  const init = { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1 };
  const fn = { down: fireEvent.pointerDown, move: fireEvent.pointerMove, up: fireEvent.pointerUp, cancel: fireEvent.pointerCancel }[type];
  return fn(el, init);
}
