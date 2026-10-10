/**
 * TC-27 (persist.room) — the room's lifecycle as a transition table.
 *
 * The room itself is a Durable Object, and a lifecycle bug there would look
 * like data loss: serving before the board has been read, or treating a board
 * that failed to load as an empty one. So the transitions are tested here,
 * where a mistake costs a unit test and not a board.
 *
 * Every edge of the design's diagram is asserted, and so is a sample of events
 * that the diagram does *not* draw: a room that changes phase on those is a
 * room that can be pushed somewhere unintended.
 */
import { describe, expect, it } from 'vitest';

import {
  INITIAL_ROOM_PHASE,
  nextRoomState,
  roomGate,
  type RoomEvent,
  type RoomPhase,
} from '../../src/worker/room-state';

/** One edge of the diagram: from, event, to. */
interface Edge {
  readonly title: string;
  readonly from: RoomPhase;
  readonly event: RoomEvent;
  readonly to: RoomPhase;
}

const EDGES: Edge[] = [
  {
    title: 'loading to ready: snapshot and log applied',
    from: 'loading',
    event: { type: 'loaded' },
    to: 'ready',
  },
  {
    title: 'loading to ready: unreadable rows quarantined, the rest applied',
    from: 'loading',
    event: { type: 'loaded-damaged' },
    to: 'ready',
  },
  {
    title: 'loading to load-failed: storage threw or the snapshot could not be read',
    from: 'loading',
    event: { type: 'load-failed' },
    to: 'load-failed',
  },
  {
    title: 'load-failed to load-failed: retrying too soon is refused without a load',
    from: 'load-failed',
    event: { type: 'connection', retryAllowed: false },
    to: 'load-failed',
  },
  {
    title: 'load-failed to loading: a connection after the retry interval loads again',
    from: 'load-failed',
    event: { type: 'connection', retryAllowed: true },
    to: 'loading',
  },
  {
    title: 'ready to ready: a change is applied, stored and broadcast',
    from: 'ready',
    event: { type: 'update' },
    to: 'ready',
  },
  {
    title: 'ready to compacting: the log grew past a threshold',
    from: 'ready',
    event: { type: 'compacting' },
    to: 'compacting',
  },
  {
    title: 'compacting to ready: the folded log is left alone',
    from: 'compacting',
    event: { type: 'compacted' },
    to: 'ready',
  },
  {
    title: 'compacting to ready: compaction failed, the log is intact and is retried',
    from: 'compacting',
    event: { type: 'compaction-failed' },
    to: 'ready',
  },
  {
    title: 'ready to storage-failed: writing a change down failed',
    from: 'ready',
    event: { type: 'storage-failed' },
    to: 'storage-failed',
  },
  {
    title: 'storage-failed to loading: sockets closed, doc discarded, next connection',
    from: 'storage-failed',
    event: { type: 'reload' },
    to: 'loading',
  },
  {
    title: 'ready to hibernated: the last socket left',
    from: 'ready',
    event: { type: 'idle' },
    to: 'hibernated',
  },
  {
    title: 'hibernated to loading: a message arrives and the board is read again',
    from: 'hibernated',
    event: { type: 'woken' },
    to: 'loading',
  },
];

describe('nextRoomState (TC-27)', () => {
  for (const edge of EDGES) {
    it(`draws ${edge.title}`, () => {
      expect(nextRoomState(edge.from, edge.event)).toBe(edge.to);
    });
  }

  /** Phases an event is not drawn for, with the phase it must not change. */
  const NOT_DRAWN: { readonly title: string; readonly from: RoomPhase; readonly event: RoomEvent }[] =
    [
      { title: 'a change while still loading', from: 'loading', event: { type: 'update' } },
      {
        title: 'a change while the board is unreadable',
        from: 'load-failed',
        event: { type: 'update' },
      },
      {
        title: 'compacting a board that failed to load',
        from: 'load-failed',
        event: { type: 'compacting' },
      },
      { title: 'compacting while compacting', from: 'compacting', event: { type: 'compacting' } },
      { title: 'a second load result', from: 'ready', event: { type: 'loaded' } },
      {
        title: 'a storage failure while hibernated',
        from: 'hibernated',
        event: { type: 'storage-failed' },
      },
      {
        title: 'going idle while the board is unreadable',
        from: 'load-failed',
        event: { type: 'idle' },
      },
      {
        title: 'a reload a ready room was never asked for',
        from: 'ready',
        event: { type: 'reload' },
      },
      {
        title: 'waking a room that is not hibernated',
        from: 'loading',
        event: { type: 'woken' },
      },
      {
        title: 'a connection to a ready room is not a phase change',
        from: 'ready',
        event: { type: 'connection', retryAllowed: true },
      },
      {
        title: 'a connection cannot rescue a storage failure',
        from: 'storage-failed',
        event: { type: 'connection', retryAllowed: true },
      },
    ];

  for (const { title, from, event } of NOT_DRAWN) {
    it(`leaves the phase alone for ${title}`, () => {
      expect(nextRoomState(from, event)).toBe(from);
    });
  }

  it('starts by loading, so nothing is served before the board has been read', () => {
    expect(INITIAL_ROOM_PHASE).toBe('loading');
  });
});

describe('roomGate (TC-27)', () => {
  it('serves a ready room, including one that is compacting', () => {
    expect(roomGate('ready')).toBe('ready');
    expect(roomGate('compacting')).toBe('ready');
  });

  it('refuses an unreadable board as an unreadable board', () => {
    expect(roomGate('load-failed')).toBe('load-failed');
    expect(roomGate('storage-failed')).toBe('storage-failed');
  });

  it('serves nothing while the board is being read', () => {
    expect(roomGate('loading')).toBe('loading');
    expect(roomGate('hibernated')).toBe('loading');
  });
});
