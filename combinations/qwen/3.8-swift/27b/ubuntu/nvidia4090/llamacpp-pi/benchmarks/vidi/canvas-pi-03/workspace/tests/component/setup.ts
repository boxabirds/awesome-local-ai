import { expect, afterEach, beforeEach, vi } from 'vitest';
import * as jestDom from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(jestDom);

// Story 5: board pages check existence before mounting the board. The default
// mock says the board exists so existing board tests render unchanged; tests
// that exercise the check itself override per-test with mockResolvedValueOnce.
vi.mock('src/client/api', () => ({
  checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }),
  createBoardRequest: vi.fn().mockResolvedValue({ kind: 'created', id: 'mock-id' }),
}));

// Story 3 routes the board to `/b/<boardId>`. Component tests render <App/>
// directly, so place them on a valid board URL. The board must pass the
// story 5 existence check (mocked 'exists' above) before it renders; use
// `boardReady()` from tests/component/ready after each render(<App />).
beforeEach(() => {
  window.history.pushState({}, '', '/b/abcdefghijklmnopqrstuv');
  // Clear the board test hook so boardReady() only resolves once THIS test's
  // Board has mounted (window is shared across tests in a file; a stale hook
  // would let boardReady return before the board's listeners are attached).
  delete (window as unknown as Record<string, unknown>).__vidi6;
});

// No vitest globals: disable @testing-library/react's auto-cleanup, so clean
// up manually between tests.
afterEach(() => {
  cleanup();
});

// Mock pointer capture for jsdom
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || function() {};
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || function() {};
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || function() { return false; };

// Mock ResizeObserver for jsdom (not implemented)
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock PointerEvent for jsdom (not available in older jsdom versions)
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    width: number;
    height: number;
    pressure: number;
    pointerType: string;
    constructor(type: string, params: any = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  };
}
