import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/** The laptop viewport the design's test fixtures use. */
export const TEST_VIEWPORT_SIZE = { width: 1280, height: 800 };

// jsdom reports a 1024x768 window; pin it to the design fixture size so tests can
// reason about exact camera numbers. jsdom has no ResizeObserver, which the board
// handles by falling back to window dimensions.
Object.defineProperty(window, 'innerWidth', {
  value: TEST_VIEWPORT_SIZE.width,
  configurable: true,
  writable: true,
});
Object.defineProperty(window, 'innerHeight', {
  value: TEST_VIEWPORT_SIZE.height,
  configurable: true,
  writable: true,
});

afterEach(() => {
  cleanup();
});
