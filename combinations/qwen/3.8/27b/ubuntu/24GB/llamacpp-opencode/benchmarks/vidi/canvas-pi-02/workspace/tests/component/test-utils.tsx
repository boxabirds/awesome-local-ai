import { act } from '@testing-library/react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { RefObject } from 'react';
import type { Size } from '../../src/client/canvas/camera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { BoardHarness } from './harness';

/** Frame timers faked: rAF (camera coalescing) plus the common timer APIs. */
const FAKE_TIMER_API = [
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
] as const;

export function enableFakeFrameTimers(): void {
  vi.useFakeTimers({ toFake: [...FAKE_TIMER_API] });
}

/** Flush all pending requestAnimationFrame camera commits inside act(). */
export function flushFrames(): void {
  act(() => {
    vi.runAllTimers();
  });
}

export const DEFAULT_SIZE: Size = { width: 1280, height: 800 };

export function renderHarness(size: Size = DEFAULT_SIZE): {
  apiRef: RefObject<CameraApi | null>;
  viewport: HTMLElement;
  world: HTMLElement;
} {
  const apiRef: RefObject<CameraApi | null> = { current: null };
  render(<BoardHarness size={size} apiRef={apiRef} />);
  const viewport = document.querySelector('.vidi6-viewport') as HTMLElement;
  const world = document.querySelector('.vidi6-world') as HTMLElement;
  return { apiRef, viewport, world };
}
