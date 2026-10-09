import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver; simulate a fixed laptop viewport (1280x800),
// delivering the initial observation synchronously on observe().
class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 800,
      width: 1280,
      height: 800,
      toJSON: () => ({}),
    } as DOMRectReadOnly;
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
      contentBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Older jsdom has no PointerEvent; fall back to MouseEvent (clientX/Y/pointerId
// are assigned onto the instance by Testing Library).
if (typeof window.PointerEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).PointerEvent = window.MouseEvent;
}
