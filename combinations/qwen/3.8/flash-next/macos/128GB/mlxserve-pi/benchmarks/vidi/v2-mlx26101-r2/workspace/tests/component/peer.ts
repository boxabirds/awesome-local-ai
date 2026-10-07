/**
 * A second person on the same board, for component tests that have to prove a
 * change is somebody else's.
 *
 * The component counterpart of `tests/unit/peer.ts`, and deliberately a copy of its
 * mechanism rather than an import of it: the unit one pulls `LOAD_ORIGIN` from the
 * worker's board store, which belongs to the node project and cannot be loaded
 * here. What a component test needs is the same thing with one fewer dependency: a
 * second real `Y.Doc` kept in step both ways, whose changes carry an origin that is
 * not `LOCAL_ORIGIN` - which is precisely what makes a change remote in the
 * application, where it arrives through the provider.
 *
 * Nothing is stubbed. A peer's change is an ordinary model call on an ordinary
 * document, so a test can say "somebody else deleted this object" and then look at
 * what this board drew.
 */

import * as Y from 'yjs';

import { act } from '@testing-library/react';

import { initDoc } from '../../src/shared/board-model.js';

/** The origin a peer's changes carry into the local document. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-component-peer');

export interface Peer {
  /** The peer's own document; make changes on it with the model functions. */
  readonly doc: Y.Doc;
  /**
   * Make a change as this peer: in the peer's own transaction, with the peer's own
   * origin, handed to the local document before the call returns.
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
export function createPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  initDoc(doc);

  let pushing = false;
  const push = (from: Y.Doc, to: Y.Doc): void => {
    if (pushing) return;
    pushing = true;
    try {
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), PEER_ORIGIN);
    } finally {
      pushing = false;
    }
  };

  const onLocal = (): void => push(local, doc);
  const onPeer = (): void => push(doc, local);
  local.on('update', onLocal);
  doc.on('update', onPeer);
  push(doc, local);
  push(local, doc);

  return {
    doc,
    transact<T>(change: (theirDoc: Y.Doc) => T): T {
      let value: T;
      doc.transact(() => {
        value = change(doc);
      }, PEER_ORIGIN);
      return value!;
    },
    destroy(): void {
      local.off('update', onLocal);
      doc.off('update', onPeer);
      doc.destroy();
    },
  };
}

/**
 * Do something as the peer, and let the board render what arrived.
 *
 * `transact` on its own is enough for a test that only reads the document. A test
 * that reads the *screen* has to give React the chance to see the change, and a
 * peer's change arrives on a document listener that is outside any `act` - which is
 * the one difference, as far as a test is concerned, between a peer and a person:
 * a person's own keystroke is already inside the `act` that dispatched it.
 */
export function asPeer<T>(peer: Peer, change: (theirDoc: Y.Doc) => T): T {
  let value: T | undefined;
  act(() => {
    peer.transact((theirDoc) => {
      value = change(theirDoc);
    });
  });
  return value as T;
}
