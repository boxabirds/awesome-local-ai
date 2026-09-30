/**
 * Simulated remote peer for unit tests.
 *
 * Creates a second Y.Doc that can exchange updates with the local doc
 * using a non-local origin. This simulates a remote peer without a server.
 */
import * as Y from 'yjs';

/** A fake origin representing a load (story 4). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** A fake origin representing a remote peer (story 3 provider). */
export const REMOTE_ORIGIN: unique symbol = Symbol('vidi6.remote');

export interface SimulatedPeer {
  doc: Y.Doc;
  /** Push local doc's current state to peer (applied with REMOTE_ORIGIN). */
  syncToLocalToPeer(): void;
  /** Push peer's current state to local doc (applied with REMOTE_ORIGIN). */
  syncPeerToLocal(): void;
  /** Both directions. */
  sync(): void;
  destroy(): void;
}

/**
 * Create a simulated peer: a second Y.Doc that can exchange updates with the
 * given local doc using REMOTE_ORIGIN (so the UndoManager does not track them).
 *
 * Syncing is manual (call syncToLocalToPeer/syncPeerToLocal/sync) to avoid
 * re-entrancy issues with Yjs update handlers.
 */
export function createSimulatedPeer(localDoc: Y.Doc): SimulatedPeer {
  const peerDoc = new Y.Doc();

  // Initial sync of existing state
  const initDiff = Y.encodeStateAsUpdate(localDoc);
  if (initDiff.length > 0) {
    Y.applyUpdate(peerDoc, initDiff, REMOTE_ORIGIN);
  }

  return {
    doc: peerDoc,
    syncToLocalToPeer(): void {
      const sv = Y.encodeStateVector(peerDoc);
      const diff = Y.encodeStateAsUpdate(localDoc, sv);
      if (diff.length > 0) {
        Y.applyUpdate(peerDoc, diff, REMOTE_ORIGIN);
      }
    },
    syncPeerToLocal(): void {
      const sv = Y.encodeStateVector(localDoc);
      const diff = Y.encodeStateAsUpdate(peerDoc, sv);
      if (diff.length > 0) {
        Y.applyUpdate(localDoc, diff, REMOTE_ORIGIN);
      }
    },
    sync(): void {
      // Local → Peer
      const svPeer = Y.encodeStateVector(peerDoc);
      const diffToPeer = Y.encodeStateAsUpdate(localDoc, svPeer);
      if (diffToPeer.length > 0) Y.applyUpdate(peerDoc, diffToPeer, REMOTE_ORIGIN);

      // Peer → Local
      const svLocal = Y.encodeStateVector(localDoc);
      const diffToLocal = Y.encodeStateAsUpdate(peerDoc, svLocal);
      if (diffToLocal.length > 0) Y.applyUpdate(localDoc, diffToLocal, REMOTE_ORIGIN);
    },
    destroy(): void {
      peerDoc.destroy();
    },
  };
}

/**
 * Apply an update to the local doc with LOAD_ORIGIN (story 4 load updates).
 * These should never be tracked by the undo controller.
 */
export function applyLoadUpdate(localDoc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(localDoc, update, LOAD_ORIGIN);
}
