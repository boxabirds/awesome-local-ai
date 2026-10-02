// A second, real Y.Doc that stands in for "everybody else" in the undo unit
// tests. The thing under test is which transactions a Y.UndoManager captures, and
// that question is answered by the *origin* of an update — so the peer is a real
// document exchanging real updates, with its own origin, rather than a mock.
//
// Two origins that are not LOCAL_ORIGIN stand for the two ways a document
// changes without this tab doing it:
//   - REMOTE_ORIGIN: a change from another person, as the y-websocket provider
//     applies it (story 3).
//   - LOAD_ORIGIN: an update applied while opening the board, which is what
//     story 4's load does (story 8's `undo.not_editable`/TC-03 class).
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjects, initDoc } from '../../../src/shared/board-model';

/** A change from another person, arriving over the room (provider origin). */
export const REMOTE_ORIGIN: unique symbol = Symbol('vidi6.test.remote');

/** An update applied on opening the board (story 4 load origin). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.test.load');

/** Internal marks, so an update is never applied back to where it came from. */
const FROM_LOCAL = Symbol('vidi6.test.from-local');
const FROM_REMOTE = Symbol('vidi6.test.from-remote');

export interface Peer {
  /** The other person's document. */
  doc: Y.Doc;
  /** Make a change as another person: it lands here with REMOTE_ORIGIN. */
  transact(fn: (doc: Y.Doc) => void): void;
  /**
   * Apply an update to this document the way opening the board does, with
   * LOAD_ORIGIN — never LOCAL_ORIGIN, so undo never owns it.
   */
  applyLoad(update: Uint8Array): void;
  /** The whole document as an update, for `applyLoad` to hand over. */
  encode(): Uint8Array;
  /** Stop the two documents from talking to each other. */
  destroy(): void;
}

/**
 * Join a second real document to `doc`, so changes made on either side arrive on
 * the other as updates: local changes go over as they are, and everything coming
 * back arrives with an origin that is not LOCAL_ORIGIN.
 */
export function withPeer(doc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  initDoc(peerDoc);

  // Both sides start from ONE state, the way two tabs do when the room hands
  // them the same saved board. Two documents that each created their own
  // `meta.schemaVersion` never converge from relayed deltas alone, so this
  // hand-over is not a convenience — without it the peer silently stays behind.
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(doc), LOAD_ORIGIN);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc), REMOTE_ORIGIN);

  const onLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_REMOTE) return;
    Y.applyUpdate(peerDoc, update, FROM_LOCAL);
  };
  const onRemote = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_LOCAL) return;
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  };

  doc.on('update', onLocal);
  peerDoc.on('update', onRemote);

  return {
    doc: peerDoc,
    transact(fn: (d: Y.Doc) => void): void {
      peerDoc.transact(() => fn(peerDoc));
    },
    applyLoad(update: Uint8Array): void {
      Y.applyUpdate(doc, update, LOAD_ORIGIN);
    },
    encode(): Uint8Array {
      return Y.encodeStateAsUpdate(peerDoc);
    },
    destroy(): void {
      doc.off('update', onLocal);
      peerDoc.off('update', onRemote);
      peerDoc.destroy();
    },
  };
}
