/**
 * Test helper: a second real Y.Doc exchanging updates with the local doc using a
 * non-local origin (simulating a remote peer or a load operation).
 */
import * as Y from 'yjs';

/** Origin used to simulate remote peer updates (same as a websocket provider would use). */
export const PEER_ORIGIN: unique symbol = Symbol('peer');

/** Origin used to simulate story 4 LOAD updates (not tracked by undo). */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

export interface PeerHandle {
  doc: Y.Doc;
  destroy(): void;
}

/**
 * Create a peer doc that synchronizes with the local doc bidirectionally.
 * Remote changes applied to the peer are synced back to the local doc with a non-LOCAL origin.
 */
export function createPeer(local: Y.Doc): PeerHandle {
  const peer = new Y.Doc();

  // Sync initial state from local to peer
  const state = Y.encodeStateAsUpdate(local);
  Y.applyUpdate(peer, state, PEER_ORIGIN);

  // Local → Peer (skip updates applied FROM the peer to avoid loops)
  const localUpdateHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === PEER_ORIGIN) return;
    Y.applyUpdate(peer, update, PEER_ORIGIN);
  };
  local.on('update', localUpdateHandler);

  // Peer → Local
  const peerUpdateHandler = (update: Uint8Array, _origin: unknown) => {
    Y.applyUpdate(local, update, PEER_ORIGIN);
  };
  peer.on('update', peerUpdateHandler);

  return {
    doc: peer,
    destroy() {
      local.off('update', localUpdateHandler);
      peer.off('update', peerUpdateHandler);
      peer.destroy();
    },
  };
}

/**
 * Apply a mutation to the peer doc using PEER_ORIGIN, simulating a remote user's action.
 */
export function peerTransact(peer: PeerHandle, fn: () => void): void {
  peer.doc.transact(fn, PEER_ORIGIN);
}

/**
 * Apply a mutation to the local doc using LOAD_ORIGIN, simulating story 4 load updates.
 */
export function loadTransact(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOAD_ORIGIN);
}
