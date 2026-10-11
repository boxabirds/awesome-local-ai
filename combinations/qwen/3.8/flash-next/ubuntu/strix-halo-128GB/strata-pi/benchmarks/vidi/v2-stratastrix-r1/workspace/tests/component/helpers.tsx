import { act, render } from '@testing-library/react';

import { App } from '../../src/client/App';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { VIEWPORT_SIZE } from './setup';

export { VIEWPORT_SIZE };

/** Render the whole board app (viewport + controls + hint). */
export function renderBoard(): ReturnType<typeof render> {
  return render(<App />);
}

function element<T extends HTMLElement>(testId: string): T {
  const found = document.querySelector(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`no element with data-testid="${testId}"`);
  return found as T;
}

export const viewport = (): HTMLElement => element('viewport');
export const world = (): HTMLElement => element('world');
export const originMarker = (): HTMLElement => element('origin-marker');
export const zoomLabel = (): HTMLElement => element('zoom-label');
export const zoomInButton = (): HTMLButtonElement => element<HTMLButtonElement>('zoom-in');
export const zoomOutButton = (): HTMLButtonElement => element<HTMLButtonElement>('zoom-out');
export const resetButton = (): HTMLButtonElement => element<HTMLButtonElement>('reset-view');
export const hint = (): HTMLElement | null => document.querySelector('[data-testid="navigation-hint"]');

/** The camera the board is currently rendering. */
export function camera(): Camera {
  const api = window.__vidi6;
  if (!api) throw new Error('window.__vidi6 test hook is not installed (MODE must be "test")');
  return api.getCamera();
}

/**
 * Let the board's requestAnimationFrame-coalesced camera update land, so the
 * assertions below see what the user sees.
 */
export async function settled(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

export const point = (x: number, y: number): Point => ({ x, y });

/** Read the translation out of the world layer's CSS transform. */
export function worldTransform(): { zoom: number; x: number; y: number } {
  const match = /^scale\(([-\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)$/.exec(
    world().style.transform,
  );
  if (!match) throw new Error(`unexpected world transform: ${world().style.transform}`);
  return { zoom: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}
