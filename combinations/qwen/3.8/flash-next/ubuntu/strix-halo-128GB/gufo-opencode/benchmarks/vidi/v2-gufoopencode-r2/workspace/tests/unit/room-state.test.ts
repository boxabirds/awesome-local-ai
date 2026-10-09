// TC-27: every edge of the room state diagram plus every invalid event
// (invalid events leave the state unchanged).

import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

const STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'load-failed',
  'storage-failed',
];

const EVENTS: RoomEvent[] = [
  'load-ok',
  'load-failed',
  'update',
  'compact-start',
  'compact-ok',
  'compact-failed',
  'append-failed',
  'next-connection',
  'hibernate',
  'wake',
  'retry-allowed',
  'retry-denied',
];

const EDGES: [RoomState, RoomEvent, RoomState][] = [
  ['loading', 'load-ok', 'ready'], // snapshot and log applied
  ['loading', 'load-ok', 'ready'], // damaged log rows quarantined, rest applied
  ['loading', 'load-failed', 'load-failed'], // snapshot unreadable
  ['loading', 'load-failed', 'load-failed'], // SQL error
  ['ready', 'update', 'ready'], // applied, stored, broadcast
  ['ready', 'compact-start', 'compacting'], // log exceeds threshold
  ['compacting', 'compact-ok', 'ready'], // snapshot replaced, log truncated
  ['compacting', 'compact-failed', 'ready'], // error rolled back, log intact
  ['ready', 'append-failed', 'storage-failed'], // insert throws
  ['storage-failed', 'next-connection', 'loading'], // sockets closed, reloads
  ['ready', 'hibernate', 'hibernated'], // no events, sockets may stay open
  ['hibernated', 'wake', 'loading'], // message or new connection wakes object
  ['load-failed', 'retry-allowed', 'loading'], // connection after LOAD_RETRY_MIN_INTERVAL_MS
  ['load-failed', 'retry-denied', 'load-failed'], // connection before interval, close 4500
];

describe('nextRoomState', () => {
  for (const [from, event, to] of EDGES) {
    it(`${from} -- ${event} --> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('leaves the state unchanged for every invalid event', () => {
    const valid = new Set(EDGES.map(([from, event]) => `${from}|${event}`));
    for (const state of STATES) {
      for (const event of EVENTS) {
        if (valid.has(`${state}|${event}`)) continue;
        expect(nextRoomState(state, event)).toBe(state);
      }
    }
  });

  it('is total: no call returns undefined', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        expect(nextRoomState(state, event)).toBeTypeOf('string');
      }
    }
  });
});
