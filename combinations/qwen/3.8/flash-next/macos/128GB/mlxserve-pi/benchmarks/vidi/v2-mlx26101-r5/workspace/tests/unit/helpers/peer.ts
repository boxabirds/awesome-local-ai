/**
 * A second tab on the same board, for the unit tests of story 8.
 *
 * The thing under test is which changes a person's undo history is allowed to contain, and the only
 * honest way to test that is to have a second person: a real `Y.Doc` with its own client id, kept in
 * step with the board's document in both directions, the way the room keeps two tabs in step. The
 * peer's own writes are made by calling the very same functions from `board-model` on the peer's
 * document, so they arrive here as changes somebody else made and are stamped with an origin that is
 * not {@link LOCAL_ORIGIN} — which is the one question `UndoManager` asks.
 *
 * Nothing about this helper knows anything about undo; it is the network, and it is deliberately
 * dumber than the real one (no awareness, no retry, no batching), because the property being asserted
 * does not depend on any of that.
 */

import * as Y from 'yjs';

import { initDoc, OBJECTS_MAP } from '../../../src/shared/board-model';

/**
 * The origin a colleague's change arrives with. y-websocket passes the provider itself as the origin
 * of everything it applies; this is a symbol instead, so that a test can tell the two apart at a
 * glance and so that nothing in the client can ever pass it by accident.
 */
export const PEER_ORIGIN: unique symbol = Symbol('unit-test-peer');

/**
 * The origin the board's *initial* state arrives with — the snapshot and update log the server sent
 * when the tab opened, before anybody typed anything. It is a third origin rather than
 * {@link PEER_ORIGIN} because it answers a different question: a change that was already on the board
 * when this person arrived is not theirs either, and story 8 must not offer to take it back.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('unit-test-load');

/** The marker used on the peer's side of the wire, and never echoed back. */
const FROM_LOCAL = Symbol('unit-test-from-local');

export interface RemotePeer {
  /** The colleague's document. Write to it with the functions from `board-model`. */
  doc: Y.Doc;
  /** Stops the two documents being kept in step, and lets the colleague's go. */
  close(): void;
}

/**
 * Starts a colleague and connects them to this board, from wherever it is now.
 *
 * The colleague is brought up to date once, synchronously, and from then on every change in either
 * direction is applied to the other in the same tick. Synchrony is the point: a test can write, then
 * assert, and know that what the other person did has already arrived — with the real room the same
 * is true but whenever it likes, which is a thing to test in the browser, not here.
 */
export function connectPeer(doc: Y.Doc): RemotePeer {
  const peer = new Y.Doc();
  initDoc(peer);
  // Both directions, from the state the board is in right now.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), FROM_LOCAL);

  const onLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_LOCAL) return; // what came from the peer, going no further
    Y.applyUpdate(peer, update, FROM_LOCAL);
  };
  const onPeer = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_LOCAL) return;
    Y.applyUpdate(doc, update, PEER_ORIGIN);
  };

  doc.on('update', onLocal);
  peer.on('update', onPeer);

  return {
    doc: peer,
    close: () => {
      doc.off('update', onLocal);
      peer.off('update', onPeer);
      peer.destroy();
    },
  };
}

/**
 * Hands this board a state of the colleague's document as though the server had sent it at load time:
 * the same bytes, a different origin, and no live connection attached to it afterwards.
 */
export function loadFrom(peer: Y.Doc, into: Y.Doc): void {
  Y.applyUpdate(into, Y.encodeStateAsUpdate(peer), LOAD_ORIGIN);
}

/** The objects of a document, as they are on that document, without the snapshot's defaults. */
export function rawObjects(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(OBJECTS_MAP);
}

/** Every object id on a document, whatever the tests put there. */
export function ids(doc: Y.Doc): string[] {
  return [...doc.getMap(OBJECTS_MAP).keys()];
}
