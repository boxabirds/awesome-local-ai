// jsdom does not implement ResizeObserver or PointerEvent capture; provide
// inert stand-ins so BoardViewport can run in component tests.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so Testing Library's auto-cleanup never
// hooks into a global afterEach; do it explicitly.
afterEach(() => {
  cleanup();
});

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
  writable: true,
});

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(this: Element): void {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture(this: Element): void {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(this: Element): boolean {
    return false;
  };
}
