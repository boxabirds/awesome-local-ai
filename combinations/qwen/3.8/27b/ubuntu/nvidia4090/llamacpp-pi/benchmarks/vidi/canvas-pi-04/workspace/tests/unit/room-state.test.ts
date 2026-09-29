// Story 4, task 1: the room lifecycle state machine (TC-27).
//
// A pure transition-table test for nextRoomState: every state x every event
// against the design diagram, including LoadFailed->Loading (after the retry
// interval), LoadFailed->LoadFailed (before the interval, closed with 4500),
// Compacting->Ready (rollback) and Hibernated->Loading (wake).

import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  nextRoomState,
  type RoomEvent,
  type RoomLifecycle,
} from '../../src/worker/room-state';

const STATES: RoomLifecycle[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

const EVENTS: Record<string, RoomEvent> = {
  'load-success': { type: 'load-success', quarantined: 0 },
  'load-success (quarantined rest applied)': { type: 'load-success', quarantined: 3 },
  'load-failed (snapshot unreadable)': { type: 'load-failed', reason: 'snapshot-unreadable' },
  'load-failed (SQL error)': { type: 'load-failed', reason: 'sql-error' },
  'update-applied': { type: 'update-applied' },
  'log-exceeds-threshold': { type: 'log-exceeds-threshold' },
  'compaction-committed': { type: 'compaction-committed' },
  'compaction-rolled-back': { type: 'compaction-rolled-back' },
  'insert-throws': { type: 'insert-throws' },
  'next-connection': { type: 'next-connection' },
  wake: { type: 'wake' },
  hibernate: { type: 'hibernate' },
  'connection-attempt (before interval)': {
    type: 'connection-attempt',
    elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
  },
  'connection-attempt (at interval)': {
    type: 'connection-attempt',
    elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS,
  },
  'connection-attempt (after interval)': {
    type: 'connection-attempt',
    elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1,
  },
};

/** state x event -> expected next state (the complete design matrix). */
const MATRIX: Record<RoomLifecycle, Record<string, RoomLifecycle>> = {
  loading: {
    'load-success': 'ready',
    'load-success (quarantined rest applied)': 'ready',
    // Snapshot unreadable OR SQL error: both end in LoadFailed.
    'load-failed (snapshot unreadable)': 'load-failed',
    'load-failed (SQL error)': 'load-failed',
    // Loads block events; nothing else is observable while loading.
    'update-applied': 'loading',
    'log-exceeds-threshold': 'loading',
    'compaction-committed': 'loading',
    'compaction-rolled-back': 'loading',
    'insert-throws': 'loading',
    'next-connection': 'loading',
    wake: 'loading',
    hibernate: 'loading',
    'connection-attempt (before interval)': 'loading',
    'connection-attempt (at interval)': 'loading',
    'connection-attempt (after interval)': 'loading',
  },
  ready: {
    'update-applied': 'ready',
    'log-exceeds-threshold': 'compacting',
    'insert-throws': 'storage-failed',
    hibernate: 'hibernated',
    // No other edge from Ready in the design diagram.
    'load-success': 'ready',
    'load-success (quarantined rest applied)': 'ready',
    'load-failed (snapshot unreadable)': 'ready',
    'load-failed (SQL error)': 'ready',
    'compaction-committed': 'ready',
    'compaction-rolled-back': 'ready',
    'next-connection': 'ready',
    wake: 'ready',
    'connection-attempt (before interval)': 'ready',
    'connection-attempt (at interval)': 'ready',
    'connection-attempt (after interval)': 'ready',
  },
  compacting: {
    'compaction-committed': 'ready',
    'compaction-rolled-back': 'ready',
    // Compaction is synchronous; no other event can interleave.
    'load-success': 'compacting',
    'load-success (quarantined rest applied)': 'compacting',
    'load-failed (snapshot unreadable)': 'compacting',
    'load-failed (SQL error)': 'compacting',
    'update-applied': 'compacting',
    'log-exceeds-threshold': 'compacting',
    'insert-throws': 'compacting',
    'next-connection': 'compacting',
    wake: 'compacting',
    hibernate: 'compacting',
    'connection-attempt (before interval)': 'compacting',
    'connection-attempt (at interval)': 'compacting',
    'connection-attempt (after interval)': 'compacting',
  },
  'storage-failed': {
    // Sockets closed, doc discarded: the next connection rebuilds.
    'next-connection': 'loading',
    // No other edge from StorageFailed in the design diagram.
    'load-success': 'storage-failed',
    'load-success (quarantined rest applied)': 'storage-failed',
    'load-failed (snapshot unreadable)': 'storage-failed',
    'load-failed (SQL error)': 'storage-failed',
    'update-applied': 'storage-failed',
    'log-exceeds-threshold': 'storage-failed',
    'compaction-committed': 'storage-failed',
    'compaction-rolled-back': 'storage-failed',
    'insert-throws': 'storage-failed',
    wake: 'storage-failed',
    hibernate: 'storage-failed',
    'connection-attempt (before interval)': 'storage-failed',
    'connection-attempt (at interval)': 'storage-failed',
    'connection-attempt (after interval)': 'storage-failed',
  },
  hibernated: {
    // A message or a new connection wakes the object: reconstruct + load.
    wake: 'loading',
    'next-connection': 'loading',
    // No other edge from Hibernated in the design diagram.
    'load-success': 'hibernated',
    'load-success (quarantined rest applied)': 'hibernated',
    'load-failed (snapshot unreadable)': 'hibernated',
    'load-failed (SQL error)': 'hibernated',
    'update-applied': 'hibernated',
    'log-exceeds-threshold': 'hibernated',
    'compaction-committed': 'hibernated',
    'compaction-rolled-back': 'hibernated',
    'insert-throws': 'hibernated',
    hibernate: 'hibernated',
    'connection-attempt (before interval)': 'hibernated',
    'connection-attempt (at interval)': 'hibernated',
    'connection-attempt (after interval)': 'hibernated',
  },
  'load-failed': {
    // Before the retry interval the connection is closed with 4500 and the
    // state is unchanged; at/after the interval a retry load starts.
    'connection-attempt (before interval)': 'load-failed',
    'connection-attempt (at interval)': 'loading',
    'connection-attempt (after interval)': 'loading',
    // No other edge from LoadFailed in the design diagram.
    'load-success': 'load-failed',
    'load-success (quarantined rest applied)': 'load-failed',
    'load-failed (snapshot unreadable)': 'load-failed',
    'load-failed (SQL error)': 'load-failed',
    'update-applied': 'load-failed',
    'log-exceeds-threshold': 'load-failed',
    'compaction-committed': 'load-failed',
    'compaction-rolled-back': 'load-failed',
    'insert-throws': 'load-failed',
    'next-connection': 'load-failed',
    wake: 'load-failed',
    hibernate: 'load-failed',
  },
};

describe('nextRoomState (TC-27)', () => {
  for (const state of STATES) {
    for (const [eventName, event] of Object.entries(EVENTS)) {
      it(`${state} + ${eventName} -> ${MATRIX[state][eventName]}`, () => {
        expect(nextRoomState(state, event)).toBe(MATRIX[state][eventName]);
      });
    }
  }

  it('the retry boundary uses the configured LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(
      nextRoomState('load-failed', { type: 'connection-attempt', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }),
    ).toBe('load-failed');
    expect(
      nextRoomState('load-failed', { type: 'connection-attempt', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS }),
    ).toBe('loading');
    expect(
      nextRoomState('load-failed', { type: 'connection-attempt', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 10_000 }),
    ).toBe('loading');
  });
});
