// Mock ResizeObserver for jsdom
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(global as any).ResizeObserver = MockResizeObserver;

// No-op GestureEvent mock (not used in jsdom component tests)

// Mock pointer capture methods on HTMLElement
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true });
Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, configurable: true });
