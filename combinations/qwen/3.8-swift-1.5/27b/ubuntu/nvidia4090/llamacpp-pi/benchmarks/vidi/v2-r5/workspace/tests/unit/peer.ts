// tests/unit/peer.ts
// A second real Y.Doc exchanging state with a local doc, for deterministic
// remote changes without a server (design: "Mock vs real boundaries").
//
// Sync uses full-state encoding (Y.encodeStateAsUpdate) so it is robust
// regardless of incremental-update integration order. Origins:
//   - Peer changes are made on the peer's doc with the board-model functions
//     (LOCAL_ORIGIN on the peer) and arrive on the local doc with PEER_ORIGIN —
//     mirroring how the y-websocket provider applies remote updates with a
//     non-local origin.
//   - `load` applies changes to the local doc with LOAD_ORIGIN, simulating a
//     story 4 board load (server-sent state, non-local origin).
// ECHO_ORIGIN marks our own sync applications so they are never re-applied
// back (no echo loop).

import * as Y from 'yjs';

export const PEER_ORIGIN: unique symbol = Symbol('PEER_ORIGIN');
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

const ECHO_ORIGIN: unique symbol = Symbol('PEER_ECHO');

export interface Peer {
  /** The peer's doc. Mutate it with the board-model functions. */
  doc: Y.Doc;
  /** Apply changes to the local doc with LOAD_ORIGIN (story 4 load). */
  load: (fn: () => void) => void;
  destroy: () => void;
}

export function createPeer(local: Y.Doc): Peer {
  const peerDoc = new Y.Doc();

  const onLocalUpdate = () => {
    // Local changed → push its full state to the peer (echo origin)
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(local), ECHO_ORIGIN);
  };
  const onPeerUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === ECHO_ORIGIN) return;
    // Peer's own change → push its full state to the local with a non-local origin
    Y.applyUpdate(local, Y.encodeStateAsUpdate(peerDoc), PEER_ORIGIN);
  };

  local.on('update', onLocalUpdate);
  peerDoc.on('update', onPeerUpdate);

  return {
    doc: peerDoc,
    load: (fn) => {
      local.transact(fn, LOAD_ORIGIN);
    },
    destroy: () => {
      local.off('update', onLocalUpdate);
      peerDoc.off('update', onPeerUpdate);
      peerDoc.destroy();
    },
  };
}
