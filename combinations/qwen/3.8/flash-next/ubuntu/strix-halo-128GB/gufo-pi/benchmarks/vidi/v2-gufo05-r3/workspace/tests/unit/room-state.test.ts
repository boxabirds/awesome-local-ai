/**
 * The room lifecycle (task 1, TC-27): every edge of the design's state diagram,
 * plus one invalid event per state, which must leave the state alone.
 */
import { describe, expect, it } from 'vitest';

import {
  clientCloseCode,
  isLoadRetryDue,
  nextRoomState,
  type RoomEvent,
  type RoomStateName,
} from '../../src/worker/room-state';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

const ALL_STATES: RoomStateName[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

const ALL_EVENTS: RoomEvent[] = [
  { type: 'load-succeeded' },
  { type: 'load-failed' },
  { type: 'update-applied' },
  { type: 'compaction-needed' },
  { type: 'compaction-finished' },
  { type: 'storage-error' },
  { type: 'idle' },
  { type: 'woken' },
  { type: 'next-connection' },
  { type: 'connect', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
];

describe('the edges of the lifecycle diagram', () => {
  it('loading -> ready once the snapshot and the log are applied', () => {
    expect(nextRoomState('loading', { type: 'load-succeeded' })).toBe('ready');
  });

  it('loading -> ready when the rest applied after a row was quarantined', () => {
    // Quarantining happens inside the load; the room ends up serving the board.
    expect(nextRoomState('loading', { type: 'load-succeeded' })).toBe('ready');
  });

  it('loading -> load-failed when the snapshot is unreadable or SQL fails', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('ready -> ready while updates are applied, stored and broadcast', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toBe('ready');
  });

  it('ready -> compacting -> ready on a successful compaction', () => {
    const compacting = nextRoomState('ready', { type: 'compaction-needed' });
    expect(compacting).toBe('compacting');
    expect(nextRoomState(compacting, { type: 'compaction-finished' })).toBe('ready');
  });

  it('compacting -> ready when the compaction failed and rolled back', () => {
    expect(nextRoomState('compacting', { type: 'compaction-finished' })).toBe('ready');
  });

  it('ready -> storage-failed -> loading on the next connection', () => {
    const failed = nextRoomState('ready', { type: 'storage-error' });
    expect(failed).toBe('storage-failed');
    expect(nextRoomState(failed, { type: 'next-connection' })).toBe('loading');
  });

  it('ready -> hibernated -> loading when a message or connection wakes it', () => {
    const hibernated = nextRoomState('ready', { type: 'idle' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'woken' })).toBe('loading');
    expect(nextRoomState(hibernated, { type: 'next-connection' })).toBe('loading');
  });

  it('load-failed -> loading only on a connection after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    const late = nextRoomState('load-failed', {
      type: 'connect',
      elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS,
    });
    expect(late).toBe('loading');
    expect(
      nextRoomState('load-failed', { type: 'connect', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 }),
    ).toBe('loading');
  });

  it('load-failed -> load-failed for a connection before that interval', () => {
    const early = nextRoomState('load-failed', {
      type: 'connect',
      elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
    });
    expect(early).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'connect', elapsedMs: 0 })).toBe('load-failed');
  });
});

describe('the load retry boundary', () => {
  it('is LOAD_RETRY_MIN_INTERVAL_MS - 1 / exactly', () => {
    expect(isLoadRetryDue(LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(isLoadRetryDue(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe('what a new client is told', () => {
  it('a load-failed room closes it with CLOSE_BOARD_LOAD_FAILED', () => {
    expect(clientCloseCode('load-failed')).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  it('a storage-failed room closes it with CLOSE_STORAGE_FAILURE', () => {
    expect(clientCloseCode('storage-failed')).toBe(CLOSE_STORAGE_FAILURE);
  });

  it('a room that can serve a client does not close it', () => {
    expect(clientCloseCode('ready')).toBeNull();
    expect(clientCloseCode('loading')).toBeNull();
    expect(clientCloseCode('compacting')).toBeNull();
    expect(clientCloseCode('hibernated')).toBeNull();
  });
});

describe('events a state does not answer to change nothing (negative)', () => {
  /** The edges that are legal, from the diagram above. */
  const legal = new Map<RoomStateName, RoomEvent['type'][]>([
    ['loading', ['load-succeeded', 'load-failed']],
    ['ready', ['update-applied', 'compaction-needed', 'storage-error', 'idle']],
    ['compacting', ['compaction-finished']],
    ['storage-failed', ['next-connection']],
    ['hibernated', ['woken', 'next-connection']],
    ['load-failed', ['connect']],
  ]);

  for (const state of ALL_STATES) {
    const allowed = legal.get(state)!;
    const invalid = ALL_EVENTS.filter((event) => !allowed.includes(event.type));
    expect(invalid.length, `${state} has invalid events to check`).toBeGreaterThan(0);

    for (const event of invalid) {
      it(`${state} + ${event.type} leaves the state unchanged`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  }
});
