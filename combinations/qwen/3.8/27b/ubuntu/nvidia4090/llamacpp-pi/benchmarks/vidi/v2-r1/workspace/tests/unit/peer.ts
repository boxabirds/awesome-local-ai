// Simulated remote peer for the story 8 undo-history unit tests: a second
// real Y.Doc exchanging updates with the local doc. Updates cross the
// "network" with a non-local origin, so an UndoManager tracking only
// LOCAL_ORIGIN never captures the peer's changes (undo.own). A separate
// helper applies raw updates with the story 4 LOAD origin (the origin used
// when a persisted board is loaded into a fresh doc).

import * as Y from 'yjs';

/** Origin for peer-to-peer updates. Must differ from LOCAL_ORIGIN. */
export const PEER_ORIGIN = Symbol('vidi6.peerOrigin');

/** Origin for story 4 load updates (persisted state applied on first sync). */
export const LOAD_ORIGIN = Symbol('vidi6.loadOrigin');

export interface Peer {
  /** The peer's own doc. Mutate it with the board-model helpers. */
  readonly doc: Y.Doc;
  /** Send everything the peer has that the local doc lacks, as a remote update. */
  pushToLocal(local: Y.Doc): void;
  /** Pull everything the local doc has that the peer lacks into the peer. */
  pullFromLocal(local: Y.Doc): void;
  /** Peer does both: converge the two docs. */
  sync(local: Y.Doc): void;
  destroy(): void;
}

/** A second real Y.Doc standing in for a remote collaborator. */
export function createPeer(): Peer {
  const doc = new Y.Doc();
  return {
    doc,
    pushToLocal(local: Y.Doc): void {
      const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(local));
      if (update.byteLength > 0) Y.applyUpdate(local, update, PEER_ORIGIN);
    },
    pullFromLocal(local: Y.Doc): void {
      const update = Y.encodeStateAsUpdate(local, Y.encodeStateVector(doc));
      if (update.byteLength > 0) Y.applyUpdate(doc, update, PEER_ORIGIN);
    },
    sync(local: Y.Doc): void {
      this.pushToLocal(local);
      this.pullFromLocal(local);
    },
    destroy(): void {
      doc.destroy();
    },
  };
}

/**
 * Apply a raw state update to the local doc with the story 4 LOAD origin
 * (what the real client does when it receives the persisted board before
 * the provider connects). LOAD-origin updates are never undoable.
 */
export function applyLoadUpdate(local: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(local, update, LOAD_ORIGIN);
}

/** Encode the full state of a doc (a stand-in for persisted board bytes). */
export function fullStateUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
