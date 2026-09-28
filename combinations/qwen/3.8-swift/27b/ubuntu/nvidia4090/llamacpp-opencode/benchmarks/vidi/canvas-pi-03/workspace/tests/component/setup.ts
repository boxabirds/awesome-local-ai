import { expect, afterEach, beforeEach } from 'vitest';
import * as jestDom from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(jestDom);

// Story 3 routes the board to `/b/<boardId>`. Component tests render <App/>
// directly, so place them on a valid board URL so the board renders instead
// of triggering the client-side redirect to a fresh board.
beforeEach(() => {
  window.history.pushState({}, '', '/b/abcdefghijklmnopqrstuv');
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
