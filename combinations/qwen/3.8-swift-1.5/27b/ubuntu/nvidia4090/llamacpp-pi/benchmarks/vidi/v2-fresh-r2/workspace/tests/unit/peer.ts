/**
 * Test helper: a second real Y.Doc exchanging updates with the local doc
 * using a non-local origin, plus a helper applying updates with the LOAD
 * origin (story 4).
 *
 * The two docs exchange their initial state on creation so that subsequent
 * incremental updates apply correctly (Yjs updates are relative to the
 * sender's document state).
 */
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

/** A non-local origin to simulate a remote peer. */
export const PEER_ORIGIN: unique symbol = Symbol('PEER_ORIGIN');

/** A load origin to simulate story 4 load updates. */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export interface Peer {
  doc: Y.Doc;
  /** Apply a mutation on the peer's doc (uses PEER_ORIGIN). */
  mutate(fn: (peerDoc: Y.Doc) => void): void;
  /** Apply a mutation with the LOAD origin on the local doc. */
  loadMutate(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void;
  /** Clean up. */
  destroy(): void;
}

/**
 * Create a peer that syncs with `localDoc` using PEER_ORIGIN for its
 * mutations. Updates flow bidirectionally.
 *
 * All remote changes (from peer) are applied to the local doc with
 * PEER_ORIGIN, so the local UndoManager (which tracks LOCAL_ORIGIN only)
 * never captures them.
 */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  initDoc(peerDoc);

  // Exchange initial state so incremental updates work both ways.
  const localState = Y.encodeStateAsUpdate(localDoc);
  const peerState = Y.encodeStateAsUpdate(peerDoc);
  Y.applyUpdate(peerDoc, localState, PEER_ORIGIN);
  Y.applyUpdate(localDoc, peerState, PEER_ORIGIN);

  let syncing = false;

  // Local → Peer: forward local changes to the peer doc
  function localUpdate(update: Uint8Array): void {
    if (syncing) return;
    syncing = true;
    Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
    syncing = false;
  }

  // Peer → Local: forward peer changes to the local doc with PEER_ORIGIN
  function peerUpdate(update: Uint8Array): void {
    if (syncing) return;
    syncing = true;
    Y.applyUpdate(localDoc, update, PEER_ORIGIN);
    syncing = false;
  }

  localDoc.on('update', localUpdate);
  peerDoc.on('update', peerUpdate);

  return {
    doc: peerDoc,
    mutate(fn: (peerDoc: Y.Doc) => void): void {
      peerDoc.transact(() => fn(peerDoc), PEER_ORIGIN);
    },
    loadMutate(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void {
      localDoc.transact(() => fn(localDoc), LOAD_ORIGIN);
    },
    destroy(): void {
      localDoc.off('update', localUpdate);
      peerDoc.off('update', peerUpdate);
      peerDoc.destroy();
    },
  };
}
