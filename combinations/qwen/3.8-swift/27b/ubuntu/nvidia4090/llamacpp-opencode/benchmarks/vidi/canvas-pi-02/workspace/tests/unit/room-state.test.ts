// persist.room unit tests: nextRoomState covers every edge of the design's
// room lifecycle diagram, plus invalid events that must leave a state
// unchanged (negative). TC-27.

import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  nextRoomState,
  type RoomEvent,
  type RoomLifecycleState,
} from '../../src/worker/room-state';

const connection = (
  elapsedMs: number,
  minIntervalMs = LOAD_RETRY_MIN_INTERVAL_MS,
): RoomEvent => ({ kind: 'connection', elapsedMs, minIntervalMs });

const STRING_EVENTS: RoomEvent[] = [
  'load-ok',
  'load-failed',
  'update-stored',
  'compaction-start',
  'compaction-done',
  'compaction-rolled-back',
  'insert-threw',
  'doc-discarded',
  'hibernate',
  'wake',
];

describe('persist.room — lifecycle (TC-27)', () => {
  it('Loading → Ready (snapshot and log applied, clean)', () => {
    expect(nextRoomState('loading', 'load-ok')).toBe('ready');
  });

  it('Loading → Ready (log rows quarantined, rest applied)', () => {
    // Both loading outcomes that succeed land on Ready: the diagram has two
    // edges into Ready and the transition function is the same for both.
    expect(nextRoomState('loading', 'load-ok')).toBe('ready');
  });

  it('Loading → LoadFailed (snapshot unreadable or SQL error)', () => {
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  it('Ready → Ready (update applied, stored, broadcast)', () => {
    expect(nextRoomState('ready', 'update-stored')).toBe('ready');
  });

  it('Ready → Compacting → Ready (success and rollback)', () => {
    expect(nextRoomState('ready', 'compaction-start')).toBe('compacting');
    expect(nextRoomState('compacting', 'compaction-done')).toBe('ready');
    expect(nextRoomState('compacting', 'compaction-rolled-back')).toBe('ready');
  });

  it('Ready → StorageFailed → Loading (sockets closed, doc discarded)', () => {
    expect(nextRoomState('ready', 'insert-threw')).toBe('storage-failed');
    expect(nextRoomState('storage-failed', 'doc-discarded')).toBe('loading');
  });

  it('Ready → Hibernated → Loading (message or new connection wakes)', () => {
    expect(nextRoomState('ready', 'hibernate')).toBe('hibernated');
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
  });

  it('LoadFailed → Loading only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS - 1))).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS))).toBe(
      'loading',
    );
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS + 1))).toBe(
      'loading',
    );
  });

  it('LoadFailed before the interval stays LoadFailed (client closed 4500)', () => {
    for (const elapsed of [0, 1, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      expect(nextRoomState('load-failed', connection(elapsed))).toBe('load-failed');
    }
  });

  it('invalid events leave every state unchanged (negative)', () => {
    // The valid edges of each state; everything else is a no-op.
    const valid: Record<RoomLifecycleState, string[]> = {
      loading: ['load-ok', 'load-failed'],
      ready: ['update-stored', 'compaction-start', 'insert-threw', 'hibernate'],
      compacting: ['compaction-done', 'compaction-rolled-back'],
      'storage-failed': ['doc-discarded'],
      hibernated: ['wake'],
      'load-failed': [], // only the timed connection event is valid here
    };
    const states: RoomLifecycleState[] = [
      'loading',
      'ready',
      'compacting',
      'storage-failed',
      'hibernated',
      'load-failed',
    ];
    for (const state of states) {
      for (const event of STRING_EVENTS) {
        if (valid[state].includes(event as string)) continue;
        expect(nextRoomState(state, event), `${state} + ${event}`).toBe(state);
      }
      // A connection before the interval is a no-op outside load-failed.
      expect(nextRoomState(state, connection(999_999_999)), `${state} + connection`).toBe(
        state === 'load-failed' ? 'loading' : state,
      );
    }
  });
});
