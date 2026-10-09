import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// jsdom has no WebSocket and `App` connects its document to a board room, so the stub
// room the component tests talk through is installed here, before anything mounts.
import './fixtures/socket';
// Story 5: `App` also talks HTTP (`POST /api/boards`, `GET /api/boards/:id`), so the
// board service is stubbed at `fetch` here — the real `src/client/api.ts` still runs
// against it, and the test can see every request that was made.
import { resetBoardApiStub } from './fixtures/api';

/** Design fixture: default laptop viewport, used by the ResizeObserver stub below. */
export const VIEWPORT_FIXTURE = { width: 1280, height: 800 };

/**
 * jsdom has no ResizeObserver. The stub reports the fixture size, so the board
 * measures the same 1280x800 area component tests assert against.
 */
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = {
      width: VIEWPORT_FIXTURE.width,
      height: VIEWPORT_FIXTURE.height,
      top: 0,
      left: 0,
      right: VIEWPORT_FIXTURE.width,
      bottom: VIEWPORT_FIXTURE.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    this.callback(
      [
        {
          target,
          contentRect: rect,
          contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve(): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;


/**
 * jsdom's requestAnimationFrame fires on a ~16ms timer, which makes the camera's
 * one-update-per-frame batching race with assertions. Drive it from a 0ms timer so a
 * test that awaits a macrotask has flushed exactly the pending camera update.
 */
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
}) as typeof requestAnimationFrame;

globalThis.cancelAnimationFrame = ((handle: number): void => {
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}) as typeof cancelAnimationFrame;

// Keep the CSS pixel size consistent with the ResizeObserver stub.
export function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
}

setWindowSize(VIEWPORT_FIXTURE.width, VIEWPORT_FIXTURE.height);

afterEach(() => {
  cleanup();
  // Tests that resize the window do not leak their size into the next test.
  setWindowSize(VIEWPORT_FIXTURE.width, VIEWPORT_FIXTURE.height);
  // Neither does a stubbed service answer, or the log of what it was asked.
  resetBoardApiStub();
});
