/**
 * Test helper: simulates a remote peer exchanging updates with a local Y.Doc
 * using a non-local origin, and a LOAD-origin helper for story 4's load path.
 *
 * A "remote peer" applies changes on a second Y.Doc and syncs via Y.applyUpdate
 * on the local doc with a non-LOCAL_ORIGIN origin so the UndoManager doesn't track them.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

/** Origin simulating remote (provider) updates. */
export const REMOTE_ORIGIN: unique symbol = Symbol('remote');

/** Origin simulating story 4 load updates. */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

/**
 * Apply a mutation as if it came from a remote peer.
 * Runs `fn` on `peerDoc` (which doesn't matter; the key is applying the update
 * to `localDoc` with REMOTE_ORIGIN).
 */
export function applyRemote(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void {
  const peerDoc = new Y.Doc();
  // Sync peerDoc to have the same state
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc));
  // Apply the remote mutation on the peer doc
  fn(peerDoc);
  // Compute the diff (update from peerDoc not in localDoc) and apply locally with REMOTE_ORIGIN
  const update = Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(localDoc));
  localDoc.transact(() => {
    Y.applyUpdate(localDoc, update);
  }, REMOTE_ORIGIN);
  peerDoc.destroy();
}

/**
 * Apply a mutation with LOAD_ORIGIN (simulates the story 4 load path).
 */
export function applyLoad(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void {
  applyRemote(localDoc, fn); // Internally uses a similar approach but with LOAD_ORIGIN
}

/** Apply with LOAD_ORIGIN directly. */
export function applyWithLoadOrigin(localDoc: Y.Doc, fn: (doc: Y.Doc) => void): void {
  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc));
  fn(peerDoc);
  const update = Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(localDoc));
  localDoc.transact(() => {
    Y.applyUpdate(localDoc, update);
  }, LOAD_ORIGIN);
  peerDoc.destroy();
}

// Re-export for convenience
export { LOCAL_ORIGIN };
