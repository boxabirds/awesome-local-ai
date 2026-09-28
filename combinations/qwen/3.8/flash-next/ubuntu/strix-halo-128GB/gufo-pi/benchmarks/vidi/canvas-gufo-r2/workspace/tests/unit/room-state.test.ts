/**
 * TC-27: every edge in the room lifecycle state diagram, plus
 * "an event that does not apply to a state leaves the state unchanged".
 */
import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomLifecycleState } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('nextRoomState', () => {
  // Loading → Ready: snapshot and log applied
  it('loading -> ready on load-ok', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  // Loading → LoadFailed: snapshot unreadable or SQL error
  it('loading -> load-failed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  // Ready → Compacting: log exceeds threshold
  it('ready -> compacting on compact-start', () => {
    expect(nextRoomState('ready', { type: 'compact-start' })).toBe('compacting');
  });

  // Compacting → Ready: snapshot replaced, log truncated
  it('compacting -> ready on compact-done', () => {
    expect(nextRoomState('compacting', { type: 'compact-done' })).toBe('ready');
  });

  // Compacting → Ready: compaction error, transaction rolled back
  it('compacting -> ready on compact-failed', () => {
    expect(nextRoomState('compacting', { type: 'compact-failed' })).toBe('ready');
  });

  // Ready → StorageFailed: insert throws
  it('ready -> storage-failed on storage-error', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  // StorageFailed → Loading: sockets closed, doc discarded, next connection
  it('storage-failed -> loading on reconnect', () => {
    expect(nextRoomState('storage-failed', { type: 'reconnect' })).toBe('loading');
  });

  // Ready → Hibernated: no events, sockets may stay open
  it('ready -> hibernated on idle', () => {
    expect(nextRoomState('ready', { type: 'idle' })).toBe('hibernated');
  });

  // Hibernated → Loading: message or new connection wakes object
  it('hibernated -> loading on wake', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  // LoadFailed → Loading: new connection after LOAD_RETRY_MIN_INTERVAL_MS
  it('load-failed -> loading on a connection after the retry interval', () => {
    expect(
      nextRoomState('load-failed', {
        type: 'connect-after-load-failure',
        elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS,
      }),
    ).toBe('loading');
    expect(
      nextRoomState('load-failed', {
        type: 'connect-after-load-failure',
        elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1,
      }),
    ).toBe('loading');
  });

  // LoadFailed → LoadFailed: connection before the interval
  it('load-failed stays load-failed on a connection before the retry interval', () => {
    expect(
      nextRoomState('load-failed', { type: 'connect-after-load-failure', elapsedMs: 0 }),
    ).toBe('load-failed');
    expect(
      nextRoomState('load-failed', {
        type: 'connect-after-load-failure',
        elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
      }),
    ).toBe('load-failed');
  });

  // An event that does not apply to a state leaves the state unchanged.
  it('leaves the state unchanged for events that do not apply', () => {
    const states: RoomLifecycleState[] = [
      'loading',
      'ready',
      'compacting',
      'storage-failed',
      'hibernated',
      'load-failed',
    ];
    const events = [
      { type: 'load-ok' },
      { type: 'load-failed' },
      { type: 'compact-start' },
      { type: 'compact-done' },
      { type: 'compact-failed' },
      { type: 'storage-error' },
      { type: 'reconnect' },
      { type: 'idle' },
      { type: 'wake' },
      { type: 'connect-after-load-failure', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS * 2 },
    ] as const;

    // Every (state, event) pair either follows a diagram edge or is a no-op.
    const edges = new Set([
      'loading|load-ok',
      'loading|load-failed',
      'ready|compact-start',
      'ready|storage-error',
      'ready|idle',
      'compacting|compact-done',
      'compacting|compact-failed',
      'storage-failed|reconnect',
      'hibernated|wake',
    ]);

    for (const state of states) {
      for (const event of events) {
        const next = nextRoomState(state, event as never);
        const key = `${state}|${event.type}`;
        if (state === 'load-failed' && event.type === 'connect-after-load-failure') {
          // Conditional edge: retry only once the interval has passed.
          expect(next, key).toBe(
            event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : state,
          );
        } else if (edges.has(key)) {
          expect(next, key).not.toBe(state);
        } else {
          expect(next, key).toBe(state);
        }
      }
    }
  });
});
