// BoardRoom lifecycle state machine (spec: persist.room, TC-27).
//
// Every edge of the design room state diagram, the LOAD_RETRY_MIN_INTERVAL_MS
// boundary for load-failed retries, and invalid events that must leave a
// state unchanged (negative).

import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

function go(state: RoomState, event: RoomEvent): RoomState {
  return nextRoomState(state, event);
}

describe('loading (construct / wake)', () => {
  it('Loading -> Ready when the load succeeds', () => {
    expect(go('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading -> Ready also when rows were quarantined (a successful load)', () => {
    // Quarantine is part of a successful load; the same event transitions.
    expect(go('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading -> LoadFailed when the snapshot is unreadable or SQL fails', () => {
    expect(go('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('stays Loading for events that belong to other states', () => {
    expect(go('loading', { type: 'wake' })).toBe('loading');
    expect(go('loading', { type: 'compact-start' })).toBe('loading');
    expect(go('loading', { type: 'append-failed' })).toBe('loading');
    expect(go('loading', { type: 'hibernate' })).toBe('loading');
    expect(go('loading', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })).toBe(
      'loading',
    );
  });
});

describe('ready', () => {
  it('Ready -> Compacting when a compaction starts', () => {
    expect(go('ready', { type: 'compact-start' })).toBe('compacting');
  });

  it('Ready -> StorageFailed when an insert throws', () => {
    expect(go('ready', { type: 'append-failed' })).toBe('storage-failed');
  });

  it('Ready -> Hibernated when the object hibernates', () => {
    expect(go('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  it('stays Ready for events that belong to other states', () => {
    expect(go('ready', { type: 'load-ok' })).toBe('ready');
    expect(go('ready', { type: 'load-failed' })).toBe('ready');
    expect(go('ready', { type: 'compact-done' })).toBe('ready');
    expect(go('ready', { type: 'compact-rollback' })).toBe('ready');
    expect(go('ready', { type: 'wake' })).toBe('ready');
    expect(go('ready', { type: 'retry-load', elapsedMs: 0 })).toBe('ready');
  });
});

describe('compacting', () => {
  it('Compacting -> Ready when the compaction commits', () => {
    expect(go('compacting', { type: 'compact-done' })).toBe('ready');
  });

  it('Compacting -> Ready when the compaction rolls back (log intact)', () => {
    expect(go('compacting', { type: 'compact-rollback' })).toBe('ready');
  });

  it('stays Compacting for events that belong to other states', () => {
    expect(go('compacting', { type: 'append-failed' })).toBe('compacting');
    expect(go('compacting', { type: 'load-ok' })).toBe('compacting');
    expect(go('compacting', { type: 'wake' })).toBe('compacting');
  });
});

describe('storage-failed', () => {
  it('StorageFailed -> Loading on the next connection (wake reloads the doc)', () => {
    expect(go('storage-failed', { type: 'wake' })).toBe('loading');
  });

  it('stays StorageFailed for events that belong to other states', () => {
    expect(go('storage-failed', { type: 'load-ok' })).toBe('storage-failed');
    expect(go('storage-failed', { type: 'append-failed' })).toBe('storage-failed');
    expect(go('storage-failed', { type: 'hibernate' })).toBe('storage-failed');
    expect(go('storage-failed', { type: 'retry-load', elapsedMs: 10_000 })).toBe(
      'storage-failed',
    );
  });
});

describe('hibernated', () => {
  it('Hibernated -> Loading when a message or connection wakes the object', () => {
    expect(go('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('stays Hibernated for events that belong to other states', () => {
    expect(go('hibernated', { type: 'load-ok' })).toBe('hibernated');
    expect(go('hibernated', { type: 'load-failed' })).toBe('hibernated');
    expect(go('hibernated', { type: 'append-failed' })).toBe('hibernated');
  });
});

describe('load-failed', () => {
  it('LoadFailed -> Loading once LOAD_RETRY_MIN_INTERVAL_MS has elapsed (boundary)', () => {
    expect(go('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })).toBe(
      'loading',
    );
  });

  it('LoadFailed -> Loading after the interval', () => {
    expect(
      go('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 }),
    ).toBe('loading');
  });

  it('stays LoadFailed before the interval (connection is closed 4500, no reload)', () => {
    expect(go('load-failed', { type: 'retry-load', elapsedMs: 0 })).toBe('load-failed');
    expect(
      go('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }),
    ).toBe('load-failed');
  });

  it('stays LoadFailed for events that belong to other states', () => {
    expect(go('load-failed', { type: 'wake' })).toBe('load-failed');
    expect(go('load-failed', { type: 'load-ok' })).toBe('load-failed');
    expect(go('load-failed', { type: 'append-failed' })).toBe('load-failed');
  });
});
