// Test helper: a second real Y.Doc that exchanges updates with a local doc
// using a non-local origin, plus a helper for applying updates with a LOAD
// origin (simulating story 4's initial load).

import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc } from '../../src/shared/board-model';

/** Origin marker used for "remote peer" updates in tests. */
export const PEER_ORIGIN: unique symbol = Symbol('PEER_ORIGIN');

/** Origin marker used for "load" updates in tests (story 4). */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export interface Peer {
  /** The peer's Y.Doc. */
  doc: Y.Doc;
  /** Apply a mutation on the peer's doc and sync it to the local doc. */
  apply(fn: () => void): void;
  /** Destroy the peer (stop syncing). */
  destroy(): void;
}

/**
 * Create a peer Y.Doc that exchanges updates with `localDoc`.
 * All mutations on the peer use PEER_ORIGIN so the local UndoManager
 * (which tracks LOCAL_ORIGIN only) does not capture them.
 */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  initDoc(peerDoc);

  // Sync both directions with the appropriate origins.
  const observer1 = () => {
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc));
  };
  const observer2 = () => {
    Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc));
  };

  localDoc.on('update', observer1);
  peerDoc.on('update', observer2);

  // Initial sync.
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc));

  return {
    doc: peerDoc,
    apply(fn: () => void) {
      peerDoc.transact(fn, PEER_ORIGIN);
    },
    destroy() {
      localDoc.off('update', observer1);
      peerDoc.off('update', observer2);
    },
  };
}

/**
 * Apply an update to `doc` with the LOAD origin (simulating story 4's
 * initial board load from the server).
 */
export function applyLoadUpdate(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOAD_ORIGIN);
}
