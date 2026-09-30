// The room lifecycle as pure transitions (TC-27). Every edge of the design's room
// state diagram gets a case, and for every state the events the diagram does not
// allow must leave the state exactly as it was - a room that drifts into `ready`
// because of an unrelated event would start serving an unloaded board.
//
// The one edge with a number in it is the load-failure retry: a new connection
// reloads only once LOAD_RETRY_MIN_INTERVAL_MS has passed, and before that the
// room stays broken (the socket is closed with CLOSE_BOARD_LOAD_FAILED). Both
// sides of that interval are asserted here; the close code itself is an
// integration concern (TC-15, TC-16).

import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  mayRetryLoad,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

const STATES: readonly RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'load-failed',
  'storage-failed',
];

const EVENTS: readonly RoomEvent[] = [
  { type: 'loaded' },
  { type: 'load-failed' },
  { type: 'update-stored' },
  { type: 'log-exceeds-threshold' },
  { type: 'compacted' },
  { type: 'compaction-failed' },
  { type: 'storage-error' },
  { type: 'client-connected' },
  { type: 'hibernated' },
  { type: 'woken' },
  { type: 'load-retry', elapsedMs: 0 },
  { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
];

const key = (event: RoomEvent): string =>
  event.type === 'load-retry' ? `load-retry@${event.elapsedMs}` : event.type;

/** Every event name that has an edge out of `state` (the diagram's exits). */
const EDGES: Record<RoomState, Partial<Record<string, RoomState>>> = {
  loading: { loaded: 'ready', 'load-failed': 'load-failed' },
  ready: {
    'update-stored': 'ready',
    'log-exceeds-threshold': 'compacting',
    'storage-error': 'storage-failed',
    hibernated: 'hibernated',
  },
  compacting: { compacted: 'ready', 'compaction-failed': 'ready' },
  hibernated: { woken: 'loading' },
  'load-failed': {}, // the retry edge is timed, so it is asserted separately
  'storage-failed': { 'client-connected': 'loading' },
};

describe('room lifecycle transitions (TC-27)', () => {
  for (const state of STATES) {
    for (const [event, expected] of Object.entries(EDGES[state])) {
      it(`${state} + ${event} -> ${expected}`, () => {
        expect(nextRoomState(state, { type: event } as RoomEvent)).toBe(expected);
      });
    }
  }

  // The two load edges the diagram draws separately both land in `ready`: the
  // plain one ("snapshot and log applied") and the one where damaged log rows
  // were quarantined and the rest applied.
  it('loading -> ready with quarantined rows is the same edge', () => {
    expect(nextRoomState('loading', { type: 'loaded' })).toBe('ready');
  });

  it('load-failed -> loading only once LOAD_RETRY_MIN_INTERVAL_MS has passed', () => {
    expect(nextRoomState('load-failed', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })).toBe(
      'loading',
    );
    expect(nextRoomState('load-failed', { type: 'load-retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 60_000 })).toBe(
      'loading',
    );
  });

  it('mayRetryLoad agrees with the retry edge at the same boundary', () => {
    expect(mayRetryLoad(LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(mayRetryLoad(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
  });

  // Negative: every event without an edge out of a state changes nothing.
  it('events the diagram does not allow leave the state unchanged', () => {
    const unexpected: string[] = [];
    for (const state of STATES) {
      const allowed = new Set(Object.keys(EDGES[state]));
      if (state === 'load-failed') allowed.add('load-retry');
      for (const event of EVENTS) {
        if (allowed.has(event.type)) continue;
        const next = nextRoomState(state, event);
        if (next !== state) {
          unexpected.push(`${state} + ${key(event)} -> ${next}`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  it('an unknown event type leaves every state unchanged', () => {
    const noise = { type: 'awareness-pinged' } as unknown as RoomEvent;
    for (const state of STATES) expect(nextRoomState(state, noise)).toBe(state);
  });
});
