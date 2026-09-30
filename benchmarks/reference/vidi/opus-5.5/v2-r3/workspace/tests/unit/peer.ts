// A simulated remote peer for undo tests: a second real Y.Doc that exchanges
// updates with the local doc using non-local origins, like the sync provider.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

/** Origin of updates that arrive from other people (stands in for the provider). */
export const REMOTE_ORIGIN = Symbol('test.remote');
/** Origin of updates applied when the board is loaded (story 4's stored state). */
export const LOAD_ORIGIN = Symbol('test.load');

export interface Peers {
  local: Y.Doc;
  remote: Y.Doc;
}

/** Two docs kept in sync synchronously; each side's own changes reach the other as remote updates. */
export function connectedPeers(): Peers {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  initDoc(local);
  local.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(remote, update, REMOTE_ORIGIN);
  });
  remote.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, update, REMOTE_ORIGIN);
  });
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  return { local, remote };
}

/** Applies a saved board state to `doc` the way loading does: with a non-local origin. */
export function loadInto(doc: Y.Doc, saved: Y.Doc): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(saved), LOAD_ORIGIN);
}
