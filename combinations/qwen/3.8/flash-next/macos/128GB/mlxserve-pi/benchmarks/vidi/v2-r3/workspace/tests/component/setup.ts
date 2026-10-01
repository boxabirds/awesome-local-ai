import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom has no layout engine. The board viewport measures itself with
 * getBoundingClientRect + ResizeObserver, so tests drive a deterministic
 * 1280x800 laptop viewport: getBoundingClientRect always reports it, and the
 * ResizeObserver stub re-reports synchronously on observe (and on
 * triggerResize for resize scenarios).
 */
export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 800;

function fakeRect(): DOMRect {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  };
  return { ...rect, toJSON: () => rect } as DOMRect;
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

Element.prototype.getBoundingClientRect = function () {
  return fakeRect();
};

export const resizeObservers: ResizeObserverStub[] = [];

class ResizeObserverStub {
  private readonly onResize: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.onResize = callback;
    resizeObservers.push(this);
  }

  observe(target: Element): void {
    this.onResize([makeEntry(target)], this as unknown as ResizeObserver);
  }

  unobserve(): void {}

  disconnect(): void {
    const index = resizeObservers.indexOf(this);
    if (index >= 0) resizeObservers.splice(index, 1);
  }

  triggerResize(target: Element): void {
    this.onResize([makeEntry(target)], this as unknown as ResizeObserver);
  }
}

function makeEntry(target: Element): ResizeObserverEntry {
  return {
    target,
    contentRect: target.getBoundingClientRect(),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  } as ResizeObserverEntry;
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});
