import * as Y from 'yjs';

export const PEER_ORIGIN = 'peer-origin';
export const LOAD_ORIGIN = 'load-origin';

/**
 * Create a second Y.Doc wired to `local` like a connected provider peer:
 * an initial full sync (as a provider's initial sync does — incremental
 * updates cannot reference parent structs the receiver has never seen),
 * then bidirectional incremental updates with PEER_ORIGIN.
 */
export function makePeer(local: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), PEER_ORIGIN);
  local.on('update', (update: Uint8Array) => {
    Y.applyUpdate(peer, update, PEER_ORIGIN);
  });
  peer.on('update', (update: Uint8Array) => {
    Y.applyUpdate(local, update, PEER_ORIGIN);
  });
  return peer;
}

/**
 * Apply a full state update to `doc` with LOAD_ORIGIN (the story 4 load path).
 */
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
