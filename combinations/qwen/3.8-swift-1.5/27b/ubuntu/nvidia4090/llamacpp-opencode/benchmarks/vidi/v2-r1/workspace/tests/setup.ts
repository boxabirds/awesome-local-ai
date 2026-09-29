import { expect } from 'vitest';
import * as jestDom from '@testing-library/jest-dom/matchers';

expect.extend(jestDom);

// Mock setPointerCapture and releasePointerCapture for jsdom
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  writable: true,
  value: () => {},
});

Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
  writable: true,
  value: () => {},
});

// Mock ResizeObserver
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
