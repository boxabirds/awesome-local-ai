/**
 * Component-test setup: jest-dom matchers and the few DOM APIs jsdom lacks that
 * board code touches. Pointer capture is optional-called in the app, so only a
 * recording stub is needed for assertions that capture was requested.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom has no ResizeObserver; the app uses window resize only, but any
// transitive dependency can call it safely now.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
}
