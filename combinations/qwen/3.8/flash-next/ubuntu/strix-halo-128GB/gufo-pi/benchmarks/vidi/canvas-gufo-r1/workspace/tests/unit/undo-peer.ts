/**
 * Test helpers for simulating remote peers and load-origin transactions.
 */
import * as Y from 'yjs';

/** A symbol representing a remote (provider) origin for simulating remote peers. */
export const REMOTE_ORIGIN: unique symbol = Symbol('remote');

/** A symbol representing the load origin (story 4). */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

/**
 * Creates a peer doc that exchanges updates with the local doc using REMOTE_ORIGIN.
 * Changes applied on the peer appear in the local doc but are NOT tracked by the UndoManager
 * (since it only tracks LOCAL_ORIGIN).
 */
export function createPeer(localDoc: Y.Doc): {
  doc: Y.Doc;
  syncTo(): void;
  syncFrom(): void;
  destroy(): void;
} {
  const peerDoc = new Y.Doc();

  // Sync local → peer
  function syncFrom(): void {
    const state = Y.encodeStateAsUpdate(localDoc);
    peerDoc.transact(() => {
      Y.applyUpdate(peerDoc, state, REMOTE_ORIGIN);
    }, REMOTE_ORIGIN);
  }

  // Sync peer → local
  function syncTo(): void {
    const state = Y.encodeStateAsUpdate(peerDoc);
    localDoc.transact(() => {
      Y.applyUpdate(localDoc, state, REMOTE_ORIGIN);
    }, REMOTE_ORIGIN);
  }

  // Initial sync
  syncFrom();

  return {
    doc: peerDoc,
    syncTo,
    syncFrom,
    destroy(): void {
      peerDoc.destroy();
    },
  };
}

/**
 * Apply an update to a doc with LOAD_ORIGIN (simulating story 4 load).
 */
export function applyWithLoadOrigin(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
