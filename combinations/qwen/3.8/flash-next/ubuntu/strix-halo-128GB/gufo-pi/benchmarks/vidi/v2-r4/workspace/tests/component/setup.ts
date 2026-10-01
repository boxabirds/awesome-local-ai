import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/** A minimal ResizeObserver for jsdom, with a test helper to report a new size. */
class ResizeObserverStub {
  private readonly targets = new Set<Element>();

  static readonly instances: ResizeObserverStub[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
    this.emit();
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    const index = ResizeObserverStub.instances.indexOf(this);
    if (index >= 0) ResizeObserverStub.instances.splice(index, 1);
  }

  /** Report a new content rect for every observed element. */
  emit(width = 1200, height = 800): void {
    const entries = [...this.targets].map((target) => ({
      target,
      contentRect: {
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        toJSON: () => ({}),
      },
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
      contentBoxSize: [{ inlineSize: width, blockSize: height }],
      devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
    }));
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

/** The live ResizeObserver instances, newest first, for resize simulation. */
export function liveResizeObservers(): ResizeObserverStub[] {
  return ResizeObserverStub.instances;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom has no Pointer Capture API; the board uses it while dragging.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
