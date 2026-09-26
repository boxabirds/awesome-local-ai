import * as Y from 'yjs';

/**
 * Simulated remote peer for the story 8 undo unit tests.
 *
 * A "remote" change is one that reaches the local board doc with an origin
 * that is NOT `LOCAL_ORIGIN` (the per-tab local origin the board model uses
 * for every local mutation). In production these arrive through the
 * y-websocket provider (provider origin) or as the story 4 load (server
 * origin). This helper models both with a second real Y.Doc whose updates are
 * applied to the local doc under an explicit non-local origin, deterministically
 * and without a server.
 *
 * The UndoController under test tracks `LOCAL_ORIGIN` only, so every update
 * applied here must be invisible to its undo/redo stacks.
 */

/** A non-local origin standing in for the sync provider's remote updates. */
export const REMOTE_ORIGIN = 'remote-peer';
/** A non-local origin standing in for the story 4 board load. */
export const LOAD_ORIGIN = 'board-load';

export interface RemotePeer {
  /** The peer's own Y.Doc (make changes on it, then push). */
  doc: Y.Doc;
  /**
   * Apply the peer's current state to `local` as a remote update (the peer's
   * new/changed content merges in; the origin is NOT local).
   */
  pushTo(local: Y.Doc, origin?: unknown): void;
}

/** Creates a fresh simulated remote peer. */
export function createPeer(): RemotePeer {
  const doc = new Y.Doc();
  return {
    doc,
    pushTo(local, origin = REMOTE_ORIGIN): void {
      const update = Y.encodeStateAsUpdate(doc);
      Y.applyUpdate(local, update, origin);
    },
  };
}

/** Applies a raw Yjs update to `local` under a non-local origin. */
export function applyRemoteUpdate(local: Y.Doc, update: Uint8Array, origin: unknown = REMOTE_ORIGIN): void {
  Y.applyUpdate(local, update, origin);
}
