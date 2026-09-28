/**
 * Story 5: component tests render <App/> and must wait for the board page's
 * existence check (mocked 'exists' in setup.ts) before the board mounts.
 * Call `boardReady()` after every `render(<App />)` that expects the board.
 */
import { vi } from 'vitest';
import { screen } from '@testing-library/react';

export async function boardReady(): Promise<void> {
  await screen.findByTestId('board-viewport');
  // The viewport element can be in the DOM before React's passive effects run
  // (the board mounts outside act() — the mocked check resolves async). Board
  // sets window.__vidi6 in its own mount effect, which runs after
  // BoardViewport's native wheel/pointer listeners are attached (children
  // mount first), so once it exists the board is fully interactive.
  await vi.waitUntil(() =>
    Boolean((window as unknown as Record<string, unknown>).__vidi6),
  );
}

/**
 * Fake-timer-aware polling: advances fake time in small increments until
 * `probe` returns truthy (or `totalMs` elapse). Needed because React 18
 * schedules state updates through its own scheduler, so a single
 * `advanceTimersByTimeAsync(0)` does not flush a re-render. Returns the value
 * `probe` returned, or throws.
 */
export async function advanceUntil(
  probe: () => unknown,
  vi: { advanceTimersByTimeAsync: (ms: number) => Promise<unknown> },
  totalMs = 5000,
  stepMs = 25,
): Promise<unknown> {
  let elapsed = 0;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (elapsed >= totalMs) {
      throw new Error(`advanceUntil timed out after ${totalMs}ms`);
    }
    await vi.advanceTimersByTimeAsync(stepMs);
    elapsed += stepMs;
  }
}
