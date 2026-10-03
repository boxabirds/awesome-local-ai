import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetTypingBurst } from '../../src/client/board/typingGuard';

// jsdom lacks these browser APIs the board relies on; provide minimal,
// deterministic stand-ins so component tests can exercise the real handlers.

const g = globalThis as unknown as {
  PointerEvent?: unknown;
  ResizeObserver?: unknown;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

// Pointer events: jsdom has no PointerEvent constructor, so reuse MouseEvent.
if (typeof g.PointerEvent === 'undefined') {
  g.PointerEvent = globalThis.MouseEvent;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Run animation-frame callbacks synchronously so a note drag applies its
// rAF-throttled moveObject write within the same fireEvent, making drag tests
// deterministic without fake-timer plumbing.
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
};
g.cancelAnimationFrame = (_id: number) => {};

// A ResizeObserver that reports a fixed laptop viewport synchronously on
// observe, so useViewportSize has a deterministic size.
class FakeResizeObserver {
  private readonly size = { width: 1280, height: 800 };
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry = {
      target,
      contentRect: {
        width: this.size.width,
        height: this.size.height,
        top: 0,
        left: 0,
        bottom: this.size.height,
        right: this.size.width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry;
    this.cb([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof g.ResizeObserver === 'undefined') {
  g.ResizeObserver = FakeResizeObserver;
}

afterEach(() => {
  cleanup();
});

// The keyboard guard that keeps a burst of typing out of the board's shortcuts
// remembers the last character on a clock (see `typingGuard`). That memory is
// correct in a browser and meaningless between tests: one test's 'n' must not be
// swallowed because the test before it typed into a note. Every test starts with
// nobody mid-word; a test that means to be mid-word types within itself.
beforeEach(() => {
  resetTypingBurst();
});
