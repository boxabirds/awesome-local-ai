import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * jsdom has no requestAnimationFrame (and Vitest's fake timers cannot install
 * one where none exists), so tests use a frame queue they can flush. This is
 * the "rAF via fake timers" of the design: camera updates land on the next
 * frame and tests advance that frame deterministically.
 */
type FrameCallback = (time: number) => void;

const frames: FrameCallback[] = [];
let frameHandle = 1;

Object.defineProperty(window, 'requestAnimationFrame', {
  configurable: true,
  writable: true,
  value: (callback: FrameCallback) => {
    frames.push(callback);
    return frameHandle++;
  },
});

Object.defineProperty(window, 'cancelAnimationFrame', {
  configurable: true,
  writable: true,
  value: () => undefined,
});

/** Run every queued frame callback (one camera render per queued frame). */
export function drainFrames(): number {
  const queued = frames.splice(0, frames.length);
  for (const callback of queued) callback(Date.now());
  return queued.length;
}

/** jsdom reports no pointer capture; browsers capture the pointer while dragging. */
const noopCapture = (_pointerId: number) => undefined;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
  Element.prototype.setPointerCapture = noopCapture;
  Element.prototype.releasePointerCapture = noopCapture;
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: () => false,
  });
});

afterEach(() => {
  cleanup();
  frames.length = 0;
});
