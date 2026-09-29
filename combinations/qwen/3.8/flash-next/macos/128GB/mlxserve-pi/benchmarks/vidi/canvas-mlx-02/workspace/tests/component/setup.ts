import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks ResizeObserver; the board initialises its viewport size from
// window.innerWidth/innerHeight, so a no-op observer is sufficient for tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// jsdom lacks PointerEvent and pointer-capture APIs used by the board.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPoly extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = PointerEventPoly;
}

// Element.prototype.setPointerCapture / releasePointerCapture are absent in jsdom.
if (!('setPointerCapture' in Element.prototype)) {
  const proto = Element.prototype as unknown as {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
  };
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
}

// jsdom has no canvas: getContext('2d') logs "Not implemented" to the virtual
// console on every call before returning null. The board's text measurer
// already falls back to the documented estimate on null, so answer null here
// quietly instead of noisily.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLCanvasElement.prototype as any).getContext = () => null;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
