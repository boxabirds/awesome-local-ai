/**
 * In-memory peer for unit tests (story 8): a second `Y.Doc` kept in sync with
 * the local doc. Peer-originated changes arrive at the local doc through
 * `Y.applyUpdate(..., PEER_ORIGIN)`, so the local `Y.UndoManager` never sees
 * them as local work — exactly like a real network peer (PRD
 * undo.isolation / undo.sync_independence).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

/** Origin stamped on every change that "arrives" from the peer. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-unit-test-peer');

/** Origin stamped on a full-board load (story 4). Never `LOCAL_ORIGIN`. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-unit-test-load');

export interface Peer {
  /** The peer's own doc (edit it with the board-model helpers). */
  doc: Y.Doc;
  /** Stop syncing and destroy the peer doc. */
  destroy(): void;
}

/**
 * Create a peer and keep both docs in sync. Changes the peer makes (local to
 * the peer doc) arrive at `localDoc` with `PEER_ORIGIN`; changes the local
 * doc makes arrive at the peer with `PEER_ORIGIN` too.
 */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  // lib0's `on()` returns the handler (not an unsubscribe), so pair each
  // `on` with an explicit `off`.
  const onLocalUpdate = (update: Uint8Array) => {
    Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
  };
  const onPeerUpdate = (update: Uint8Array) => {
    Y.applyUpdate(localDoc, update, PEER_ORIGIN);
  };
  localDoc.on('update', onLocalUpdate);
  peerDoc.on('update', onPeerUpdate);
  // A real peer joins with the full current state; give the test peer the
  // same head start so it can edit/delete existing objects.
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc), PEER_ORIGIN);
  return {
    doc: peerDoc,
    destroy() {
      localDoc.off('update', onLocalUpdate);
      peerDoc.off('update', onPeerUpdate);
      peerDoc.destroy();
    },
  };
}

/**
 * Apply the full state of `sourceDoc` to `localDoc` as a load
 * (`LOAD_ORIGIN`), mirroring how story 4 hydrates a board from a snapshot.
 */
export function applyLoad(localDoc: Y.Doc, sourceDoc: Y.Doc): void {
  const state = Y.encodeStateAsUpdate(sourceDoc);
  Y.applyUpdate(localDoc, state, LOAD_ORIGIN);
}

export { LOCAL_ORIGIN };
