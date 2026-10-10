import type { ConnectionState } from '../sync/connectBoard';

/**
 * Whether this client may write to the board right now: false for exactly one
 * connection state, `load_failed`, where the room reached the board's storage and
 * could not read the board out of it. What is on screen in that state is not the
 * board, it is nothing, and a person who types into nothing has written a board
 * nobody asked for (persist.load_failure). Every other state — even the room
 * failing to *save* this client's changes — is a board worth working on, and the
 * changes go out again with the next handshake (persist.save_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}
