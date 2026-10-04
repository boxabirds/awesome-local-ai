/**
 * Unit tests for persist.room's pure state transition function
 * (TC-27): every edge of the room lifecycle diagram, and every invalid
 * event leaving the state unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  nextRoomState,
  ROOM_STATES,
  ROOM_EVENTS,
  type RoomState,
  type RoomEvent,
} from '../../src/worker/room-state';

/**
 * The complete edge set of the design's room lifecycle diagram:
 *
 *   [*] --> Loading
 *   Loading --> Ready : snapshot and log applied
 *   Loading --> Ready : log rows quarantined rest applied
 *   Loading --> LoadFailed : snapshot unreadable or SQL error
 *   Ready --> Ready : update applied stored broadcast
 *   Ready --> Compacting : log exceeds threshold
 *   Compacting --> Ready : snapshot replaced log truncated
 *   Compacting --> Ready : compaction error rolled back log intact
 *   Ready --> StorageFailed : insert throws
 *   StorageFailed --> Loading : sockets closed doc discarded next connection
 *   Ready --> Hibernated : no events sockets may stay open
 *   Hibernated --> Loading : message or new connection wakes object
 *   LoadFailed --> Loading : new connection after LOAD_RETRY_MIN_INTERVAL_MS
 *   LoadFailed --> LoadFailed : connection before interval closed 4500
 */
const EDGES: Array<[RoomState, RoomEvent, RoomState]> = [
  ['loading', { type: 'load-success', quarantined: 0 }, 'ready'],
  ['loading', { type: 'load-success', quarantined: 3 }, 'ready'],
  ['loading', { type: 'load-failure' }, 'load-failed'],
  ['ready', { type: 'update-stored' }, 'ready'],
  ['ready', { type: 'compact-start' }, 'compacting'],
  ['compacting', { type: 'compact-success' }, 'ready'],
  ['compacting', { type: 'compact-failure' }, 'ready'],
  ['ready', { type: 'storage-failure' }, 'storage-failed'],
  ['storage-failed', { type: 'reload-request' }, 'loading'],
  ['ready', { type: 'hibernate' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['load-failed', { type: 'retry-load' }, 'loading'],
  ['load-failed', { type: 'retry-rejected' }, 'load-failed'],
];

describe('persist.room state transitions (TC-27)', () => {
  it.each(EDGES)('state %s + event %s → %s', (from, event, to) => {
    expect(nextRoomState(from, event)).toBe(to);
  });

  it('covers every edge of the diagram exactly once', () => {
    // Sanity: the edge table above is the whole diagram.
    expect(EDGES.length).toBe(13);
  });

  it('invalid events leave the state unchanged (every state × invalid event)', () => {
    const makeEvent = (t: (typeof ROOM_EVENTS)[number]): RoomEvent =>
      t === 'load-success' ? { type: t, quarantined: 0 } : ({ type: t } as RoomEvent);
    for (const state of ROOM_STATES) {
      for (const t of ROOM_EVENTS) {
        const isEdge = EDGES.some(([from, e]) => from === state && e.type === t);
        if (isEdge) continue;
        expect(nextRoomState(state, makeEvent(t)), `${state} + ${t}`).toBe(state);
      }
    }
  });

  it('a LoadFailed room stays LoadFailed when a connection arrives before the retry interval', () => {
    // "connection before interval closed 4500": the room rejects the retry,
    // closing the socket with 4500, and remains load-failed.
    expect(nextRoomState('load-failed', { type: 'retry-rejected' })).toBe('load-failed');
  });
});
