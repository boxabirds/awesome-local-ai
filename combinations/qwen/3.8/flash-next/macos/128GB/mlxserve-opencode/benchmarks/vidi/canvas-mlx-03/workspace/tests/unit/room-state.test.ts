// TC-27: every edge of the design's BoardRoom lifecycle diagram, plus the
// negative rule that an event which does not apply to a state leaves it
// unchanged. Pure function: no Durable Object runtime needed.
import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.ts';

const ALL_STATES: RoomState[] = [
  'loading',
  'ready',
  'load-failed',
  'compacting',
  'storage-failed',
  'hibernated',
];

describe('TC-27 room lifecycle transitions', () => {
  it('loading -> ready when the snapshot and log apply', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toEqual({ state: 'ready' });
  });

  it('loading -> ready when damaged log rows are quarantined and the rest applies', () => {
    expect(nextRoomState('loading', { type: 'load-ok-quarantined' })).toEqual({ state: 'ready' });
  });

  it('loading -> load-failed when the snapshot is unreadable or a read throws', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toEqual({ state: 'load-failed' });
  });

  it('ready -> ready while updates keep being applied, stored and broadcast', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toEqual({ state: 'ready' });
  });

  it('ready -> compacting when the log exceeds a threshold', () => {
    expect(nextRoomState('ready', { type: 'log-exceeds-threshold' })).toEqual({
      state: 'compacting',
    });
  });

  it('compacting -> ready on success and on a rolled-back failure', () => {
    expect(nextRoomState('compacting', { type: 'compaction-done' })).toEqual({ state: 'ready' });
    expect(nextRoomState('compacting', { type: 'compaction-error' })).toEqual({ state: 'ready' });
  });

  it('ready -> storage-failed when an insert throws', () => {
    expect(nextRoomState('ready', { type: 'storage-write-failed' })).toEqual({
      state: 'storage-failed',
    });
  });

  it('storage-failed -> loading on the next connection (doc discarded, reloads)', () => {
    expect(nextRoomState('storage-failed', { type: 'reload-requested' })).toEqual({
      state: 'loading',
    });
  });

  it('ready -> hibernated when there are no events', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toEqual({ state: 'hibernated' });
  });

  it('hibernated -> loading when a message or connection wakes the object', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toEqual({ state: 'loading' });
  });

  describe('load-failed retry boundary (LOAD_RETRY_MIN_INTERVAL_MS)', () => {
    it('stays load-failed and closes 4500 one ms before the interval', () => {
      const t = nextRoomState('load-failed', {
        type: 'load-retry',
        elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
      });
      expect(t.state).toBe('load-failed');
      expect(t.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    });

    it('stays load-failed and closes 4500 at zero elapsed', () => {
      const t = nextRoomState('load-failed', { type: 'load-retry', elapsedMs: 0 });
      expect(t.state).toBe('load-failed');
      expect(t.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    });

    it('goes to loading (retry the load) exactly at the interval', () => {
      expect(
        nextRoomState('load-failed', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS }),
      ).toEqual({ state: 'loading' });
    });

    it('goes to loading after the interval', () => {
      expect(
        nextRoomState('load-failed', {
          type: 'load-retry',
          elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1000,
        }),
      ).toEqual({ state: 'loading' });
    });
  });

  describe('events that do not apply to a state leave it unchanged (negative)', () => {
    const cases: [RoomState, RoomEvent][] = [
      ['loading', { type: 'update-applied' }],
      ['loading', { type: 'log-exceeds-threshold' }],
      ['loading', { type: 'storage-write-failed' }],
      ['loading', { type: 'compaction-done' }],
      ['loading', { type: 'compaction-error' }],
      ['loading', { type: 'hibernate' }],
      ['loading', { type: 'wake' }],
      ['loading', { type: 'reload-requested' }],
      ['loading', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS * 2 }],
      ['ready', { type: 'load-ok' }],
      ['ready', { type: 'load-ok-quarantined' }],
      ['ready', { type: 'load-failed' }],
      ['ready', { type: 'compaction-done' }],
      ['ready', { type: 'compaction-error' }],
      ['ready', { type: 'wake' }],
      ['ready', { type: 'reload-requested' }],
      ['ready', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS * 2 }],
      ['compacting', { type: 'update-applied' }],
      ['compacting', { type: 'storage-write-failed' }],
      ['compacting', { type: 'log-exceeds-threshold' }],
      ['compacting', { type: 'hibernate' }],
      ['compacting', { type: 'load-ok' }],
      ['load-failed', { type: 'update-applied' }],
      ['load-failed', { type: 'log-exceeds-threshold' }],
      ['load-failed', { type: 'storage-write-failed' }],
      ['load-failed', { type: 'hibernate' }],
      ['load-failed', { type: 'wake' }],
      ['load-failed', { type: 'load-ok' }],
      ['load-failed', { type: 'load-failed' }],
      ['storage-failed', { type: 'update-applied' }],
      ['storage-failed', { type: 'log-exceeds-threshold' }],
      ['storage-failed', { type: 'hibernate' }],
      ['storage-failed', { type: 'load-ok' }],
      ['storage-failed', { type: 'load-failed' }],
      ['storage-failed', { type: 'load-retry', elapsedMs: 0 }],
      ['hibernated', { type: 'update-applied' }],
      ['hibernated', { type: 'log-exceeds-threshold' }],
      ['hibernated', { type: 'load-ok' }],
      ['hibernated', { type: 'load-failed' }],
      ['hibernated', { type: 'storage-write-failed' }],
      ['hibernated', { type: 'reload-requested' }],
    ];

    it.each(cases)('%s + %j is a no-op', (state, event) => {
      expect(nextRoomState(state, event)).toEqual({ state });
    });

    it('never changes state for an unknown event shape', () => {
      for (const state of ALL_STATES) {
        const t = nextRoomState(state, { type: 'bogus' } as unknown as RoomEvent);
        expect(t.state).toBe(state);
      }
    });
  });
});
