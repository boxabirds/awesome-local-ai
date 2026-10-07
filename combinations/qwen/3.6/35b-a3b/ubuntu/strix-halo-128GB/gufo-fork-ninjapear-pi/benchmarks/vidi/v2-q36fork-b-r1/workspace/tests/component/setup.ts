import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for jsdom — sets reasonable dimensions on elements
class MockResizeObserver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private callback: any;
  constructor(cb: any) { this.callback = cb; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  observe(target: any) {
    // Simulate a ~1280×800 viewport for top-level containers
    const w = target._testWidth || 1280;
    const h = target._testHeight || 800;
    setTimeout(() => {
      this.callback([{ contentRect: { width: w, height: h } }], target);
    }, 0);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unobserve(_target: any) {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

// Mock requestAnimationFrame for tests that use it
if (typeof globalThis.requestAnimationFrame !== 'function') {
  // @ts-ignore rAF may not be in jsdom
  globalThis.requestAnimationFrame = ((cb: () => void) => setTimeout(cb, 0));
}
if (typeof globalThis.cancelAnimationFrame !== 'function') {
  // @ts-ignore rAF may not be in jsdom
  globalThis.cancelAnimationFrame = ((id) => clearTimeout(id));
}
