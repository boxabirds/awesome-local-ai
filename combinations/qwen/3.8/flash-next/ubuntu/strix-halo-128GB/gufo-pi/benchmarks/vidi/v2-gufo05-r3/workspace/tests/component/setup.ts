import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// --- jsdom polyfills for board input --------------------------------------
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      const entry = {
        target,
        contentRect: rect,
        borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

afterEach(() => {
  cleanup();
});
