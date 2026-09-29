import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** Fixed viewport used by the component tests (design fixture: 1280x800). */
export const TEST_VIEWPORT = { width: 1280, height: 800 };

/**
 * jsdom has no layout and no ResizeObserver. The stub reports the (mutable,
 * for the resize case) size synchronously from observe(), which is all the
 * board needs to know its viewport.
 */
class ResizeObserverStub {
  static size: { width: number; height: number } = { ...TEST_VIEWPORT };
  private static readonly live = new Set<ResizeObserverStub>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    ResizeObserverStub.live.add(this);
    this.report(target);
  }

  unobserve(_target: Element): void {
    // no-op
  }

  disconnect(): void {
    ResizeObserverStub.live.delete(this);
  }

  /** Test helper: report a new viewport size to every live observer. */
  static resize(width: number, height: number): void {
    ResizeObserverStub.size = { width, height };
    for (const observer of ResizeObserverStub.live) observer.report(observer.target);
  }

  private target: Element = null as unknown as Element;

  private report(target: Element): void {
    this.target = target;
    const { width, height } = ResizeObserverStub.size;
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as unknown as DOMRectReadOnly;
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// The board fills the window; useCamera seeds its first camera from the window
// size before it is measured, so pin the window size too.
Object.defineProperty(window, 'innerWidth', {
  value: TEST_VIEWPORT.width,
  configurable: true,
});
Object.defineProperty(window, 'innerHeight', {
  value: TEST_VIEWPORT.height,
  configurable: true,
});

afterEach(() => {
  cleanup();
  ResizeObserverStub.resize(TEST_VIEWPORT.width, TEST_VIEWPORT.height);
});

export { ResizeObserverStub };
