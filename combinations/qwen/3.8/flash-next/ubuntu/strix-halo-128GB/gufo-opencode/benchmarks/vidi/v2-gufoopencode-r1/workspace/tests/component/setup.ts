// jsdom lacks pointer capture and ResizeObserver; provide minimal stubs.

Element.prototype.setPointerCapture = function setPointerCapture(_pointerId: number): void {};
Element.prototype.releasePointerCapture = function releasePointerCapture(_pointerId: number): void {};
Element.prototype.hasPointerCapture = function hasPointerCapture(_pointerId: number): boolean {
  return false;
};

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : window.innerWidth;
    const height = rect.height > 0 ? rect.height : window.innerHeight;
    const entry = {
      target,
      contentRect: { ...rect, width, height }
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(_target: Element): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
