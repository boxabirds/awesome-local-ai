import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_STEP_FACTOR } from '../../src/shared/config';

/** jsdom component-test viewport (see setup.ts). */
export const VIEWPORT = { width: 1280, height: 800 };
export const CENTRED_TRANSFORM = `scale(1) translate(${VIEWPORT.width / 2}px, ${VIEWPORT.height / 2}px)`;
export const INITIAL_ZOOM_TRANSFORM = `scale(${ZOOM_STEP_FACTOR}) translate(${VIEWPORT.width / 2 / ZOOM_STEP_FACTOR}px, ${VIEWPORT.height / 2 / ZOOM_STEP_FACTOR}px)`;

/** Render the whole app (viewport + controls + hint wired together). */
export function renderApp() {
  return render(<App />);
}

export function renderWith(ui: ReactNode) {
  return render(ui);
}

/**
 * The camera coalesces updates with requestAnimationFrame; vitest fake
 * timers fake rAF, so tests advance time inside act() to flush one frame.
 */
export function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

export function surfaceOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
}

export function worldLayerOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
}

export function zoomLabelOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="zoom-label"]')!;
}

export const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
