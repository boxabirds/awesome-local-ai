import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';

export const FRAME_MS = 16;

export function useFakeFrames() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
}

/** Flush the requestAnimationFrame-coalesced camera update. */
export function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export function renderApp() {
  const utils = render(<App />);
  const viewport = screen.getByTestId('board-viewport');
  return { ...utils, viewport };
}

export function readCamera(viewport: HTMLElement): Camera {
  return {
    x: Number(viewport.dataset.cameraX),
    y: Number(viewport.dataset.cameraY),
    zoom: Number(viewport.dataset.cameraZoom),
  };
}
