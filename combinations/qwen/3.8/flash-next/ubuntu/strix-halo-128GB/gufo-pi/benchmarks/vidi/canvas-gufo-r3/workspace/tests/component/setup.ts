import '@testing-library/jest-dom/vitest';

// Polyfill PointerEvent for jsdom (jsdom doesn't have it)
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

// Mock setPointerCapture / releasePointerCapture for jsdom
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function (_id: number) {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function (_id: number) {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function (_id: number) { return false; };
}
