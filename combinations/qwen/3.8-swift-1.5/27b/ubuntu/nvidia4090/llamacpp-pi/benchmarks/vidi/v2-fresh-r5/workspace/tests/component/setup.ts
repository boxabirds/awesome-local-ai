import '@testing-library/jest-dom/vitest';

// Shared setup for the jsdom component project.
//
// jsdom has no ResizeObserver and no real layout, so we provide a mock that
// reports a deterministic board size (matching the e2e default viewport) the
// moment an element is observed. The board is a full-window element, so its
// size equals this value.

export const TEST_VIEWPORT = { width: 1280, height: 800 };

class ResizeObserverMock implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const entry = {
      target,
      contentRect: {
        width: TEST_VIEWPORT.width,
        height: TEST_VIEWPORT.height,
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: TEST_VIEWPORT.width,
        bottom: TEST_VIEWPORT.height,
        toJSON: () => ({}),
      },
    } as unknown as ResizeObserverEntry;
    // Deliver synchronously so the board is sized before the first assertions.
    this.callback([entry], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

// jsdom has no PointerEvent, so testing-library's pointer events lack
// clientX/clientY. Provide a minimal polyfill (extending MouseEvent, which
// honours clientX/clientY in its init) so drag tests can supply coordinates.
interface PointerEventInit extends MouseEventInit {
  pointerId?: number;
  width?: number;
  height?: number;
  pressure?: number;
}

class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  width: number;
  height: number;
  pressure: number;
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
    this.width = params.width ?? 0;
    this.height = params.height ?? 0;
    this.pressure = params.pressure ?? 0;
  }
}

if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom does not implement setPointerCapture/releasePointerCapture.
// Provide no-op mocks so components that call them don't crash.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function (_pointerId: number) {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function (_pointerId: number) {};
  }
}
