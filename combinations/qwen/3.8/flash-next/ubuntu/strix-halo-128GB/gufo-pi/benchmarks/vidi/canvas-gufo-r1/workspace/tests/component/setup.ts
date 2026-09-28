// Component test setup: register jest-dom matchers and stub browser APIs that
// jsdom lacks but that BoardViewport relies on for layout.
import '@testing-library/jest-dom/vitest';

// A fixed viewport so camera.reset / zoomStep centres behave deterministically.
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    // Report the fixed size immediately so the component measures the viewport.
    this.callback(
      [
        {
          target,
          contentRect: {
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            top: 0,
            left: 0,
            right: VIEWPORT_WIDTH,
            bottom: VIEWPORT_HEIGHT,
            x: 0,
            y: 0,
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

// jsdom returns 0 for clientWidth/clientHeight; make them report the fixed size
// so the component's initial measurement (before the observer fires) is correct.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return VIEWPORT_WIDTH;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return VIEWPORT_HEIGHT;
  },
});

// A minimal getBoundingClientRect covering the viewport from the origin.
Element.prototype.getBoundingClientRect = function () {
  return {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  };
};
