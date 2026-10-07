import { describe, expect, it } from 'vitest';
import type { RoomEvent, RoomLifecycleState } from '../../src/worker/room-state';
import { nextRoomState } from '../../src/worker/room-state';

/**
 * persist.room, room lifecycle (TC-27).
 *
 * The room's real behaviour (store-before-broadcast, close 4500 on a LoadFailed
 * board, reload on wake) is driven by one small decision: given what state the
 * room is in and what just happened, what state is it in next? Every edge of the
 * design's lifecycle diagram is asserted here, and so is the negative half —
 * events that only make sense in some other state must leave this one untouched,
 * or a late `compact-ok` from a rolled-back compaction could, say, resurrect a
 * storage-failed room.
 */

const RETRY_OK: RoomEvent = { type: 'retry', intervalElapsed: true };
const RETRY_TOO_SOON: RoomEvent = { type: 'retry', intervalElapsed: false };

describe('every edge of the room lifecycle diagram (TC-27)', () => {
  const edges: [from: RoomLifecycleState, event: RoomEvent, to: RoomLifecycleState, why: string][] =
    [
      ['loading', { type: 'load-ok' }, 'ready', 'snapshot and log applied'],
      ['loading', { type: 'load-quarantined' }, 'ready', 'a damaged row was quarantined, rest applied'],
      ['loading', { type: 'load-failed' }, 'load-failed', 'snapshot unreadable or SQL error'],
      ['ready', { type: 'update' }, 'ready', 'an update was applied, stored and broadcast'],
      ['ready', { type: 'compact-needed' }, 'compacting', 'the log passed a compaction threshold'],
      ['compacting', { type: 'compact-ok' }, 'ready', 'snapshot replaced, log truncated'],
      ['compacting', { type: 'compact-failed' }, 'ready', 'compaction rolled back, log intact'],
      ['ready', { type: 'storage-error' }, 'storage-failed', 'a storage write threw'],
      ['storage-failed', { type: 'wake' }, 'loading', 'a new connection reloads from storage'],
      ['ready', { type: 'idle' }, 'hibernated', 'nobody connected; the runtime may evict'],
      ['hibernated', { type: 'wake' }, 'loading', 'a message or connection wakes the object'],
      ['load-failed', RETRY_OK, 'loading', 'a connection after LOAD_RETRY_MIN_INTERVAL_MS retries'],
      ['load-failed', RETRY_TOO_SOON, 'load-failed', 'a connection before the interval is refused'],
    ];

  for (const [from, event, to, why] of edges) {
    it(`${from} --${event.type}--> ${to}: ${why}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }
});

describe('events a state does not handle leave it unchanged (TC-27 negative)', () => {
  const stable: [state: RoomLifecycleState, event: RoomEvent, why: string][] = [
    ['loading', { type: 'update' }, 'an update cannot arrive during load'],
    ['loading', { type: 'idle' }, 'load is synchronous; no idle edge from loading'],
    ['loading', RETRY_OK, 'retry only means something to a load-failed room'],
    ['loading', { type: 'storage-error' }, 'a load-time SQL failure becomes load-failed, not storage-failed'],
    ['ready', { type: 'wake' }, 'a ready room is already loaded'],
    ['ready', { type: 'load-ok' }, 'load-ok only follows a load'],
    ['ready', { type: 'compact-ok' }, 'compaction results only follow a compaction'],
    ['ready', RETRY_OK, 'retry is not an event a ready room acts on'],
    ['compacting', { type: 'update' }, 'no update is taken mid-compaction'],
    ['compacting', { type: 'compact-needed' }, 'already compacting'],
    ['compacting', { type: 'storage-error' }, 'the diagram has no storage-failed edge out of compacting'],
    ['storage-failed', { type: 'update' }, 'a storage-failed room stores nothing until it reloads'],
    ['storage-failed', { type: 'load-ok' }, 'it must reload (wake) before a load can succeed'],
    ['hibernated', { type: 'update' }, 'an evicted object cannot take an update without waking'],
    ['hibernated', { type: 'idle' }, 'already hibernated'],
    ['load-failed', { type: 'update' }, 'a load-failed room stores nothing'],
    ['load-failed', { type: 'idle' }, 'load-failed is not hibernated'],
  ];

  for (const [state, event, why] of stable) {
    it(`${state} ignores ${event.type}: ${why}`, () => {
      expect(nextRoomState(state, event)).toBe(state);
    });
  }
});

describe('the retry boundary is decided by the payload alone (TC-27 boundary)', () => {
  it('intervalElapsed=false keeps load-failed, true reloads', () => {
    expect(nextRoomState('load-failed', { type: 'retry', intervalElapsed: false })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'retry', intervalElapsed: true })).toBe('loading');
  });
});
