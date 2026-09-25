/**
 * BoardRoom lifecycle as a pure transition function (anchor: persist.room):
 *
 *   Loading ──loaded──▶ Ready ──compact-start──▶ Compacting ──committed / rolled-back──▶ Ready
 *      │                  │ ──append-failed──▶ StorageFailed ──connect──▶ Loading
 *      │                  │ ──idle──▶ Hibernated ──wake──▶ Loading
 *      └──load-error──▶ LoadFailed ──connect after LOAD_RETRY_MIN_INTERVAL_MS──▶ Loading
 *                                  ──connect sooner──▶ LoadFailed (close 4500)
 *
 * Events that do not apply to a state leave it unchanged.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol';

export type RoomLifecycle =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'compacting' }
  | { kind: 'storage-failed' }
  | { kind: 'hibernated' }
  | { kind: 'load-failed'; failedAt: number };

export type RoomEvent =
  | { type: 'loaded'; quarantined: number }
  | { type: 'load-error'; at: number }
  | { type: 'compact-start' }
  | { type: 'compact-committed' }
  | { type: 'compact-rolled-back' }
  | { type: 'append-failed' }
  | { type: 'idle' }
  | { type: 'wake' }
  | { type: 'connect'; at: number };

export interface RoomTransition {
  state: RoomLifecycle;
  /** Close code for the connecting socket, when the room refuses it. */
  close?: number;
}

export const INITIAL_ROOM_STATE: RoomLifecycle = { kind: 'loading' };

export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomTransition {
  const same = { state };
  switch (state.kind) {
    case 'loading':
      if (event.type === 'loaded') return { state: { kind: 'ready' } };
      if (event.type === 'load-error') return { state: { kind: 'load-failed', failedAt: event.at } };
      return same;
    case 'ready':
      if (event.type === 'compact-start') return { state: { kind: 'compacting' } };
      if (event.type === 'append-failed') return { state: { kind: 'storage-failed' } };
      if (event.type === 'idle') return { state: { kind: 'hibernated' } };
      return same;
    case 'compacting':
      if (event.type === 'compact-committed' || event.type === 'compact-rolled-back') return { state: { kind: 'ready' } };
      return same;
    case 'storage-failed':
      if (event.type === 'connect') return { state: { kind: 'loading' } };
      return same;
    case 'hibernated':
      if (event.type === 'wake' || event.type === 'connect') return { state: { kind: 'loading' } };
      return same;
    case 'load-failed':
      if (event.type !== 'connect') return same;
      if (event.at - state.failedAt >= LOAD_RETRY_MIN_INTERVAL_MS) return { state: { kind: 'loading' } };
      return { state, close: CLOSE_BOARD_LOAD_FAILED };
  }
}
