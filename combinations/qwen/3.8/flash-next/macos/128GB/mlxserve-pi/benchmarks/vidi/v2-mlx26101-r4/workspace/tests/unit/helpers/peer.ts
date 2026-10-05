/**
 * Another person, for the unit tests that need one.
 *
 * Undo is only interesting once somebody else is on the board: the claim is not "my changes come back",
 * it is "my changes come back *and nobody else's go away*". A unit test cannot open a second browser, so
 * it gets a second real `Y.Doc` that holds the same board and exchanges updates with the first one. That
 * is the only honest stand-in available at this level — the thing under test is which transactions the
 * controller paid attention to, and the way that question is decided in the product (a transaction
 * origin) is exactly the thing this helper is able to reproduce:
 *
 *   - a change made here goes out under `LOCAL_ORIGIN`, because the model writes it that way;
 *   - the same change arriving back over a socket is applied here under an origin that is not
 *     `LOCAL_ORIGIN`, because the provider is the origin of anything a socket delivered.
 *
 * The room's half of story 4 is here too as {@link applyLoadUpdate}: a board the room read off disk
 * arrives under its own origin and must no more be undoable than a colleague's keystroke is — otherwise
 * a person who pressed undo after opening a board would take the board's own notes away.
 */
import * as Y from 'yjs';

import { initDoc } from '../../../src/shared/board-model';

/** What a change from somebody else looks like to this document. */
export const PEER_ORIGIN: unique symbol = Symbol('test.peer');

/** What the board the room read from storage looks like to this document (story 4's `LOAD_ORIGIN`). */
export const LOAD_ORIGIN: unique symbol = Symbol('test.load');

export interface Peer {
  /** The other copy of the board. Read it to check what the peer did; never write to it directly. */
  readonly doc: Y.Doc;
  /** Do something on the peer's copy and let the result arrive here, as it would over a socket. */
  change(edit: (doc: Y.Doc) => void): void;
  /** Bring the peer up to date with this document without changing anything of its own. */
  catchUp(): void;
  destroy(): void;
}

/**
 * A colleague on the same board.
 *
 * The two documents are kept in step by hand rather than by a connection, so a test says exactly when a
 * remote change lands — which matters when the question is what the undo stack held at that moment.
 */
export function createPeer(local: Y.Doc): Peer {
  const there = new Y.Doc();
  initDoc(there);

  const sendTo = (from: Y.Doc, to: Y.Doc, origin: unknown): void => {
    const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
    if (update.byteLength > 0) Y.applyUpdate(to, update, origin);
  };

  return {
    doc: there,
    catchUp() {
      sendTo(local, there, PEER_ORIGIN);
    },
    change(edit) {
      // Both directions, as a room would: the peer cannot edit a board it has never seen, and the change
      // is only worth testing once it has come back.
      sendTo(local, there, PEER_ORIGIN);
      edit(there);
      sendTo(there, local, PEER_ORIGIN);
    },
    destroy() {
      there.destroy();
    },
  };
}

/**
 * Put a board into this document the way the room puts a board it loaded into it.
 *
 * Used for a board that was already there when this tab arrived: nothing in it is anybody's new change,
 * and above all nothing in it is *mine*.
 */
export function applyLoadUpdate(local: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(local, update, LOAD_ORIGIN);
}

/** A board with notes on it, built in a document of its own, ready to be loaded into another one. */
export function boardWrittenElsewhere(build: (doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);
  build(doc);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}
