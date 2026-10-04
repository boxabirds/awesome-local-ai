/**
 * A stand-in remote peer for story 8's undo tests.
 *
 * Undo correctness is about origins: a change made by this tab uses
 * `LOCAL_ORIGIN` and is captured; a change that arrives from a colleague (or
 * from storage on load) uses some other origin and is never captured. Here a
 * "peer" is a second real `Y.Doc` seeded from the local board, edited with the
 * real board model, and merged back into the local doc with a non-local origin —
 * the same thing the sync provider does on the wire, minus the network.
 */

import * as Y from 'yjs';

/** Stands in for the sync provider's origin when a peer change reaches this doc. */
export const REMOTE_ORIGIN: unique symbol = Symbol('vidi6.remote');

/** Story 4: a board arriving from storage is applied with an origin of its own. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/**
 * Run `mutate` against a fresh document that already mirrors `local`, then merge
 * the result back into `local` under `origin` (the sync provider by default).
 * Because the merge is not a `LOCAL_ORIGIN` transaction, the local undo history
 * never sees it.
 */
export function changeAsPeer(
  local: Y.Doc,
  mutate: (peerDoc: Y.Doc) => void,
  origin: unknown = REMOTE_ORIGIN,
): void {
  const peer = new Y.Doc();
  try {
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
    mutate(peer);
    const update = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(local));
    Y.applyUpdate(local, update, origin);
  } finally {
    peer.destroy();
  }
}

/** Apply a change to `local` as a board-load update (never undoable). */
export function changeAsLoad(local: Y.Doc, mutate: (sourceDoc: Y.Doc) => void): void {
  changeAsPeer(local, mutate, LOAD_ORIGIN);
}
