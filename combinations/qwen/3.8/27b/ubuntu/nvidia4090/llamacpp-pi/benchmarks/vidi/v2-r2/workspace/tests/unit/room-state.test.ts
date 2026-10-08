/**
 * Story 4, durable room state machine (design TC-27).
 *
 * Exhaustive over every (state, event) combination: the documented edges
 * transition exactly as the design diagram says, and every undocumented
 * combination returns the state unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_ROOM_STATE,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/shared/room-state';

const STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'load-failed',
  'hibernated',
];

const EVENTS: RoomEvent[] = [
  { type: 'load-success', quarantined: 0 },
  { type: 'load-failure', reason: 'snapshot-unreadable' },
  { type: 'load-failure', reason: 'sql-error' },
  { type: 'update' },
  { type: 'compaction-start' },
  { type: 'compaction-success' },
  { type: 'compaction-rollback' },
  { type: 'storage-failure' },
  { type: 'hibernate' },
  { type: 'wake' },
  { type: 'load-retry-due' },
  { type: 'load-retry-early' },
];

/**
 * Every documented edge of the design diagram, keyed by (state, event type).
 * Both load-failure reasons and quarantined counts 0 > 0 map to the same
 * target, so the table records the edge once per event type.
 */
const EDGES: Partial<Record<RoomState, Partial<Record<RoomEvent['type'], RoomState>>>> = {
  loading: {
    'load-success': 'ready',
    'load-failure': 'load-failed',
  },
  ready: {
    'update': 'ready',
    'compaction-start': 'compacting',
    'storage-failure': 'storage-failed',
    'hibernate': 'hibernated',
  },
  compacting: {
    'compaction-success': 'ready',
    'compaction-rollback': 'ready',
  },
  'storage-failed': {
    'wake': 'loading',
  },
  hibernated: {
    'wake': 'loading',
  },
  'load-failed': {
    'load-retry-due': 'loading',
    'load-retry-early': 'load-failed',
  },
};

describe('TC-27 durable room state machine', () => {
  it('a new room starts in loading', () => {
    expect(INITIAL_ROOM_STATE).toBe('loading');
  });

  it('transitions on every documented edge', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const expected = EDGES[state]?.[event.type];
        if (expected === undefined) {
          continue;
        }
        expect(
          nextRoomState(state, event),
          `edge ${state} + ${event.type}${
            'reason' in event ? ` (${event.reason})` : ''
          }${'quarantined' in event ? ` (quarantined=${event.quarantined})` : ''}`,
        ).toBe(expected);
      }
    }
  });

  it('returns the state unchanged for every undocumented (state, event) combination', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        if (EDGES[state]?.[event.type] !== undefined) {
          continue;
        }
        expect(
          nextRoomState(state, event),
          `invalid ${state} + ${event.type}${
            'reason' in event ? ` (${event.reason})` : ''
          }`,
        ).toBe(state);
      }
    }
  });

  it('a load with quarantined rows still succeeds (Ready)', () => {
    expect(nextRoomState('loading', { type: 'load-success', quarantined: 7 })).toBe('ready');
  });

  it('a storage write failure from any other state is invalid (unchanged)', () => {
    expect(nextRoomState('loading', { type: 'storage-failure' })).toBe('loading');
    expect(nextRoomState('compacting', { type: 'storage-failure' })).toBe('compacting');
    expect(nextRoomState('load-failed', { type: 'storage-failure' })).toBe('load-failed');
    expect(nextRoomState('hibernated', { type: 'storage-failure' })).toBe('hibernated');
  });
});
