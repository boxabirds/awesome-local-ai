/**
 * jsdom is missing a few APIs the board touches. These stubs are deliberately
 * simple and deterministic; real layout and real browsers are covered by the
 * Playwright suite.
 */

/** Viewport size the ResizeObserver stub reports for every element. */
export const VIEWPORT_SIZE = { width: 1200, height: 800 };

type ObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const instances: StubResizeObserver[] = [];

function entryFor(target: Element, size: { width: number; height: number }): ResizeObserverEntry {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, ...size };
  return {
    target,
    contentRect: rect,
    contentBoxSize: [{ blockSize: size.height, inlineSize: size.width }],
    borderBoxSize: [{ blockSize: size.height, inlineSize: size.width }],
    devicePixelContentBoxSize: [{ blockSize: size.height, inlineSize: size.width }],
  } as unknown as ResizeObserverEntry;
}

class StubResizeObserver implements ResizeObserver {
  private targets: Element[] = [];
  private readonly callback: ObserverCallback;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
    // Report synchronously so tests do not need to drive the observer.
    this.callback([entryFor(target, VIEWPORT_SIZE)], this);
  }

  unobserve(target: Element): void {
    this.targets = this.targets.filter((element) => element !== target);
  }

  disconnect(): void {
    this.targets = [];
    const index = instances.indexOf(this);
    if (index >= 0) instances.splice(index, 1);
  }

  /** Test helper: report a new size to every live observer. */
  static resize(size: { width: number; height: number }): void {
    for (const instance of [...instances]) {
      instance.callback(instance.targets.map((target) => entryFor(target, size)), instance);
    }
  }

  static liveCount(): number {
    return instances.length;
  }
}

globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

export { StubResizeObserver };
