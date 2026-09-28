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

// PointerEvent is not implemented in jsdom - add a polyfill so React can handle it
class PointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
    this.pointerType = params.pointerType ?? 'mouse';
    this.isPrimary = params.isPrimary ?? true;
    this.width = params.width ?? 1;
    this.height = params.height ?? 1;
    this.pressure = params.pressure ?? 0;
  }
}
if (!('PointerEvent' in globalThis)) {
  (globalThis as any).PointerEvent = PointerEvent;
}
// jsdom doesn't have setPointerCapture/releasePointerCapture
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function() {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function() {};
}

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
