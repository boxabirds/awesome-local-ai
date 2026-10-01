// A second real `Y.Doc` that behaves like a remote peer (or like story 4's board
// load) for the undo.history unit tests. It syncs with the local document over the
// real Yjs update wire, but every change it applies to the local document carries
// an origin that is NOT `LOCAL_ORIGIN` - the provider's origin for a peer change,
// `LOAD_ORIGIN` for a load - so the `UndoController` never captures them. This is
// how "only local changes are undoable, remote and load changes never are" is
// tested without a server.

import * as Y from 'yjs';
import { LOAD_ORIGIN } from '../../../src/worker/board-store';

/** The origin a live provider applies a peer's updates with. */
export const PROVIDER_ORIGIN: unique symbol = Symbol('test-provider');

export interface Peer {
  /** The peer's own document; mutate it with `change`. */
  readonly doc: Y.Doc;
  /** Run `fn` on the peer's document, then apply the resulting update locally. */
  change(fn: (doc: Y.Doc) => void): void;
  /**
   * Apply `fn`'s effect to the LOCAL document with the story 4 `LOAD_ORIGIN`
   * (a board being loaded, whose updates must never be undoable). `fn` runs on a
   * throwaway document to produce the bytes.
   */
  load(fn: (doc: Y.Doc) => void): void;
}

/**
 * Create a peer over the local document. The peer starts from the local document's
 * current state so its ids and clocks are consistent with it.
 */
export function createPeer(local: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(local));

  return {
    doc: peerDoc,
    change(fn: (doc: Y.Doc) => void): void {
      // Bring the peer up to date with the local board first, so it can see and
      // act on objects created after this peer was made (like a real collaborator).
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(local, Y.encodeStateVector(peerDoc)));
      const before = Y.encodeStateAsUpdate(peerDoc);
      fn(peerDoc);
      const update = Y.encodeStateAsUpdate(peerDoc, before);
      Y.applyUpdate(local, update, PROVIDER_ORIGIN);
    },
    load(fn: (doc: Y.Doc) => void): void {
      const scratch = new Y.Doc();
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(local));
      const before = Y.encodeStateAsUpdate(scratch);
      fn(scratch);
      const update = Y.encodeStateAsUpdate(scratch, before);
      Y.applyUpdate(local, update, LOAD_ORIGIN);
    },
  };
}
