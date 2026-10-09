import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';

/**
 * TC-27 (design "Persistent, hibernating board room", unit scope): every edge of the
 * room lifecycle diagram, and the rule that an event a state does not know leaves the
 * state exactly where it was. The room class itself keeps these transitions; this test
 * is what pins the diagram down.
 */

/** Every state the diagram has. */
const STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'load-failed',
  'storage-failed',
];

describe('nextRoomState (TC-27)', () => {
  it('Loading -> Ready: snapshot and log applied', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading -> Ready: log rows quarantined and the rest applied is still a success', () => {
    // Quarantining is part of `load-ok` (the count is a result, not a state).
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading -> LoadFailed: snapshot unreadable or SQL error', () => {
    expect(nextRoomState('loading', { type: 'load-error' })).toBe('load-failed');
  });

  it('Ready -> Ready: an update applied, stored and broadcast is a self edge', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toBe('ready');
  });

  it('Ready -> Compacting when the log passes the threshold', () => {
    expect(nextRoomState('ready', { type: 'log-over-threshold' })).toBe('compacting');
  });

  it('Compacting -> Ready on success', () => {
    expect(nextRoomState('compacting', { type: 'compaction-done' })).toBe('ready');
  });

  it('Compacting -> Ready on a rolled-back failure: the log is intact either way', () => {
    expect(nextRoomState('compacting', { type: 'compaction-error' })).toBe('ready');
  });

  it('Ready -> StorageFailed: an insert threw', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  it('StorageFailed -> Loading: the next connection reloads the doc', () => {
    expect(nextRoomState('storage-failed', { type: 'connection' })).toBe('loading');
  });

  it('Ready -> Hibernated: no events, sockets may stay open', () => {
    expect(nextRoomState('ready', { type: 'idle-with-sockets' })).toBe('hibernated');
  });

  it('Hibernated -> Loading: a message or new connection wakes the object', () => {
    expect(nextRoomState('hibernated', { type: 'woken' })).toBe('loading');
    expect(nextRoomState('hibernated', { type: 'connection' })).toBe('loading');
  });

  it('LoadFailed -> Loading: a new connection after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(
      nextRoomState('load-failed', { type: 'connection', afterRetryInterval: true }),
    ).toBe('loading');
  });

  it('LoadFailed -> LoadFailed: a connection before the interval (closed 4500, no attempt)', () => {
    expect(
      nextRoomState('load-failed', { type: 'connection', afterRetryInterval: false }),
    ).toBe('load-failed');
    // An unspecified clock counts as "before": the interval is the safe default.
    expect(nextRoomState('load-failed', { type: 'connection' })).toBe('load-failed');
  });

  it('Ready serves connections without leaving Ready', () => {
    expect(nextRoomState('ready', { type: 'connection' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'woken' })).toBe('ready');
  });

  // The negative half of TC-27: events a state does not know leave it unchanged.
  describe('invalid events leave the state unchanged', () => {
    const invalid: Array<[RoomState, RoomEvent]> = [
      // The log can only overrun while the room is serving updates.
      ['loading', { type: 'log-over-threshold' }],
      ['load-failed', { type: 'log-over-threshold' }],
      ['load-failed', { type: 'compaction-done' }],
      ['hibernated', { type: 'storage-error' }],
      // Its sockets were closed when storage failed; nothing to wake to.
      ['storage-failed', { type: 'woken' }],
      ['storage-failed', { type: 'idle-with-sockets' }],
      // Loading is in progress: the result of the load is the only thing that counts.
      ['loading', { type: 'update-applied' }],
      ['loading', { type: 'storage-error' }],
      ['loading', { type: 'idle-with-sockets' }],
      // Compaction is synchronous: no socket traffic interleaves with it.
      ['compacting', { type: 'connection' }],
      ['compacting', { type: 'storage-error' }],
      ['compacting', { type: 'update-applied' }],
      // A load cannot succeed twice in a row.
      ['ready', { type: 'load-ok' }],
      ['ready', { type: 'load-error' }],
      ['load-failed', { type: 'load-ok' }],
      ['load-failed', { type: 'update-applied' }],
      // Hibernated cannot serve or fail storage; it must load first.
      ['hibernated', { type: 'load-ok' }],
      ['hibernated', { type: 'update-applied' }],
      ['hibernated', { type: 'idle-with-sockets' }],
    ] as const;

    for (const [state, event] of invalid) {
      it(`${state} + ${event.type}${
        'afterRetryInterval' in event ? ` (afterRetryInterval=${event.afterRetryInterval})` : ''
      } stays ${state}`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  });

  it('unknown events (an old caller) leave every state unchanged', () => {
    for (const state of STATES) {
      const bogus = { type: 'tea-break' } as unknown as RoomEvent;
      expect(nextRoomState(state, bogus)).toBe(state);
    }
  });

  it('the retry clock only matters to LoadFailed; other states ignore it', () => {
    // A connection to a hibernated room wakes it whatever the clock says, because the
    // clock only throttles *load retries*.
    expect(
      nextRoomState('hibernated', {
        type: 'connection',
        afterRetryInterval: false,
      }),
    ).toBe('loading');
    expect(LOAD_RETRY_MIN_INTERVAL_MS).toBeGreaterThan(0);
  });
});
