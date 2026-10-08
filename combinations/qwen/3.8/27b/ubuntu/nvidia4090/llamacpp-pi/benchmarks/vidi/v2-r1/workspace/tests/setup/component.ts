// Component test setup (jsdom): jest-dom matchers, PointerEvent + pointer
// capture + ResizeObserver polyfills (jsdom has none of them), and a mocked
// board API (story 5: ui-component tests never talk to a real board API).

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { FIXTURE_DIMENSIONS } from '../fixtures/images';

// The api module is mocked for every component test. The defaults (board
// exists; creation succeeds with a fixed id) keep the existing App-rendering
// specs working; the pages specs override these mocks per test via
// vi.mocked(checkBoard) / vi.mocked(createBoardRequest).
vi.mock('../../src/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' as const })),
  createBoardRequest: vi.fn(async () => ({ kind: 'created' as const, id: 'c'.repeat(22) })),
}));

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

// createImageBitmap (story 12, image.insert): jsdom has no image decoder
// (and its File has no arrayBuffer()), so the stub reads the dimensions
// that fileFromBytes stashed on complete-PNG fixtures (FIXTURE_DIMENSIONS);
// anything without them is rejected, mirroring a browser decode failure
// (the "disguised PDF" and corrupt cases map to the type message).
if (typeof win.createImageBitmap !== 'function') {
  win.createImageBitmap = async (source: File): Promise<unknown> => {
    const dims = (source as unknown as Record<symbol, unknown>)[FIXTURE_DIMENSIONS] as
      | { width: number; height: number }
      | undefined;
    if (dims === undefined) {
      throw new Error('createImageBitmap: undecodable image (jsdom stub)');
    }
    return { width: dims.width, height: dims.height, close: () => undefined };
  };
}
