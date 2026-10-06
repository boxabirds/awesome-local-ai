/**
 * Room lifecycle unit tests (TC-27).
 *
 * The room's lifecycle decides what a person sees when they open a board: their board, an
 * honest failure message, or a board that is quietly empty (never). Every edge of the
 * design's state diagram is checked here, in both directions, plus the events that must
 * change nothing - a stray event must never strand a board in a state nothing can leave.
 */
import { describe, expect, test } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  loadRetryAllowed,
  nextRoomState,
  type RoomEvent,
  type RoomLifecycleState,
} from '../../src/worker/room-state';

const STATES: RoomLifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'load-failed',
  'storage-failed',
];

/** Every event, so each state can be offered the ones that do not belong to it. */
const EVENTS: RoomEvent[] = [
  { type: 'loaded' },
  { type: 'load-failed' },
  { type: 'update-applied' },
  { type: 'compaction-started' },
  { type: 'compaction-finished' },
  { type: 'compaction-failed' },
  { type: 'storage-failed' },
  { type: 'reload' },
  { type: 'hibernated' },
  { type: 'woken' },
  { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
];

/** One edge of the lifecycle diagram. */
interface Edge {
  readonly name: string;
  readonly from: RoomLifecycleState;
  readonly event: RoomEvent;
  readonly to: RoomLifecycleState;
}

const EDGES: Edge[] = [
  { name: 'snapshot and log applied', from: 'loading', event: { type: 'loaded' }, to: 'ready' },
  { name: 'snapshot unreadable', from: 'loading', event: { type: 'load-failed' }, to: 'load-failed' },
  {
    name: 'update applied, stored, broadcast',
    from: 'ready',
    event: { type: 'update-applied' },
    to: 'ready',
  },
  {
    name: 'log exceeds a threshold',
    from: 'ready',
    event: { type: 'compaction-started' },
    to: 'compacting',
  },
  {
    name: 'snapshot replaced log truncated',
    from: 'compacting',
    event: { type: 'compaction-finished' },
    to: 'ready',
  },
  {
    name: 'compaction error rolled back, log intact',
    from: 'compacting',
    event: { type: 'compaction-failed' },
    to: 'ready',
  },
  { name: 'insert throws', from: 'ready', event: { type: 'storage-failed' }, to: 'storage-failed' },
  {
    name: 'next connection reloads after a storage failure',
    from: 'storage-failed',
    event: { type: 'reload' },
    to: 'loading',
  },
  {
    name: 'no events; sockets may stay open',
    from: 'ready',
    event: { type: 'hibernated' },
    to: 'hibernated',
  },
  {
    name: 'a message or new connection wakes the object',
    from: 'hibernated',
    event: { type: 'woken' },
    to: 'loading',
  },
  {
    name: 'a new connection after the retry interval',
    from: 'load-failed',
    event: { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
    to: 'loading',
  },
  {
    name: 'a connection before the retry interval stays refused',
    from: 'load-failed',
    event: { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 },
    to: 'load-failed',
  },
];

describe('the room lifecycle (TC-27)', () => {
  for (const edge of EDGES) {
    test(`TC-27: ${edge.from} -> ${edge.to} on "${edge.name}"`, () => {
      expect(nextRoomState(edge.from, edge.event)).toBe(edge.to);
    });
  }

  test('TC-27: an event that cannot happen in a state leaves it unchanged', () => {
    const allowed = new Set(
      EDGES.map((edge) => `${edge.from}|${JSON.stringify(edge.event)}`),
    );
    const checked: string[] = [];
    for (const state of STATES) {
      for (const event of EVENTS) {
        const key = `${state}|${JSON.stringify(event)}`;
        if (allowed.has(key)) continue;
        checked.push(key);
        expect(nextRoomState(state, event), `${state} + ${JSON.stringify(event)}`).toBe(state);
      }
    }
    // the negative half actually covers the bulk of the state/event grid
    expect(checked.length).toBeGreaterThan(EVENTS.length * STATES.length * 0.5);
  });

  test('a room that failed to load can only be rescued by a later retry', () => {
    // nothing else - not a message, not a wake-up, not a reload - puts a refused board back
    expect(nextRoomState('load-failed', { type: 'woken' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'reload' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'loaded' })).toBe('load-failed');
    // and the refusal is retried, forever if it has to: the board is not presented as empty
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: 0 })).toBe('load-failed');
    expect(
      nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS * 3 }),
    ).toBe('loading');
  });

  test('the retry interval boundary is exact (LOAD_RETRY_MIN_INTERVAL_MS)', () => {
    expect(loadRetryAllowed(LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(loadRetryAllowed(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
    expect(loadRetryAllowed(0)).toBe(false);
  });

  test('a storage failure and a load failure are different states with different ways out', () => {
    // storage failure: the next connection reloads the board, which is usually fine
    expect(nextRoomState('storage-failed', { type: 'reload' })).toBe('loading');
    // load failure: only the rate-limited retry
    expect(
      nextRoomState('load-failed', { type: 'reload' }),
    ).toBe('load-failed');
    // and a refused board never becomes ready by itself
    expect(nextRoomState('load-failed', { type: 'update-applied' })).toBe('load-failed');
  });
});
