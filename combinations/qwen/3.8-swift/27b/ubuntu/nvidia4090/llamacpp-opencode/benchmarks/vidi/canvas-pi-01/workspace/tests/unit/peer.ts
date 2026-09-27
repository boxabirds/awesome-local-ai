// Simulated remote peer for undo unit tests (spec: Mock vs real boundaries).
//
// A second REAL Y.Doc that exchanges updates with the local doc. The peer's
// mutations reach the local doc through Y.applyUpdate with a NON-local
// origin, exactly like y-websocket provider updates do — so the undo
// controller's trackedOrigins filtering sees them as remote.

import * as Y from 'yjs';

/** Origin a simulated remote peer applies its updates with. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6.peer');

/** Origin for story 4 load-style updates (never tracked by the controller). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export interface Peer {
  /** The peer's own document (mutate it to make remote changes). */
  doc: Y.Doc;
}

/**
 * Attach a simulated peer to `localDoc`. Updates flow both ways; every
 * applied update carries a non-LOCAL_ORIGIN origin on the receiving side.
 */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  localDoc.on('update', (update) => {
    Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
  });
  peerDoc.on('update', (update) => {
    Y.applyUpdate(localDoc, update, PEER_ORIGIN);
  });
  return { doc: peerDoc };
}

/**
 * Build `apply`'s changes in a scratch doc and apply them to `localDoc`
 * with the story 4 LOAD origin (initial-load updates are never undoable).
 */
export function applyLoad(localDoc: Y.Doc, apply: (doc: Y.Doc) => void): void {
  const scratch = new Y.Doc();
  apply(scratch);
  Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(scratch), LOAD_ORIGIN);
}
