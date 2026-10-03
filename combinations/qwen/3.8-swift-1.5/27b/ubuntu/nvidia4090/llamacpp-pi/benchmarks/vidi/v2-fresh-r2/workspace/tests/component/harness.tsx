/**
 * Component test harness for the story 7 board: renders the real
 * `BoardView` with a fake (offline) provider so tests run against a local
 * Y.Doc with no network.
 *
 * In jsdom the camera starts at {x: 0, y: 0, zoom: 1} (zero-size viewport),
 * so screen coordinates equal world coordinates.
 */
import { act, render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardView } from '../../src/client/pages/BoardPage';
import type { ProviderLike, ProviderStatus } from '../../src/client/sync/connectBoard';
import { registerTestBox } from '../fixtures/testbox';

export function createFakeProvider() {
  const statusHandlers: Array<(e: { status: ProviderStatus }) => void> = [];
  const syncHandlers: Array<(s: boolean) => void> = [];

  const provider: ProviderLike = {
    on(event: 'status' | 'sync', handler: unknown) {
      if (event === 'status') statusHandlers.push(handler as (e: { status: ProviderStatus }) => void);
      if (event === 'sync') syncHandlers.push(handler as (s: boolean) => void);
    },
    off(): void {},
    destroy(): void {},
    ws: null,
  };

  return {
    provider,
    emitStatus(status: ProviderStatus): void {
      statusHandlers.forEach((h) => h({ status }));
    },
    emitSync(synced: boolean): void {
      syncHandlers.forEach((h) => h(synced));
    },
  };
}

export interface BoardHarness extends RenderResult {
  /** Force the load-failed state. */
  forceLoadFailed(): void;
}

/**
 * Render the board with a connected fake provider.
 *
 * `advance` flushes fake rAF frames (gesture writes are rAF-throttled).
 */
export function renderBoard(): BoardHarness {
  // Register the test-only testbox type (idempotent).
  registerTestBox();

  const { provider, emitStatus, emitSync } = createFakeProvider();
  const utils = render(
    <BoardView boardId="test-board" deps={{ createProvider: () => provider }} />,
  );

  act(() => {
    emitStatus('connected');
    emitSync(true);
  });

  return {
    ...utils,
    forceLoadFailed() {
      act(() => {
        window.__vidi6?.forceLoadFailed?.();
      });
    },
  };
}

/** The test hook (present in test builds). */
export function hook(): NonNullable<Window['__vidi6']> {
  const h = window.__vidi6;
  if (!h) throw new Error('window.__vidi6 test hook not registered');
  return h;
}

/** Insert a sticky centred on a world point and return its id. */
export function insertSticky(x: number, y: number): string {
  let id = '';
  act(() => {
    id = hook().insertSticky!(x, y);
  });
  return id;
}

/** Insert a testbox at a top-left corner and return its id. */
export function insertTestBox(x: number, y: number, width: number, height: number): string {
  let id = '';
  act(() => {
    id = hook().insertTestBox!(x, y, width, height);
  });
  return id;
}

/** Flush rAF-throttled gesture writes (fake timers). */
export function advance(ms = 32): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
