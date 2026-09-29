import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { WINDOW_SIZE } from './fixture';

/**
 * jsdom has no ResizeObserver. The board only uses one to notice window resizes,
 * and the camera's initial value comes from `window.innerWidth/innerHeight`, so
 * a no-op observer is enough; the resize listener still fires in real browsers.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
}

// A laptop-sized window, so the starting camera is the same everywhere.
for (const [key, value] of [
  ['innerWidth', WINDOW_SIZE.width],
  ['innerHeight', WINDOW_SIZE.height],
] as const) {
  try {
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  } catch {
    // Some jsdom versions expose these as read-only getters; the tests derive the
    // starting camera from whatever the window reports, so this is harmless.
  }
}

afterEach(() => {
  cleanup();
});
