import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount the previous test's tree after each test (no vitest globals).
afterEach(() => {
  cleanup();
});

// jsdom does not implement PointerEvent; provide a minimal one over
// MouseEvent so Testing Library's pointer events carry clientX/Y/button.
if (typeof globalThis.PointerEvent !== 'function') {
  const MouseEventBase = globalThis.MouseEvent as unknown as new (
    type: string,
    init?: MouseEventInit,
  ) => MouseEvent;
  class PointerEventPolyfill extends MouseEventBase {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom does not provide requestAnimationFrame/cancelAnimationFrame unless
// pretendToBeVisual is set; provide a timer-based fallback so camera update
// batching works in tests. Under vi.useFakeTimers() the underlying
// setTimeout is faked too, so timers can be advanced deterministically.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(Date.now()), 16) as unknown as number;
  };
}
if (typeof globalThis.cancelAnimationFrame !== 'function') {
  globalThis.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}
