/**
 * Test helper: a "remote peer" that applies changes to a second Y.Doc and syncs
 * them back to the local doc using a non-local origin, simulating provider updates.
 * Also provides a LOAD_ORIGIN for story 4 load updates.
 */
import * as Y from 'yjs';

export const REMOTE_ORIGIN = Symbol('remote');
export const LOAD_ORIGIN = Symbol('load');

/**
 * Create a peer doc that stays in sync with the local doc.
 * Changes made via `peerApply` appear in the local doc with REMOTE_ORIGIN.
 */
export interface Peer {
  doc: Y.Doc;
  /** Apply a mutation on the peer doc (syncs to local with REMOTE_ORIGIN). */
  peerApply(fn: (doc: Y.Doc) => void): void;
  destroy(): void;
}

export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();

  // Sync local → peer (no origin needed, just for initial state)
  const syncLocalToPeer = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return; // don't loop back
    Y.applyUpdate(peerDoc, update);
  };
  localDoc.on('update', syncLocalToPeer);

  // Sync peer → local with REMOTE_ORIGIN
  const syncPeerToLocal = (update: Uint8Array) => {
    Y.applyUpdate(localDoc, update, REMOTE_ORIGIN);
  };
  peerDoc.on('update', syncPeerToLocal);

  // Push initial state
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc));

  return {
    doc: peerDoc,
    peerApply(fn: (doc: Y.Doc) => void) {
      fn(peerDoc);
    },
    destroy() {
      localDoc.off('update', syncLocalToPeer);
      peerDoc.off('update', syncPeerToLocal);
      peerDoc.destroy();
    },
  };
}

/**
 * Apply updates from a snapshot doc using LOAD_ORIGIN (simulates story 4 load).
 */
export function applyWithLoadOrigin(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void {
  const tempDoc = new Y.Doc();
  fn(tempDoc);
  const update = Y.encodeStateAsUpdate(tempDoc);
  Y.applyUpdate(localDoc, update, LOAD_ORIGIN);
  tempDoc.destroy();
}
