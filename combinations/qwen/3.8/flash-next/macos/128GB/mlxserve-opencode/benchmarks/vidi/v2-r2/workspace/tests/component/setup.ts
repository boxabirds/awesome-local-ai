import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement pointer capture, PointerEvent, ResizeObserver, or full layout

// Polyfill PointerEvent
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId || 0;
      this.pointerType = params.pointerType || 'mouse';
    }
  }
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

// Mock ResizeObserver
class MockResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as any;

// Mock setPointerCapture/releasePointerCapture on Element
const proto = Element.prototype;
if (!proto.setPointerCapture) {
  (proto as any).setPointerCapture = function(_id: number) {};
}
if (!proto.releasePointerCapture) {
  (proto as any).releasePointerCapture = function(_id: number) {};
}
if (!proto.hasPointerCapture) {
  (proto as any).hasPointerCapture = function(_id: number) { return false; };
}
