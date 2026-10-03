// Shared fake requestAnimationFrame for component tests.
// Import this module (side effect) before rendering components that use rAF.

import { act } from '@testing-library/react';
import { vi } from 'vitest';

let rafId = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>();

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafId++;
  rafCallbacks.set(rafId, cb);
  return rafId;
});
vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  rafCallbacks.delete(id);
});

/** Flush all pending rAF callbacks inside act(). */
export function flushRAF() {
  act(() => {
    const now = performance.now();
    const cbs = Array.from(rafCallbacks.entries());
    rafCallbacks.clear();
    cbs.forEach(([_, cb]) => cb(now));
  });
}

/** Drop pending callbacks without running them. */
export function clearRAF() {
  rafCallbacks.clear();
}
