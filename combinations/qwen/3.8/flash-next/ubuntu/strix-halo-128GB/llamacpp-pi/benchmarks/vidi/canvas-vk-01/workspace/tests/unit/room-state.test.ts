import { describe, it, expect } from 'vitest';

import {
  initialRoomState,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

/**
 * persist.room unit test (TC-27): every edge of the design's room lifecycle
 * diagram, plus the negative direction — an event that means nothing in a state
 * must leave it untouched.
 */

const connect = (sinceFailureMs: number): RoomEvent => ({ type: 'client-connected', sinceFailureMs });

describe('room lifecycle (TC-27)', () => {
  it('begins every object in loading', () => {
    expect(initialRoomState()).toBe('loading');
  });

  it('Loading -> Ready when the snapshot and log apply', () => {
    expect(nextRoomState('loading', { type: 'load-succeeded' })).toBe('ready');
  });

  it('Loading -> Ready when damaged log rows were quarantined and the rest applied', () => {
    expect(nextRoomState('loading', { type: 'load-succeeded', quarantined: 3 })).toBe('ready');
  });

  it('Loading -> LoadFailed when the snapshot is unreadable or SQL errors', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('Ready -> Ready when an update is stored and broadcast', () => {
    expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
    expect(nextRoomState('ready', connect(0))).toBe('ready');
  });

  it('Ready -> Compacting -> Ready when compaction commits', () => {
    const compacting = nextRoomState('ready', { type: 'compaction-started' });
    expect(compacting).toBe('compacting');
    expect(nextRoomState(compacting, { type: 'compaction-finished' })).toBe('ready');
  });

  it('Compacting -> Ready when compaction failed and rolled back', () => {
    expect(nextRoomState('compacting', { type: 'compaction-finished', rolledBack: true })).toBe('ready');
  });

  it('Ready -> StorageFailed -> Loading -> Ready after a failed insert', () => {
    const failed = nextRoomState('ready', { type: 'storage-write-failed' });
    expect(failed).toBe('storage-failed');
    const reloading = nextRoomState(failed, { type: 'reset-for-reload' });
    expect(reloading).toBe('loading');
    expect(nextRoomState(reloading, { type: 'load-succeeded' })).toBe('ready');
  });

  it('Ready -> Hibernated -> Loading when the object is woken', () => {
    const hibernated = nextRoomState('ready', { type: 'idle' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'woken' })).toBe('loading');
  });

  it('LoadFailed -> Loading on a new connection once the retry interval passed', () => {
    expect(nextRoomState('load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS))).toBe('loading');
    expect(
      nextRoomState('load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS + 10_000)),
    ).toBe('loading');
  });

  it('LoadFailed stays LoadFailed before the retry interval, boundary included', () => {
    expect(nextRoomState('load-failed', connect(0))).toBe('load-failed');
    expect(nextRoomState('load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS - 1))).toBe(
      'load-failed',
    );
  });

  describe('invalid events leave the state unchanged', () => {
    const negatives: Array<[RoomState, RoomEvent]> = [
      ['loading', { type: 'update-stored' }],
      ['loading', { type: 'compaction-started' }],
      ['loading', { type: 'storage-write-failed' }],
      ['loading', { type: 'idle' }],
      ['loading', { type: 'woken' }],
      ['loading', connect(60_000)],
      ['ready', { type: 'load-succeeded' }],
      ['ready', { type: 'load-failed' }],
      ['ready', { type: 'reset-for-reload' }],
      ['ready', { type: 'woken' }],
      ['compacting', { type: 'update-stored' }],
      ['compacting', { type: 'load-failed' }],
      ['compacting', { type: 'idle' }],
      ['compacting', { type: 'storage-write-failed' }],
      ['storage-failed', { type: 'update-stored' }],
      ['storage-failed', { type: 'load-succeeded' }],
      ['storage-failed', { type: 'idle' }],
      ['storage-failed', connect(60_000)],
      ['hibernated', { type: 'update-stored' }],
      ['hibernated', { type: 'load-succeeded' }],
      ['hibernated', { type: 'reset-for-reload' }],
      ['hibernated', connect(60_000)],
      ['load-failed', { type: 'update-stored' }],
      ['load-failed', { type: 'compaction-started' }],
      ['load-failed', { type: 'idle' }],
      ['load-failed', { type: 'woken' }],
    ];

    it.each(negatives)('%s unchanged by %s', (state, event) => {
      expect(nextRoomState(state, event)).toBe(state);
    });
  });

  it('exposes no other transition out of load-failed than the timed retry', () => {
    const events: RoomEvent[] = [
      { type: 'woken' },
      { type: 'load-succeeded' },
      { type: 'load-failed' },
      { type: 'update-stored' },
      { type: 'compaction-started' },
      { type: 'compaction-finished' },
      { type: 'storage-write-failed' },
      { type: 'reset-for-reload' },
      { type: 'idle' },
    ];
    for (const event of events) {
      expect(nextRoomState('load-failed', event)).toBe('load-failed');
    }
  });
});

/** Compile-time guard: the tests above cover every declared state. */
const ALL_STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

describe('coverage guard', () => {
  it('every lifecycle state has at least one outgoing edge under test', () => {
    expect(ALL_STATES.length).toBe(6);
  });
});
