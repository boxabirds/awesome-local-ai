/**
 * A second person on the same board, for tests that have to prove a change is
 * somebody else's (`tests/unit/peer.ts`).
 *
 * The undo tests are all about one distinction - which transactions came from
 * this tab, and which came from somewhere else - and the honest way to test that
 * is with a second real document that the first one is kept in step with, the way
 * two browsers are kept in step with each other by a room. Nothing is stubbed: a
 * peer's change is an ordinary model call on an ordinary `Y.Doc`, and what makes
 * it *remote* is the origin it is transacted with, which is exactly what makes it
 * remote in the application (story 3's provider applies what arrives on the
 * socket with the provider as the origin, not with `LOCAL_ORIGIN`).
 *
 * A peer that was a hand-written update blob would test the controller against a
 * document no board is ever in; a peer that was stubbed would not test the
 * controller at all.
 */

import * as Y from 'yjs';

import { initDoc } from '../../src/shared/board-model.js';
import { LOAD_ORIGIN } from '../../src/worker/board-store.js';

/**
 * The origin a peer's changes carry into the local document. In the application
 * this is the `WebsocketProvider` instance (story 3); here it is this symbol, and
 * the only property that matters is that it is not `LOCAL_ORIGIN`.
 */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-test-peer');

export interface Peer {
  /** The peer's own document; make changes on it with the model functions. */
  readonly doc: Y.Doc;
  /**
   * Make a change as this peer. It runs in the peer's own transaction with the
   * peer's own origin, and is handed to the local document before the call
   * returns, so a test can say "Raj recoloured the note" and then look.
   */
  transact<T>(change: (doc: Y.Doc) => T): T;
  /** Stop keeping the two documents in step. */
  destroy(): void;
}

/**
 * Keep `local` and a new peer document in step, both ways, synchronously.
 *
 * `encodeStateAsUpdate(from, stateVector(to))` sends only what the other side is
 * missing, which is what a room does; the re-entrancy flag stops the echo of a
 * change from being sent straight back.
 */
export function createPeer(local: Y.Doc, origin: unknown = PEER_ORIGIN): Peer {
  const doc = new Y.Doc();
  initDoc(doc);

  let pushing = false;
  const push = (from: Y.Doc, to: Y.Doc): void => {
    if (pushing) return;
    pushing = true;
    try {
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), origin);
    } finally {
      pushing = false;
    }
  };

  const onLocal = (): void => push(local, doc);
  const onPeer = (): void => push(doc, local);
  local.on('update', onLocal);
  doc.on('update', onPeer);

  // Whatever each side already holds is brought over first: a fixture built on
  // one document before the other existed is the normal way a test starts.
  pushing = true;
  try {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(local, Y.encodeStateVector(doc)), PEER_ORIGIN);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(local)), origin);
  } finally {
    pushing = false;
  }

  return {
    doc,
    transact<T>(change: (peer: Y.Doc) => T): T {
      let value: T | undefined;
      doc.transact(() => {
        value = change(doc);
      }, PEER_ORIGIN);
      return value as T;
    },
    destroy(): void {
      local.off('update', onLocal);
      doc.off('update', onPeer);
    },
  };
}

/**
 * Apply an update into `doc` the way story 4 applies a board it read out of
 * storage: the update is already in the room's log, it is not this tab's work, and
 * it must never become something this tab can undo. `Y.applyUpdate` on its own
 * would use `null` as the origin, which is tracked by a default `UndoManager` -
 * so this is the case that has to be stated out loud rather than assumed.
 */
export function applyLoaded(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

export default createPeer;
