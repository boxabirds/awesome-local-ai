import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { installResizeObserver } from './resizeObserver';

installResizeObserver();

/**
 * jsdom's window is 1024x768 and cannot be resized; the board derives its standard view
 * from the window size, so emulate the e2e viewport (1280x800) here.
 */
const WINDOW_SIZE = { width: 1280, height: 800 };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: WINDOW_SIZE.width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: WINDOW_SIZE.height,
  });
  // Only requestAnimationFrame is faked, so React's scheduler keeps real timers.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
