import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { standInRoom } from './standInRoom';

/** Viewport used by every component test (a small laptop window). */
export const TEST_VIEWPORT = { width: 1200, height: 800 };

// The app opens a connection to its board as soon as it renders, and there is no
// room server in a component test: see `standInRoom`.
standInRoom.install();

function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
}

beforeEach(() => {
  standInRoom.reset();
  setWindowSize(TEST_VIEWPORT.width, TEST_VIEWPORT.height);
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
