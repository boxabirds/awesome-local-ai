import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * requestAnimationFrame is stubbed onto the macrotask queue so a component test
 * can flush "the next frame" with `await flushFrame()` instead of driving the
 * fake timer clock. It must not run synchronously: the camera hook stores the
 * frame handle and would then never schedule again.
 */
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number,
);
vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle as never));

afterEach(() => {
  // Unmounting cancels any frame the camera hook still has pending.
  cleanup();
});
