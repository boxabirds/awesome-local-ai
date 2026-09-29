// A simulated remote participant for undo tests: a second real Y.Doc whose updates reach the
// local doc with a non-local origin (as the sync provider's do), and back.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

/** Origin used for updates received from the peer (stands in for the websocket provider). */
export const REMOTE_ORIGIN = Symbol('test.remote');
/** Stands in for story 4's load origin: content arriving from the saved board. */
export const LOAD_ORIGIN = Symbol('test.load');

export interface Peer {
  local: Y.Doc;
  remote: Y.Doc;
  /** Stops exchanging updates. */
  disconnect(): void;
}

/** Two docs kept in sync: `local` (the tab under test) and `remote` (another person). */
export function connectedPeers(): Peer {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  initDoc(local);
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  const toRemote = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(remote, update, REMOTE_ORIGIN);
  };
  const toLocal = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, update, REMOTE_ORIGIN);
  };
  local.on('update', toRemote);
  remote.on('update', toLocal);
  return {
    local,
    remote,
    disconnect() {
      local.off('update', toRemote);
      remote.off('update', toLocal);
    },
  };
}

/** Applies `source`'s whole state to `target` as a board load would. */
export function loadInto(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
}
