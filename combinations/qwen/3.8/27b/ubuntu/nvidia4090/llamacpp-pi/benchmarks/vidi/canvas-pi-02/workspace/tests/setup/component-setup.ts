import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

// --- jsdom polyfills --------------------------------------------------------
// jsdom lacks several platform APIs the canvas components use. The polyfills
// are minimal: handler logic is what is under test, not the platform APIs.

// PointerEvent (extends MouseEvent; clientX/Y, button etc. come along for free).
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// Pointer capture (used while dragging).
if (typeof Element !== 'undefined') {
  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  }
  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  }
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
      return false;
    };
  }
}

// ResizeObserver (App uses it to track the board area size).
if (
  typeof window !== 'undefined' &&
  typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined'
) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class ResizeObserverPolyfill {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
