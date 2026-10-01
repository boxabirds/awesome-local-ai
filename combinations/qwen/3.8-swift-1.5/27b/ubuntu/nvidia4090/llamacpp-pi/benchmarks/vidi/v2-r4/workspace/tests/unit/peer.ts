import * as Y from 'yjs';

/**
 * A non-local origin standing in for the y-websocket provider. Remote updates
 * applied to the local doc carry this origin, so they are never tracked by the
 * local UndoManager (which only tracks LOCAL_ORIGIN).
 */
export const PEER_ORIGIN: unique symbol = Symbol('PEER_ORIGIN');

/**
 * A non-local origin standing in for the story 4 load path: when a board is
 * loaded from storage the initial state is applied by the sync layer, not by
 * the local user.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

/**
 * A pair of real Y.Docs exchanging updates deterministically (no server).
 * Changes made on the peer doc arrive on the local doc with PEER_ORIGIN,
 * mirroring how the y-websocket provider applies remote updates.
 */
export function createPeerPair(): { local: Y.Doc; peer: Y.Doc } {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  local.on('update', (update: Uint8Array) => {
    Y.applyUpdate(peer, update, PEER_ORIGIN);
  });
  peer.on('update', (update: Uint8Array) => {
    Y.applyUpdate(local, update, PEER_ORIGIN);
  });
  return { local, peer };
}

/**
 * Applies a state update to the local doc with the story 4 LOAD origin
 * (simulates the board being loaded from storage by the sync layer).
 */
export function applyLoadUpdate(local: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(local, update, LOAD_ORIGIN);
}
