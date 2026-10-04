/**
 * Component-test environment setup.
 *
 * jsdom is missing a few browser APIs this app depends on, so they are filled in
 * here with small standards-shaped shims:
 *  - `PointerEvent` (jsdom ships none) so React's pointer handlers receive one.
 *  - `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture`.
 *  - `ResizeObserver` (reports the window size, which is what the board measures).
 *  - `requestAnimationFrame` mapped onto `setTimeout`, so the camera store's
 *    once-per-frame notification happens inside `await waitFor(...)`.
 *
 * `getBoundingClientRect()` is all zeros in jsdom; the board falls back to the window
 * size, which is why the tests compute expectations from `window.innerWidth/Height`.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { cameraStore } from '../../src/client/canvas/cameraStore';

// React 19 wants this set before `act`/`fireEvent` are used.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface PointerEventInitShim extends MouseEventInit {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  pressure?: number;
  width?: number;
  height?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
}

class JsdomPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly pressure: number;
  readonly width: number;
  readonly height: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;

  constructor(type: string, init: PointerEventInitShim = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
    this.pressure = init.pressure ?? 0.5;
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
    this.tiltX = init.tiltX ?? 0;
    this.tiltY = init.tiltY ?? 0;
    this.twist = init.twist ?? 0;
    this.altitudeAngle = init.altitudeAngle ?? 0;
    this.azimuthAngle = init.azimuthAngle ?? 0;
  }
}

const capturedPointers = new WeakMap<Element, Set<number>>();

function capturedIds(element: Element): Set<number> {
  let ids = capturedPointers.get(element);
  if (!ids) {
    ids = new Set();
    capturedPointers.set(element, ids);
  }
  return ids;
}

class JsdomResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.targets.add(target);
    this.notify([target]);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  /** jsdom has no layout, so the observed box is reported as the window size. */
  private notify(targets: Element[]): void {
    const entries = targets.map((target) => {
      const size = { width: window.innerWidth, height: window.innerHeight };
      return {
        target,
        contentRect: {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          width: size.width,
          height: size.height,
        },
        borderBoxSize: [{ boxSize: size, inlineSize: size.width, blockSize: size.height }],
        contentBoxSize: [{ boxSize: size, inlineSize: size.width, blockSize: size.height }],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;
    });
    this.callback(entries, this);
  }
}

Object.defineProperty(globalThis, 'PointerEvent', {
  value: JsdomPointerEvent,
  writable: true,
  configurable: true,
});

Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number): void {
  capturedIds(this).add(pointerId);
};

Element.prototype.releasePointerCapture = function releasePointerCapture(pointerId: number): void {
  capturedIds(this).delete(pointerId);
};

Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number): boolean {
  return capturedIds(this).has(pointerId);
};

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: JsdomResizeObserver,
  writable: true,
  configurable: true,
});

const FRAME_DELAY_MS = 0;

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (callback: FrameRequestCallback): number =>
    setTimeout(() => callback(performance.now()), FRAME_DELAY_MS) as unknown as number,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  value: (handle: number): void => clearTimeout(handle),
  writable: true,
  configurable: true,
});

beforeEach(() => {
  // Each test starts the way a fresh page load does: standard view, hint up.
  cameraStore.resetForTests();
});

afterEach(() => {
  cleanup();
});
