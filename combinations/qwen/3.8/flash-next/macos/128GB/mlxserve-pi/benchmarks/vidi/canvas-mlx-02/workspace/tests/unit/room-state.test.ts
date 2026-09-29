// TC-27: every edge of the design.md lifecycle diagram, plus "invalid events
// leave the state unchanged", driven as a pure function.
import { describe, it, expect } from 'vitest';
import {
  nextLifecycleState,
  roomState,
  type LifecycleEvent,
  type LifecycleState,
} from '../../src/worker/room-state.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.ts';

const ALL_STATES: LifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'load-failed',
  'storage-failed',
  'hibernated',
];

const ALL_EVENTS: LifecycleEvent[] = [
  { type: 'load-ok' },
  { type: 'load-ok-quarantined' },
  { type: 'load-error' },
  { type: 'connect', elapsedMs: 0 },
  { type: 'compact-start' },
  { type: 'compact-ok' },
  { type: 'compact-failed' },
  { type: 'storage-error' },
  { type: 'reload' },
  { type: 'hibernate' },
];

const next = (state: LifecycleState, event: LifecycleEvent) => nextLifecycleState(state, event);

describe('TC-27 lifecycle edges', () => {
  it('Loading -> Ready on a clean load', () => {
    expect(next('loading', { type: 'load-ok' })).toEqual({ state: 'ready', closeCode: null });
  });

  it('Loading -> Ready when the load quarantined a row', () => {
    expect(next('loading', { type: 'load-ok-quarantined' })).toEqual({
      state: 'ready',
      closeCode: null,
    });
  });

  it('Loading -> LoadFailed on a failed read', () => {
    expect(next('loading', { type: 'load-error' })).toEqual({ state: 'load-failed', closeCode: null });
  });

  it('Ready -> Compacting -> Ready when compaction succeeds', () => {
    expect(next('ready', { type: 'compact-start' }).state).toBe('compacting');
    expect(next('compacting', { type: 'compact-ok' })).toEqual({ state: 'ready', closeCode: null });
  });

  it('Ready -> Compacting -> Ready when compaction rolls back', () => {
    expect(next('ready', { type: 'compact-start' }).state).toBe('compacting');
    expect(next('compacting', { type: 'compact-failed' })).toEqual({ state: 'ready', closeCode: null });
  });

  it('Ready -> StorageFailed on a storage error', () => {
    expect(next('ready', { type: 'storage-error' })).toEqual({
      state: 'storage-failed',
      closeCode: null,
    });
  });

  it('StorageFailed -> Loading on the next reload', () => {
    expect(next('storage-failed', { type: 'reload' })).toEqual({ state: 'loading', closeCode: null });
  });

  it('Ready -> Hibernated -> Loading on wake', () => {
    expect(next('ready', { type: 'hibernate' }).state).toBe('hibernated');
    expect(next('hibernated', { type: 'reload' })).toEqual({ state: 'loading', closeCode: null });
  });

  describe('LoadFailed retry timing', () => {
    it('stays LoadFailed and closes 4500 before LOAD_RETRY_MIN_INTERVAL_MS', () => {
      for (const elapsedMs of [0, 1, 1_000, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
        expect(next('load-failed', { type: 'connect', elapsedMs })).toEqual({
          state: 'load-failed',
          closeCode: CLOSE_BOARD_LOAD_FAILED,
        });
      }
    });

    it('retries the load at and after the interval', () => {
      for (const elapsedMs of [LOAD_RETRY_MIN_INTERVAL_MS, LOAD_RETRY_MIN_INTERVAL_MS + 60_000]) {
        expect(next('load-failed', { type: 'connect', elapsedMs })).toEqual({
          state: 'loading',
          closeCode: null,
        });
      }
    });

    it('never retries faster than the interval, twice in a row', () => {
      let state = next('load-failed', { type: 'connect', elapsedMs: 100 }).state;
      expect(state).toBe('load-failed');
      state = next(state, { type: 'connect', elapsedMs: 4_999 }).state;
      expect(state).toBe('load-failed');
    });
  });

  it('an event that is not legal for the state leaves it unchanged', () => {
    const legal = new Map<LifecycleState, Set<string>>([
      ['loading', new Set(['load-ok', 'load-ok-quarantined', 'load-error'])],
      ['ready', new Set(['compact-start', 'storage-error', 'hibernate'])],
      ['compacting', new Set(['compact-ok', 'compact-failed'])],
      ['load-failed', new Set(['connect'])],
      ['storage-failed', new Set(['reload'])],
      ['hibernated', new Set(['reload'])],
    ]);
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const t = next(state, event);
        if (legal.get(state)!.has(event.type)) continue;
        expect(t, `${state} + ${event.type}`).toEqual({ state, closeCode: null });
      }
    }
  });

  it('never invents a state and always returns a state', () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        expect(ALL_STATES).toContain(next(state, event).state);
      }
    }
  });
});

describe('roomState projection', () => {
  it('maps the lifecycle to what a client can observe', () => {
    expect(roomState('loading')).toBe('ready');
    expect(roomState('ready')).toBe('ready');
    expect(roomState('compacting')).toBe('ready');
    expect(roomState('hibernated')).toBe('ready');
    expect(roomState('load-failed')).toBe('load-failed');
    expect(roomState('storage-failed')).toBe('storage-failed');
  });
});
