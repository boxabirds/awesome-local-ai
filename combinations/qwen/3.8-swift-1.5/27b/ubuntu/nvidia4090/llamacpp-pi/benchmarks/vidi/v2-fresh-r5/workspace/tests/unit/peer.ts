/**
 * Simulated remote peer for the undo unit tests (story 8).
 *
 * A second real Y.Doc that exchanges updates with the local doc. Peer
 * changes are applied to the local doc with PEER_ORIGIN (a non-local
 * origin), mirroring how the y-websocket provider delivers remote updates
 * in the real app. `applyLoadUpdate` applies an encoded update with the
 * story 4 LOAD origin (state applied from storage).
 */
import * as Y from 'yjs';

/** Origin for changes arriving from the simulated remote peer. */
export const PEER_ORIGIN: unique symbol = Symbol('PEER_ORIGIN');

/** Origin for story 4 load updates (state applied from storage). */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export interface Peer {
  /** The peer's own Y.Doc. */
  doc: Y.Doc;
  /**
   * Mutate the peer doc in one PEER_ORIGIN transaction and sync the change
   * to the local doc (applied with PEER_ORIGIN).
   */
  apply(fn: (doc: Y.Doc) => void): void;
  destroy(): void;
}

/**
 * Create a simulated remote peer bound to `localDoc`. Updates flow both
 * ways; the exchange is synchronous and terminates (re-applying already
 * integrated content integrates nothing and fires no further update).
 */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();

  const onPeerUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(localDoc, update, PEER_ORIGIN);
  };
  const onLocalUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
  };
  peerDoc.on('update', onPeerUpdate);
  localDoc.on('update', onLocalUpdate);

  // A freshly connected peer receives the board's current state (like the
  // real y-websocket sync protocol). Apply it with the LOAD origin so the
  // initial state is never captured as an undoable local change.
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc), LOAD_ORIGIN);

  return {
    doc: peerDoc,
    apply(fn) {
      // Y.Doc.transact passes the Transaction to the callback; hand the
      // peer doc to the test's mutation function instead.
      peerDoc.transact(() => fn(peerDoc), PEER_ORIGIN);
    },
    destroy() {
      peerDoc.off('update', onPeerUpdate);
      localDoc.off('update', onLocalUpdate);
      peerDoc.destroy();
    },
  };
}

/**
 * Apply an encoded update to `doc` with the story 4 LOAD origin (the origin
 * used when a board's stored state is applied, not a local edit).
 */
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
