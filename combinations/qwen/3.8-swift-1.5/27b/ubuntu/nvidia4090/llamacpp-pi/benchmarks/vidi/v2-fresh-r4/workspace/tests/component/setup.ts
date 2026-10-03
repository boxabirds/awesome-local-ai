import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver; the app guards against its absence, but a stub
// keeps behaviour consistent.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  writable: true,
  configurable: true,
});

// jsdom has no PointerEvent constructor, so testing-library's fireEvent.pointer*
// would fall back to a plain Event and drop button/clientX/pointerId. A minimal
// polyfill over MouseEvent restores those.
class PointerEventPolyfill extends (globalThis as { MouseEvent: typeof MouseEvent }).MouseEvent {
  readonly pointerId: number;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly azimuthAngle: number;
  readonly polarAngle: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.width = init.width ?? 0;
    this.height = init.height ?? 0;
    this.pressure = init.pressure ?? 0;
    this.tiltX = init.tiltX ?? 0;
    this.tiltY = init.tiltY ?? 0;
    this.azimuthAngle = init.azimuthAngle ?? 0;
    this.polarAngle = 0;
  }
}

Object.defineProperty(globalThis, 'PointerEvent', {
  value: PointerEventPolyfill,
  writable: true,
  configurable: true,
});

afterEach(() => {
  cleanup();
});
