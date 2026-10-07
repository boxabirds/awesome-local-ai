// Component test setup (jsdom): jest-dom matchers, PointerEvent + pointer
// capture + ResizeObserver polyfills (jsdom has none of them).

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

interface PointerEventInitLike extends MouseEventInit {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
}

class JSDOMPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInitLike = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}

const win = window as unknown as Record<string, unknown>;
if (typeof win.PointerEvent !== 'function') {
  win.PointerEvent = JSDOMPointerEvent;
}

const elementProto = Element.prototype as unknown as Record<string, unknown>;
if (typeof elementProto.setPointerCapture !== 'function') {
  elementProto.setPointerCapture = function () {};
  elementProto.releasePointerCapture = function () {};
  elementProto.hasPointerCapture = function () {
    return false;
  };
}

class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof win.ResizeObserver !== 'function') {
  win.ResizeObserver = ResizeObserverPolyfill;
}
