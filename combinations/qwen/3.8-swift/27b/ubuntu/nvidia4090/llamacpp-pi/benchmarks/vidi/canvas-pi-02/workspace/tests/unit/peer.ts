// Simulated remote peer for story 8 unit tests: a second real Y.Doc that
// exchanges updates with the local doc using a NON-local origin, exactly as
// a real y-websocket provider would deliver remote changes. Plus a helper
// applying updates with the story 4 LOAD origin (initial load).

import * as Y from 'yjs';
import { LOAD_ORIGIN } from '../../src/worker/board-store';

/** Origin for simulated peer changes: neither LOCAL_ORIGIN nor LOAD_ORIGIN,
 *  so no undo history (which tracks LOCAL_ORIGIN only) ever captures them. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-peer-origin');

export class RemotePeer {
  readonly doc: Y.Doc;

  constructor() {
    this.doc = new Y.Doc();
  }

  /** Syncs the local doc into the peer (so the peer sees the current board),
   *  runs `mutate` on the peer with PEER_ORIGIN, and pushes the result back
   *  to the local doc with PEER_ORIGIN. */
  apply(local: Y.Doc, mutate: (peer: Y.Doc) => void): void {
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(local), PEER_ORIGIN);
    this.doc.transact(() => mutate(this.doc), PEER_ORIGIN);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(this.doc), PEER_ORIGIN);
  }

  /** The peer doc's current full state as an update (for LOAD-origin tests). */
  stateUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }
}

/** Applies a stored-state update to `doc` with the story 4 LOAD origin
 *  (the way board-store loads a persisted board into a fresh doc). */
export function applyLoad(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
