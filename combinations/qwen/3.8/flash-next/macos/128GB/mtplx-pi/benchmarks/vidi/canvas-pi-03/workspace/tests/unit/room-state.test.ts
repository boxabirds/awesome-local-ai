import { describe, expect, it } from 'vitest';
import { canServe, nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

// TC-27 (persist.room): every edge of the room lifecycle diagram, plus the
// negative half — an event that does not apply to a state must leave it
// untouched. Pure function, so no Durable Object, socket or database is needed.

describe('nextRoomState: the happy paths of the lifecycle diagram', () => {
  it('Loading → Ready when the document loads', () => {
    expect(nextRoomState('loading', { type: 'loaded', quarantined: 0 })).toBe('ready');
  });

  it('Loading → Ready (quarantined) when some rows were damaged but the board is usable', () => {
    expect(nextRoomState('loading', { type: 'loaded', quarantined: 3 })).toBe('ready');
    expect(canServe('ready')).toBe(true);
  });

  it('Loading → LoadFailed when the load cannot be trusted', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
    expect(canServe('load-failed')).toBe(false);
  });

  it('Ready → Compacting → Ready, for a compaction that succeeds and one that rolls back', () => {
    const compacting = nextRoomState('ready', { type: 'compact-start' });
    expect(compacting).toBe('compacting');
    expect(nextRoomState(compacting, { type: 'compact-done', ok: true })).toBe('ready');
    expect(nextRoomState(compacting, { type: 'compact-done', ok: false })).toBe('ready');
  });

  it('Ready → StorageFailed → Loading when a write throws and a later connection reloads', () => {
    const failed = nextRoomState('ready', { type: 'store-failed' });
    expect(failed).toBe('storage-failed');
    expect(canServe(failed)).toBe(false);
    expect(nextRoomState(failed, { type: 'reload' })).toBe('loading');
  });

  it('Ready → Hibernated → Loading when the object sleeps and a message wakes it', () => {
    const hibernated = nextRoomState('ready', { type: 'hibernate' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'wake' })).toBe('loading');
  });

  it('keeps serving while an update is stored', () => {
    expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
  });
});

describe('nextRoomState: the load-failure retry boundary', () => {
  it('stays LoadFailed (and keeps closing 4500) before LOAD_RETRY_MIN_INTERVAL_MS', () => {
    for (const elapsed of [0, 1, 100, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: elapsed })).toBe('load-failed');
    }
  });

  it('retries the load at exactly the interval, and after it', () => {
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })).toBe('loading');
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 60_000 })).toBe('loading');
  });
});

describe('nextRoomState: invalid events leave the state untouched (negative)', () => {
  const states: RoomState[] = [
    'loading',
    'ready',
    'compacting',
    'storage-failed',
    'hibernated',
    'load-failed',
  ];
  const events: RoomEvent[] = [
    { type: 'loaded', quarantined: 0 },
    { type: 'load-failed' },
    { type: 'update-stored' },
    { type: 'compact-start' },
    { type: 'compact-done', ok: true },
    { type: 'compact-done', ok: false },
    { type: 'store-failed' },
    { type: 'reload' },
    { type: 'hibernate' },
    { type: 'wake' },
    { type: 'retry-load', elapsedMs: 10_000 },
  ];

  // The transitions the diagram actually defines. Everything else must be a
  // no-op, so a stray event can never, say, take a hibernated room straight
  // back to serving from a stale document.
  const legal: Record<RoomState, RoomEvent['type'][]> = {
    loading: ['loaded', 'load-failed'],
    ready: ['update-stored', 'compact-start', 'store-failed', 'hibernate'],
    compacting: ['compact-done'],
    'storage-failed': ['reload'],
    hibernated: ['wake'],
    'load-failed': ['retry-load'],
  };

  it('only the documented transitions change anything', () => {
    for (const state of states) {
      for (const event of events) {
        const next = nextRoomState(state, event);
        if (!legal[state].includes(event.type)) {
          expect(next, `${state} + ${event.type}`).toBe(state);
        }
      }
    }
  });

  it('a throttled retry-load is a no-op, not a crash or a serve', () => {
    // 4500 with no reload attempt at all (TC-16's first half).
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: 0 })).toBe('load-failed');
    expect(canServe('load-failed')).toBe(false);
  });

  it('an unknown state is inert', () => {
    expect(nextRoomState('nonsense' as RoomState, { type: 'loaded', quarantined: 0 })).toBe('nonsense' as RoomState);
  });
});
