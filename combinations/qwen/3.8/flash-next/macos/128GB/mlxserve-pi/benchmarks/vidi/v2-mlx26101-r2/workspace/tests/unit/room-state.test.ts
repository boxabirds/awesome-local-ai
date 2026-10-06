/**
 * TC-27 — every edge of the design's room lifecycle diagram, and the events that
 * must leave a room where it is. Pure function, no runtime (design "Testing
 * strategy": the state machine is tested in isolation, the socket and storage
 * behaviour that drives it is tested in workerd).
 */

import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.js';
import {
  nextRoomState,
  wireStateOf,
  type RoomEvent,
  type RoomLifecycleState,
} from '../../src/worker/room-state.js';

/** Every state of the diagram, so the negative cases can cover all of them. */
const STATES: RoomLifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

/** Every event of the diagram, at a value that satisfies each of them. */
const EVENTS: RoomEvent[] = [
  { type: 'constructed' },
  { type: 'loaded', quarantined: 0 },
  { type: 'loaded', quarantined: 3 },
  { type: 'load-failed' },
  { type: 'stored' },
  { type: 'compaction-start' },
  { type: 'compacted' },
  { type: 'compaction-failed' },
  { type: 'append-failed' },
  { type: 'hibernated' },
  { type: 'woken' },
  { type: 'connection', msSinceFailure: 0 },
  { type: 'connection', msSinceFailure: LOAD_RETRY_MIN_INTERVAL_MS },
  { type: 'retry-load' },
];

describe('room lifecycle (TC-27)', () => {
  it('a constructed or woken room is loading', () => {
    expect(nextRoomState('hibernated', { type: 'woken' })).toBe('loading');
    // The constructor of a room that has just been created starts the same way.
    expect(nextRoomState('loading', { type: 'constructed' })).toBe('loading');
  });

  it('a load that worked makes the room ready, with or without damage', () => {
    expect(nextRoomState('loading', { type: 'loaded', quarantined: 0 })).toBe('ready');
    // One damaged row set aside is still a board that loaded.
    expect(nextRoomState('loading', { type: 'loaded', quarantined: 2 })).toBe('ready');
  });

  it('a load that did not work makes the room load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('a stored change leaves the room ready', () => {
    expect(nextRoomState('ready', { type: 'stored' })).toBe('ready');
  });

  it('compaction goes from ready through compacting and back to ready, either way', () => {
    const compacting = nextRoomState('ready', { type: 'compaction-start' });
    expect(compacting).toBe('compacting');
    // The snapshot was replaced and the log truncated.
    expect(nextRoomState(compacting, { type: 'compacted' })).toBe('ready');
    // Or it threw, was rolled back and the log is intact: still a working board.
    expect(nextRoomState(compacting, { type: 'compaction-failed' })).toBe('ready');
  });

  it('a write that failed makes the room storage-failed, and the next connection loads', () => {
    const failed = nextRoomState('ready', { type: 'append-failed' });
    expect(failed).toBe('storage-failed');
    expect(nextRoomState(failed, { type: 'retry-load' })).toBe('loading');
    expect(nextRoomState(nextRoomState(failed, { type: 'retry-load' }), { type: 'loaded', quarantined: 0 })).toBe(
      'ready',
    );
  });

  it('a quiet room hibernates and a message or a connection wakes it into a load', () => {
    const hibernated = nextRoomState('ready', { type: 'hibernated' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'woken' })).toBe('loading');
  });

  describe('the retry of a board that could not be loaded', () => {
    it('retries once the retry interval has passed', () => {
      expect(
        nextRoomState('load-failed', { type: 'connection', msSinceFailure: LOAD_RETRY_MIN_INTERVAL_MS }),
      ).toBe('loading');
      expect(
        nextRoomState('load-failed', { type: 'connection', msSinceFailure: LOAD_RETRY_MIN_INTERVAL_MS + 1 }),
      ).toBe('loading');
    });

    it('stays load-failed before the interval, which is the close-with-4500 case', () => {
      for (const msSinceFailure of [0, 1, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
        const next = nextRoomState('load-failed', { type: 'connection', msSinceFailure });
        expect(next).toBe('load-failed');
        // Staying is what tells the room to answer this connection with 4500
        // rather than to read storage again.
        expect(wireStateOf(next)).toBe('load-failed');
      }
    });

    it('retries again and again until it works', () => {
      let state: RoomLifecycleState = 'load-failed';
      for (let elapsed = 0; elapsed < LOAD_RETRY_MIN_INTERVAL_MS * 3; elapsed += LOAD_RETRY_MIN_INTERVAL_MS) {
        state = nextRoomState(state, { type: 'connection', msSinceFailure: LOAD_RETRY_MIN_INTERVAL_MS });
        expect(state).toBe('loading');
        state = nextRoomState(state, { type: 'load-failed' });
        expect(state).toBe('load-failed');
      }
    });
  });

  describe('invalid events leave the state alone', () => {
    // For every state, the events the diagram does not attach to it.
    const VALID: Record<RoomLifecycleState, Set<string>> = {
      loading: new Set(['loaded', 'load-failed']),
      ready: new Set(['stored', 'compaction-start', 'append-failed', 'hibernated']),
      compacting: new Set(['compacted', 'compaction-failed']),
      'storage-failed': new Set(['retry-load']),
      hibernated: new Set(['woken']),
      'load-failed': new Set(['connection']),
    };

    for (const state of STATES) {
      for (const event of EVENTS) {
        if (VALID[state].has(event.type)) continue;
        it(`${state} + ${event.type} changes nothing`, () => {
          expect(nextRoomState(state, event)).toBe(state);
        });
      }
    }

    it('the machine answers for every state and every event, and never invents one', () => {
      for (const state of STATES) {
        for (const event of EVENTS) {
          expect(STATES).toContain(nextRoomState(state, event));
        }
      }
    });
  });

  describe('what a socket is told', () => {
    it('only the two failures are visible to a client', () => {
      expect(wireStateOf('load-failed')).toBe('load-failed');
      expect(wireStateOf('storage-failed')).toBe('storage-failed');
    });

    it('a room that is serving — however briefly mid-load or mid-compaction — is ready', () => {
      for (const state of ['ready', 'compacting', 'loading', 'hibernated'] as const) {
        expect(wireStateOf(state)).toBe('ready');
      }
    });
  });
});
