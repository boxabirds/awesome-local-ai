import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import {
  nextRoomState,
  type RoomClock,
  type RoomEvent,
  type RoomLifecycleState,
  type RoomTransition,
} from '../../src/worker/room-state';

/**
 * TC-27 (anchor `persist.room`).
 *
 * The room lifecycle of the design, as a table: every edge of the diagram is one
 * assertion, every event that a state must not react to is another, and the
 * LoadFailed retry edge is checked on both sides of LOAD_RETRY_MIN_INTERVAL_MS.
 * A room that reacts to an event it is not in a state for would either reload a
 * board it has already refused twice, or forget a failure it is still holding.
 */

const STATES: RoomLifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'load-failed',
  'storage-failed',
  'hibernated',
];

const EVENTS: RoomEvent[] = [
  'load-succeeded',
  'load-quarantined',
  'load-failed',
  'compact-start',
  'compact-succeeded',
  'compact-failed',
  'storage-failed',
  'reload',
  'hibernate',
  'wake',
  'retry-load',
];

const clock = (sinceFailedMs = 0): RoomClock => ({ sinceFailedMs });

const run = (
  state: RoomLifecycleState,
  event: RoomEvent,
  sinceFailedMs = 0,
): RoomTransition => nextRoomState(state, event, clock(sinceFailedMs));

const expectTo = (state: RoomLifecycleState, event: RoomEvent, next: RoomLifecycleState): void => {
  const transition = run(state, event);
  expect(`${state} --${event}--> ${transition.state}`).toBe(`${state} --${event}--> ${next}`);
  expect(transition.changed).toBe(true);
  expect(transition.closeCode).toBeNull();
};

describe('room lifecycle transitions (persist.room)', () => {
  it('TC-27: a woken object that reads snapshot and log becomes Ready', () => {
    expectTo('loading', 'load-succeeded', 'ready');
  });

  it('TC-27: damaged log rows quarantined still leave the room Ready', () => {
    expectTo('loading', 'load-quarantined', 'ready');
  });

  it('TC-27: an unreadable snapshot or a failed read makes the room LoadFailed', () => {
    const transition = run('loading', 'load-failed');
    expect(transition.state).toBe('load-failed');
    expect(transition.changed).toBe(true);
  });

  it('TC-27: an over-threshold log compacts and returns to Ready', () => {
    expectTo('ready', 'compact-start', 'compacting');
    expectTo('compacting', 'compact-succeeded', 'ready');
  });

  it('TC-27: a rolled-back compaction returns to Ready with the log intact', () => {
    expectTo('compacting', 'compact-failed', 'ready');
  });

  it('TC-27: a write failure makes the room StorageFailed, and the next connection reloads it', () => {
    expectTo('ready', 'storage-failed', 'storage-failed');
    expectTo('storage-failed', 'reload', 'loading');
  });

  it('TC-27: an idle room hibernates and a message or connection wakes it into Loading', () => {
    expectTo('ready', 'hibernate', 'hibernated');
    expectTo('hibernated', 'wake', 'loading');
  });

  it('TC-27: LoadFailed retries its load only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    // Boundary: one millisecond before the interval the retry is refused ...
    const tooSoon = run('load-failed', 'retry-load', LOAD_RETRY_MIN_INTERVAL_MS - 1);
    expect(tooSoon.state).toBe('load-failed');
    expect(tooSoon.changed).toBe(false);
    expect(tooSoon.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // ... and at exactly the interval it is allowed.
    const onTime = run('load-failed', 'retry-load', LOAD_RETRY_MIN_INTERVAL_MS);
    expect(onTime.state).toBe('loading');
    expect(onTime.changed).toBe(true);
    expect(onTime.closeCode).toBeNull();
  });

  it('TC-27: a LoadFailed room keeps closing every new socket with CLOSE_BOARD_LOAD_FAILED', () => {
    for (const since of [0, 1, 1_000, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      const transition = run('load-failed', 'retry-load', since);
      expect(transition.state).toBe('load-failed');
      expect(transition.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    }
  });

  it('TC-27: every event is valid for exactly the states the diagram says it is', () => {
    const edges: Record<RoomLifecycleState, Partial<Record<RoomEvent, RoomLifecycleState>>> = {
      loading: {
        'load-succeeded': 'ready',
        'load-quarantined': 'ready',
        'load-failed': 'load-failed',
      },
      ready: {
        'compact-start': 'compacting',
        'storage-failed': 'storage-failed',
        hibernate: 'hibernated',
      },
      compacting: {
        'compact-succeeded': 'ready',
        'compact-failed': 'ready',
      },
      'load-failed': { 'retry-load': 'load-failed' },
      'storage-failed': { reload: 'loading' },
      hibernated: { wake: 'loading' },
    };

    for (const state of STATES) {
      for (const event of EVENTS) {
        const expected = edges[state]?.[event];
        const transition = run(state, event);
        if (expected === undefined) {
          expect(`${state} --${event}--> ${transition.state}`).toBe(`${state} --${event}--> ${state}`);
          expect(transition.changed).toBe(false);
          expect(transition.closeCode).toBeNull();
        } else {
          expect(`${state} --${event}--> ${transition.state}`).toBe(
            `${state} --${event}--> ${expected}`,
          );
        }
      }
    }
  });

  it('TC-27: an unknown state is left alone (negative)', () => {
    const transition = nextRoomState('nope' as RoomLifecycleState, 'load-succeeded', clock());
    expect(transition.state).toBe('nope');
    expect(transition.changed).toBe(false);
    expect(transition.closeCode).toBeNull();
  });
});
