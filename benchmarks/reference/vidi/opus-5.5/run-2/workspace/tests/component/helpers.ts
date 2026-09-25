import { act, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Camera } from '../../src/client/canvas/camera';

/** One animation frame at 60 fps, in milliseconds. */
export const FRAME_MS = 16;

export function useFakeFrames(): void {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
}

/** Runs pending requestAnimationFrame callbacks (camera updates are coalesced per frame). */
export function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

const TRANSFORM = /^scale\(([^)]+)\) translate\(([^,]+)px, ([^)]+)px\)$/;

/** Reads the camera back from the world layer's CSS transform. */
export function readCamera(): Camera {
  const world = screen.getByTestId('world-layer');
  const match = TRANSFORM.exec(world.style.transform);
  if (match === null) throw new Error(`Unexpected transform: ${world.style.transform}`);
  return { zoom: Number(match[1]), x: -Number(match[2]), y: -Number(match[3]) };
}

/** Dispatches a cancelable event and returns it so defaultPrevented can be checked. */
export function dispatch<E extends Event>(target: EventTarget, event: E): E {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
