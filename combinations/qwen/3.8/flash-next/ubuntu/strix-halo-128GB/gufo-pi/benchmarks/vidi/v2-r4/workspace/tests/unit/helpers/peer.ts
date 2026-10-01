/**
 * Test helper: a simulated remote peer.
 *
 * Creates a second Y.Doc and syncs it with the local doc using a non-local
 * origin (so the UndoManager doesn't capture it). Also provides a helper
 * that applies updates with the "LOAD" origin (story 4 load origin).
 */
import * as Y from 'yjs';

/** A sentinel origin for remote (peer) changes — distinct from LOCAL_ORIGIN. */
export const REMOTE_ORIGIN: unique symbol = Symbol('remote-peer');

/** A sentinel origin for story 4 load updates. */
export const LOAD_ORIGIN: unique symbol = Symbol('load-origin');

export interface Peer {
  doc: Y.Doc;
  /** Apply a mutation on the peer's doc (synced to local with non-local origin). */
  transact(fn: () => void, origin?: unknown): void;
  destroy(): void;
}

/**
 * Create a peer that mirrors the local doc. Mutations applied on the peer are
 * synced to the local doc via update messages applied with the given origin
 * (default REMOTE_ORIGIN), so they are not tracked by the UndoManager.
 */
export function createPeer(local: Y.Doc, origin?: unknown): Peer {
  const peerDoc = new Y.Doc();
  const syncOrigin = origin ?? REMOTE_ORIGIN;

  // Sync local → peer
  const syncToLocal = (update: Uint8Array, _origin: unknown, _doc: Y.Doc) => {
    Y.applyUpdate(peerDoc, update, syncOrigin);
  };
  local.on('update', syncToLocal);

  // Initial state: apply local state to peer
  const state = Y.encodeStateAsUpdate(local);
  Y.applyUpdate(peerDoc, state, syncOrigin);

  // Sync peer → local (with non-local origin)
  const syncToPeer = (update: Uint8Array, _origin: unknown, _doc: Y.Doc) => {
    Y.applyUpdate(local, update, syncOrigin);
  };
  peerDoc.on('update', syncToPeer);

  return {
    doc: peerDoc,
    transact(fn: () => void, o?: unknown) {
      peerDoc.transact(fn, o ?? syncOrigin);
    },
    destroy() {
      local.off('update', syncToLocal);
      peerDoc.off('update', syncToPeer);
      peerDoc.destroy();
    },
  };
}

/**
 * Apply a mutation to the local doc using the LOAD origin
 * (story 4 load updates).
 */
export function loadTransact(local: Y.Doc, fn: () => void): void {
  local.transact(fn, LOAD_ORIGIN);
}
