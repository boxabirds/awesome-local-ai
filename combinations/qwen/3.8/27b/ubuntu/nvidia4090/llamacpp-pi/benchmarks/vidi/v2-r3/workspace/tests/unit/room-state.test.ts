import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';

/**
 * TC-27: every edge of the design's room lifecycle diagram, plus invalid
 * events that must leave the state unchanged.
 */
describe('nextRoomState (TC-27)', () => {
  it('Loading -> Ready when the load applies, with or without quarantine', () => {
    expect(nextRoomState('loading', { type: 'load-succeeded', quarantined: 0 })).toBe('ready');
    expect(nextRoomState('loading', { type: 'load-succeeded', quarantined: 3 })).toBe('ready');
  });

  it('Loading -> LoadFailed when the snapshot is unreadable or SQL fails', () => {
    expect(nextRoomState('loading', { type: 'load-failed', reason: 'snapshot-unreadable' })).toBe(
      'load-failed',
    );
    expect(nextRoomState('loading', { type: 'load-failed', reason: 'sql-error' })).toBe(
      'load-failed',
    );
  });

  it('Ready -> Compacting -> Ready on both commit and rollback', () => {
    expect(nextRoomState('ready', { type: 'compaction-start' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'compaction-commit' })).toBe('ready');
    expect(nextRoomState('compacting', { type: 'compaction-rollback' })).toBe('ready');
  });

  it('Ready -> StorageFailed -> Loading when the next connection reloads', () => {
    expect(nextRoomState('ready', { type: 'storage-write-failed' })).toBe('storage-failed');
    expect(nextRoomState('storage-failed', { type: 'reload-requested' })).toBe('loading');
  });

  it('Ready -> Hibernated -> Loading on wake', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('an applied, stored update keeps a Ready room Ready (self-loop)', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toBe('ready');
  });

  describe('LoadFailed retries only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    it('a connection at or after the interval moves to Loading', () => {
      expect(
        nextRoomState('load-failed', {
          type: 'connection',
          elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        }),
      ).toBe('loading');
      expect(
        nextRoomState('load-failed', {
          type: 'connection',
          elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        }),
      ).toBe('loading');
    });

    it('a connection before the interval stays LoadFailed (the room closes 4500)', () => {
      expect(
        nextRoomState('load-failed', {
          type: 'connection',
          elapsedMs: 0,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        }),
      ).toBe('load-failed');
      expect(
        nextRoomState('load-failed', {
          type: 'connection',
          elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        }),
      ).toBe('load-failed');
    });
  });

  describe('invalid events leave the state unchanged', () => {
    const invalid: Array<[RoomState, RoomEvent]> = [
      ['loading', { type: 'update-applied' }],
      ['loading', { type: 'compaction-start' }],
      ['loading', { type: 'storage-write-failed' }],
      ['loading', { type: 'hibernate' }],
      ['loading', { type: 'wake' }],
      [
        'loading',
        {
          type: 'connection',
          elapsedMs: Number.MAX_SAFE_INTEGER,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        },
      ],
      ['ready', { type: 'load-succeeded', quarantined: 0 }],
      ['ready', { type: 'load-failed', reason: 'sql-error' }],
      ['ready', { type: 'compaction-commit' }],
      ['ready', { type: 'compaction-rollback' }],
      ['ready', { type: 'reload-requested' }],
      ['ready', { type: 'wake' }],
      ['compacting', { type: 'update-applied' }],
      ['compacting', { type: 'compaction-start' }],
      ['compacting', { type: 'storage-write-failed' }],
      ['compacting', { type: 'hibernate' }],
      ['storage-failed', { type: 'update-applied' }],
      ['storage-failed', { type: 'hibernate' }],
      ['storage-failed', { type: 'wake' }],
      ['storage-failed', { type: 'load-succeeded', quarantined: 0 }],
      ['hibernated', { type: 'compaction-start' }],
      ['hibernated', { type: 'storage-write-failed' }],
      ['hibernated', { type: 'load-succeeded', quarantined: 0 }],
      ['load-failed', { type: 'load-succeeded', quarantined: 0 }],
      ['load-failed', { type: 'compaction-start' }],
      ['load-failed', { type: 'storage-write-failed' }],
      ['load-failed', { type: 'hibernate' }],
      ['load-failed', { type: 'wake' }],
      [
        'load-failed',
        {
          type: 'connection',
          elapsedMs: 0,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        },
      ],
    ];
    for (const [state, event] of invalid) {
      it(`${state} + ${event.type} stays ${state}`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  });
});
