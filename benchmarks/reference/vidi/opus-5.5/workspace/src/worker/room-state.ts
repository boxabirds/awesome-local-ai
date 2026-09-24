import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The board room's lifecycle as a pure transition function (design: "Room lifecycle").
 * BoardRoom keeps one of these and moves it with `nextRoomState`; Hibernated is not
 * observable from inside the object (the runtime evicts it), but it is modelled so every
 * edge of the diagram is covered by tests.
 */
export type RoomLifecycle =
  | { kind: 'loading' }
  | { kind: 'ready'; quarantined: number }
  | { kind: 'compacting' }
  | { kind: 'storage-failed' }
  | { kind: 'hibernated' }
  | { kind: 'load-failed'; failedAt: number };

export type RoomEvent =
  | { type: 'loaded'; quarantined: number }
  | { type: 'load-failed'; at: number }
  | { type: 'update-stored' }
  | { type: 'compaction-started' }
  | { type: 'compaction-committed' }
  | { type: 'compaction-rolled-back' }
  | { type: 'append-failed' }
  | { type: 'idle' }
  | { type: 'wake' }
  | { type: 'connection'; at: number };


const READY: RoomLifecycle = { kind: 'ready', quarantined: 0 };

/**
 * The state after `event`. Events that are not an edge of the diagram for the current state
 * return the same object (unchanged). A LoadFailed room reached by a connection before
 * LOAD_RETRY_MIN_INTERVAL_MS has passed stays LoadFailed (the caller closes it with 4500).
 */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state.kind) {
    case 'loading':
      if (event.type === 'loaded') return { kind: 'ready', quarantined: event.quarantined };
      if (event.type === 'load-failed') return { kind: 'load-failed', failedAt: event.at };
      return state;
    case 'ready':
      if (event.type === 'update-stored') return state;
      if (event.type === 'compaction-started') return { kind: 'compacting' };
      if (event.type === 'append-failed') return { kind: 'storage-failed' };
      if (event.type === 'idle') return { kind: 'hibernated' };
      return state;
    case 'compacting':
      if (event.type === 'compaction-committed' || event.type === 'compaction-rolled-back') return READY;
      return state;
    case 'storage-failed':
      return event.type === 'connection' ? { kind: 'loading' } : state;
    case 'hibernated':
      return event.type === 'wake' ? { kind: 'loading' } : state;
    case 'load-failed':
      if (event.type === 'connection' && event.at - state.failedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        return { kind: 'loading' };
      }
      return state;
  }
}
