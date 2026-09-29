// Story 8, task 6: test helper for a simulated remote peer (design: "Mock vs
// real boundaries": unit tests use a second real Y.Doc exchanging deltas with
// non-local origins, as y-websocket does in the e2e tests).
//
// A peer is a second Y.Doc whose changes are exchanged with the local doc as
// plain update bytes. On the local side, peer updates are applied with a
// non-local origin (PEER_ORIGIN), exactly like the sync provider applies
// remote transactions. The UndoManager's trackedOrigins filter therefore
// never sees them.

import * as Y from 'yjs';

/** Origin of changes applied to the local doc that came from the peer. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6.test-peer');

/** Stand-in for story 4's LOAD_ORIGIN (client-side update application). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.test-load');

export interface Peer {
  /** The peer's own document. */
  readonly doc: Y.Doc;
  /**
   * Apply a change to the peer doc (peer's own LOCAL-equivalent origin) and
   * exchange all pending updates in both directions.
   */
  apply(fn: () => void): void;
  /** Exchange all pending updates in both directions. */
  sync(): void;
  /** Exchange all pending updates in both directions, then close the peer. */
  close(): void;
}

/**
 * Attach a simulated peer to `local`.
 *
 * Peer→local updates land with PEER_ORIGIN (a non-local origin, like the
 * y-websocket provider). Local→peer updates land with the same origin on the
 * peer side; the tests never inspect the peer's undo state, so the origin
 * there is irrelevant.
 */
export function createPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  // Ensure the peer has the same top-level maps as the board doc.
  peer.getMap('objects');

  const push = (from: Y.Doc, to: Y.Doc): void => {
    const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
    if (update.byteLength > 0) Y.applyUpdate(to, update, PEER_ORIGIN);
  };

  const sync = (): void => {
    push(local, peer);
    push(peer, local);
  };

  return {
    doc: peer,
    apply: (fn: () => void): void => {
      peer.transact(fn, PEER_ORIGIN);
      sync();
    },
    sync,
    close: (): void => {
      sync();
      peer.destroy();
    },
  };
}

/** Create a plain sticky note in the given doc (raw Yjs, test origin). */
export function rawSticky(doc: Y.Doc, id: string, x: number, y: number, color: string, z = 1): void {
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('id', id);
  obj.set('x', x);
  obj.set('y', y);
  obj.set('color', color);
  obj.set('text', new Y.Text());
  obj.set('z', z);
  doc.getMap('objects').set(id, obj);
}

/** Apply `bytes` to `doc` the way story 4 applies loaded state (LOAD origin). */
export function applyLoadUpdate(doc: Y.Doc, bytes: Uint8Array): void {
  Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
}

/** Look up an object's Y.Map by id (typed helper). */
export function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
}
