import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  loadRetryAllowed,
  nextRoomState,
  type RoomEvent,
  type RoomPhase,
} from '../../src/worker/room-state';

/**
 * TC-27 (persist.room / persist.load_failure / persist.save_failure state
 * machine). Every edge of design.md's stateDiagram-v2, plus that an event with
 * no edge out of a state leaves it unchanged: a late or spurious event must
 * never move the room into a state the board is not in.
 */

const conn = (msSinceLoadFailed = 0): RoomEvent => ({
  type: 'connection',
  msSinceLoadFailed,
});

const ALL_STATES: RoomPhase[] = [
  'loading',
  'ready',
  'compacting',
  'load-failed',
  'storage-failed',
  'hibernated',
];

describe('nextRoomState: Loading', () => {
  it('snapshot + log applied → ready', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('log rows quarantined, the rest applied → ready', () => {
    expect(nextRoomState('loading', { type: 'load-ok-quarantined' })).toBe(
      'ready',
    );
  });

  it('snapshot unreadable or a SQL error → load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe(
      'load-failed',
    );
  });

  it('a new construction or wake reloads it', () => {
    expect(nextRoomState('loading', { type: 'construct' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'wake' })).toBe('loading');
  });
});

describe('nextRoomState: Ready', () => {
  it('an update applied and stored keeps it ready', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toBe('ready');
  });

  it('a new connection keeps it ready', () => {
    expect(nextRoomState('ready', conn(0))).toBe('ready');
    expect(nextRoomState('ready', conn(LOAD_RETRY_MIN_INTERVAL_MS))).toBe(
      'ready',
    );
  });

  it('the log passing a threshold → compacting', () => {
    expect(nextRoomState('ready', { type: 'compaction-due' })).toBe(
      'compacting',
    );
  });

  it('a write that throws → storage-failed', () => {
    expect(nextRoomState('ready', { type: 'storage-write-failed' })).toBe(
      'storage-failed',
    );
  });

  it('the last connection leaving, with no work in flight → hibernated', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });
});

describe('nextRoomState: Compacting', () => {
  it('snapshot replaced and log truncated → ready', () => {
    expect(nextRoomState('compacting', { type: 'compaction-done' })).toBe(
      'ready',
    );
  });

  it('a compaction error rolls back, the log intact → ready', () => {
    expect(nextRoomState('compacting', { type: 'compaction-failed' })).toBe(
      'ready',
    );
  });

  it('does not become storage-failed mid-transaction', () => {
    expect(nextRoomState('compacting', { type: 'storage-write-failed' })).toBe(
      'compacting',
    );
  });
});

describe('nextRoomState: StorageFailed', () => {
  it('sockets closed, doc discarded: the next connection → loading', () => {
    expect(nextRoomState('storage-failed', conn(0))).toBe('loading');
  });

  it('waits for the connection: nothing retries on its own', () => {
    expect(nextRoomState('storage-failed', { type: 'update-applied' })).toBe(
      'storage-failed',
    );
  });
});

describe('nextRoomState: Hibernated', () => {
  it('a message or new connection wakes the object → loading', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    expect(nextRoomState('hibernated', conn(0))).toBe('loading');
  });

  it('ignores everything else', () => {
    expect(nextRoomState('hibernated', { type: 'load-ok' })).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'compaction-due' })).toBe(
      'hibernated',
    );
    expect(nextRoomState('hibernated', { type: 'hibernate' })).toBe(
      'hibernated',
    );
  });
});

describe('nextRoomState: LoadFailed (TC-25 / TC-16 interval)', () => {
  it('a new connection after LOAD_RETRY_MIN_INTERVAL_MS → loading', () => {
    expect(
      nextRoomState('load-failed', conn(LOAD_RETRY_MIN_INTERVAL_MS)),
    ).toBe('loading');
    expect(
      nextRoomState('load-failed', conn(LOAD_RETRY_MIN_INTERVAL_MS + 1)),
    ).toBe('loading');
  });

  it('a connection before the interval stays load-failed (and closes 4500)', () => {
    for (const ms of [0, 1, 1_000, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      expect(nextRoomState('load-failed', conn(ms))).toBe('load-failed');
    }
  });

  it('load-ok arrives only through Loading', () => {
    expect(nextRoomState('load-failed', { type: 'load-ok' })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'load-failed' })).toBe(
      'load-failed',
    );
  });

  it('cannot compact or hibernate out of a failed load', () => {
    expect(nextRoomState('load-failed', { type: 'compaction-due' })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'update-applied' })).toBe(
      'load-failed',
    );
  });
});

describe('nextRoomState: no invented states', () => {
  const events: RoomEvent[] = [
    { type: 'load-ok' },
    { type: 'load-ok-quarantined' },
    { type: 'load-failed' },
    { type: 'update-applied' },
    { type: 'compaction-due' },
    { type: 'compaction-done' },
    { type: 'compaction-failed' },
    { type: 'storage-write-failed' },
    { type: 'hibernate' },
    { type: 'wake' },
    conn(0),
  ];

  it('every event yields a state the machine has', () => {
    for (const state of ALL_STATES) {
      for (const event of events) {
        expect(ALL_STATES).toContain(nextRoomState(state, event));
      }
    }
  });

  it('a state with no work in flight is never left by an unrelated event', () => {
    // load-* events only make sense while loading; compaction events only while
    // compacting; nothing at all happens inside a hibernated object.
    for (const state of ['ready', 'load-failed', 'storage-failed'] as RoomPhase[]) {
      for (const type of ['compaction-done', 'compaction-failed'] as const) {
        expect(nextRoomState(state, { type })).toBe(state);
      }
    }
    for (const state of ['ready', 'load-failed', 'storage-failed'] as RoomPhase[]) {
      expect(nextRoomState(state, { type: 'load-ok' })).toBe(state);
    }
  });
});

describe('nextRoomState: reading the board again in the same wake', () => {
  // Design.md reaches LoadFailed from Loading only. A room that is already Ready
  // and reads its board again — which is what a test hook's reload does, and the
  // only way a running room can find a board it cannot read — goes back through
  // Loading to get there.
  it('goes back to Loading from any state that can read the board', () => {
    for (const state of [
      'ready',
      'load-failed',
      'storage-failed',
      'hibernated',
      'loading',
    ] as RoomPhase[]) {
      expect(nextRoomState(state, { type: 'start-load' })).toBe('loading');
    }
    expect(
      nextRoomState(nextRoomState('ready', { type: 'start-load' }), { type: 'load-failed' }),
    ).toBe('load-failed');
    expect(
      nextRoomState(nextRoomState('ready', { type: 'start-load' }), { type: 'load-ok' }),
    ).toBe('ready');
  });

  it('does not start while compaction holds the room', () => {
    expect(nextRoomState('compacting', { type: 'start-load' })).toBe('compacting');
  });
});

describe('loadRetryAllowed', () => {
  it('allows a retry exactly at the interval and blocks one before it', () => {
    expect(loadRetryAllowed(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
    expect(loadRetryAllowed(LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
  });
});
