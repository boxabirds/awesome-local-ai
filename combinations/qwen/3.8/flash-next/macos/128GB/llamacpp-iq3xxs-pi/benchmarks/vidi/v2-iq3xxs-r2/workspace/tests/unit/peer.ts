import * as Y from 'yjs';

/**
 * A second real `Y.Doc` that exchanges updates with the board document the way two
 * browsers do over the sync provider (design's mock-vs-real table: "second real Y.Doc
 * exchanging updates with a non-local origin").
 *
 * The point of this file is the *origin*: every update that arrives at the local document
 * from the peer is applied with `PEER_ORIGIN`, which `createUndo` does not track — exactly
 * what makes `undo.own` true, and what the undo history tests assert. Nothing here knows
 * anything about undo.
 */

/** Origin of every update applied to the local document by the peer. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-test-peer');
/**
 * Origin story 4's board load applies updates with (`undo.history`, TC-03): a change the
 * client never made, arriving all at once instead of one per keystroke.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-test-load');

export interface Peer {
  /** The peer's own document; it edits it with the same model code this client uses. */
  readonly doc: Y.Doc;
  /** Run the peer's change on its own document; it lands on the local one immediately. */
  transact<T>(change: (doc: Y.Doc) => T): T;
  /** Stop exchanging updates and throw both documents away. */
  destroy(): void;
}

/**
 * Connect a fresh document to `local` in both directions. Updates are forwarded with the
 * peer's origin in one direction and, symmetrically, forwarded back with `LOCAL_ORIGIN`
 * stripped, so the local document sees *everything* the peer did as somebody else's work
 * and the peer sees everything the local client did — including the inverse changes an
 * undo applies.
 */
export function connectPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  // Start from the same state, then stay in sync.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local), PEER_ORIGIN);

  let closed = false;
  const onLocal = (update: Uint8Array): void => {
    if (closed) return;
    Y.applyUpdate(doc, update, PEER_ORIGIN);
  };
  const onPeer = (update: Uint8Array): void => {
    if (closed) return;
    // Every peer update reaches the local document with the peer's origin, never
    // `LOCAL_ORIGIN` and never `undefined`.
    Y.applyUpdate(local, update, PEER_ORIGIN);
  };
  local.on('update', (update: Uint8Array) => onLocal(update));
  doc.on('update', (update: Uint8Array) => onPeer(update));

  return {
    doc,
    transact<T>(change: (peerDoc: Y.Doc) => T): T {
      return change(doc);
    },
    destroy(): void {
      closed = true;
      doc.destroy();
    },
  };
}

/** Apply an update to `doc` the way story 4's load does (untracked, all at once). */
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
