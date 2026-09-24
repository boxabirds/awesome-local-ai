import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** Board area size used by component tests (jsdom has no layout). */
export const TEST_VIEWPORT = { width: 1280, height: 800 } as const;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: TEST_VIEWPORT.width,
        height: TEST_VIEWPORT.height,
        right: TEST_VIEWPORT.width,
        bottom: TEST_VIEWPORT.height,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
