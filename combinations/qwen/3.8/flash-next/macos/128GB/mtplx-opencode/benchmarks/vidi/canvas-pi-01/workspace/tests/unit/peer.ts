/**
 * Story 8 · task 6 — a simulated remote peer for the undo-history unit tests.
 *
 * The undo controller's whole promise is "only my own changes are undoable", so
 * the tests need a *remote* whose origin is genuinely not `LOCAL_ORIGIN`. The
 * cleanest way to be sure is to keep a second real `Y.Doc`, make a change on it
 * with a non-local origin, and push the resulting update into the local doc with
 * a non-local transaction origin — exactly the shape the y-websocket provider and
 * the story-4 load path take. Nothing here mocks Yjs; the merge really happens.
 */
import * as Y from 'yjs';

/** Origin for changes that arrive from a colleague (mirrors the provider). */
export const REMOTE_ORIGIN: unique symbol = Symbol('vidi6.test.remote');

/** Origin for a story-4 board load (an update applied on first attach). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.test.load');

export interface Peer {
  /** The remote document. Mutate it directly, then call `syncTo`. */
  readonly doc: Y.Doc;
  /** Push the peer's current state into `local` under {@link REMOTE_ORIGIN}. */
  syncTo(local: Y.Doc): void;
  /** Make a change on the peer, then sync it into `local` as a remote change. */
  change(local: Y.Doc, fn: (peer: Y.Doc) => void): void;
}

/** A peer already sharing `local`'s state, so ids line up across the two docs. */
export function createPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local));
  const syncTo = (target: Y.Doc): void => {
    Y.applyUpdate(target, Y.encodeStateAsUpdate(doc), REMOTE_ORIGIN);
  };
  return {
    doc,
    syncTo,
    change(target, fn) {
      doc.transact(() => fn(doc), REMOTE_ORIGIN);
      syncTo(target);
    },
  };
}

/**
 * Apply `update` to `target` under the story-4 load origin. Used to prove a board
 * read from storage is not undoable either (PRD undo.own / undo.not_editable).
 */
export function applyLoad(target: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(target, update, LOAD_ORIGIN);
}