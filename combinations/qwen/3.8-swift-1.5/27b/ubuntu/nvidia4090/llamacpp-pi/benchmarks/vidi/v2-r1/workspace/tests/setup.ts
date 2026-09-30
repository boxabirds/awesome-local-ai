import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver; provide a no-op polyfill so
// components that observe their size (Board viewport) can render in tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
