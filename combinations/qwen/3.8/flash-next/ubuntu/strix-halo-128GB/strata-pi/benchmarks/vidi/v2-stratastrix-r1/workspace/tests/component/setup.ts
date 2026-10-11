import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// React needs to know it is running inside a test so act() can flush work.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no layout, so every element is reported as the whole board area.
 * The board reads its own size to centre the starting point and to turn client
 * coordinates into board-relative ones; a fixed 1280x800 area keeps both simple
 * and matches the fixture size in the story's test strategy.
 */
export const VIEWPORT_SIZE = { width: 1280, height: 800 };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT_SIZE.width,
      bottom: VIEWPORT_SIZE.height,
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
