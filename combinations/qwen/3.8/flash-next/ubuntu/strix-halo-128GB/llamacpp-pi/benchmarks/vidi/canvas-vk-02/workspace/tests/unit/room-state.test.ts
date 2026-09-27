/**
 * tests/unit/room-state.test.ts
 *
 * TC-27: every edge of the design's room lifecycle diagram, plus the negative
 * rule that an event which means nothing in a state changes nothing.
 *
 * The room itself is a Durable Object, and half of these edges need an
 * eviction, a read error or a storage failure to reach in a test. Modelling
 * the lifecycle as a function means the object only has to *report* what
 * happened to it, and the question "what state are we in now, and may this
 * socket be served" is answered at unit speed, for every edge, in both
 * directions.
 */
import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  ROOM_EVENT_TYPES,
  ROOM_LIFECYCLE_STATES,
  nextRoomState,
  observableState,
  shouldRetryLoad,
  type RoomEvent,
  type RoomLifecycle,
} from '../../src/worker/room-state';

const event = (type: RoomEvent['type'], extra = {}): RoomEvent =>
  ({ type, ...extra }) as RoomEvent;

/** Every event, so "means nothing here" can be proven by exhausting the set. */
const EVERY_EVENT: RoomEvent[] = ROOM_EVENT_TYPES.map((type) =>
  type === 'retry-load' ? event('retry-load', { elapsedMs: 0 }) : event(type),
);

describe('the room lifecycle (TC-27)', () => {
  describe('loading', () => {
    it('is ready when the snapshot and log apply', () => {
      expect(nextRoomState('loading', event('load-ok'))).toBe('ready');
    });

    it('is ready when damaged log rows were quarantined and the rest applied', () => {
      expect(nextRoomState('loading', event('load-quarantined'))).toBe('ready');
    });

    it('is load-failed when the snapshot is unreadable or SQL threw', () => {
      expect(nextRoomState('loading', event('load-failed'))).toBe('load-failed');
    });
  });

  describe('ready', () => {
    it('stays ready across an update that was applied, stored and broadcast', () => {
      expect(nextRoomState('ready', event('update'))).toBe('ready');
    });

    it('goes to compacting when the log passes the threshold', () => {
      expect(nextRoomState('ready', event('compact-start'))).toBe('compacting');
    });

    it('goes to storage-failed when an insert throws', () => {
      expect(nextRoomState('ready', event('storage-error'))).toBe('storage-failed');
    });

    it('may hibernate once nobody is connected', () => {
      expect(nextRoomState('ready', event('idle'))).toBe('hibernated');
    });
  });

  describe('compacting', () => {
    it('is ready when the snapshot was replaced and the log truncated', () => {
      expect(nextRoomState('compacting', event('compact-done'))).toBe('ready');
    });

    it('is ready after a rolled-back compaction, with the log intact', () => {
      expect(nextRoomState('compacting', event('compact-failed'))).toBe('ready');
    });
  });

  describe('storage-failed', () => {
    it('reads storage again on the next connection', () => {
      expect(nextRoomState('storage-failed', event('reload'))).toBe('loading');
    });
  });

  describe('hibernated', () => {
    it('loads again when a message or a connection wakes the object', () => {
      expect(nextRoomState('hibernated', event('wake'))).toBe('loading');
    });
  });

  describe('load-failed', () => {
    it('retries the load only once LOAD_RETRY_MIN_INTERVAL_MS have passed', () => {
      expect(
        nextRoomState('load-failed', event('retry-load', { elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 })),
      ).toBe('load-failed');
      expect(
        nextRoomState('load-failed', event('retry-load', { elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })),
      ).toBe('loading');
      expect(
        nextRoomState('load-failed', event('retry-load', { elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 })),
      ).toBe('loading');
    });

    it('is what shouldRetryLoad says, to the millisecond', () => {
      const failedAt = 1_000_000;
      expect(shouldRetryLoad('load-failed', failedAt + LOAD_RETRY_MIN_INTERVAL_MS - 1, failedAt)).toBe(false);
      expect(shouldRetryLoad('load-failed', failedAt + LOAD_RETRY_MIN_INTERVAL_MS, failedAt)).toBe(true);
      expect(shouldRetryLoad('ready', failedAt + LOAD_RETRY_MIN_INTERVAL_MS * 10, failedAt)).toBe(false);
    });
  });

  describe('events that mean nothing in a state', () => {
    /** Edges the diagram has, as `state -> event.type`, so the negatives below
     *  are exactly "everything else". */
    const EDGES: Array<[RoomLifecycle, RoomEvent['type']]> = [
      ['loading', 'load-ok'],
      ['loading', 'load-quarantined'],
      ['loading', 'load-failed'],
      ['ready', 'update'],
      ['ready', 'compact-start'],
      ['ready', 'storage-error'],
      ['ready', 'idle'],
      ['compacting', 'compact-done'],
      ['compacting', 'compact-failed'],
      ['storage-failed', 'reload'],
      ['hibernated', 'wake'],
      ['load-failed', 'retry-load'],
    ];

    for (const state of ROOM_LIFECYCLE_STATES) {
      const allowed = new Set(
        EDGES.filter(([from]) => from === state).map(([, type]) => type),
      );
      for (const candidate of EVERY_EVENT) {
        if (allowed.has(candidate.type)) continue;
        it(`leaves ${state} unchanged on ${candidate.type}`, () => {
          expect(nextRoomState(state, candidate)).toBe(state);
        });
      }
    }
  });

  describe('what a connection observes', () => {
    it('serves from ready, compacting and hibernated, and refuses the two failure states', () => {
      expect(observableState('ready')).toBe('ready');
      expect(observableState('compacting')).toBe('ready');
      expect(observableState('hibernated')).toBe('ready');
      expect(observableState('loading')).toBe('ready');
      expect(observableState('load-failed')).toBe('load-failed');
      expect(observableState('storage-failed')).toBe('storage-failed');
    });
  });
});
