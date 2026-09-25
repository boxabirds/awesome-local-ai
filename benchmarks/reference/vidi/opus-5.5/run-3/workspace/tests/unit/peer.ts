// A simulated remote participant for undo tests: a second real Y.Doc whose changes reach the local doc with a
// non-local origin (as the websocket provider's do), and a helper applying updates like the story 4 load.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

/** Origin of updates arriving from the peer (stands in for the websocket provider). */
export const PEER_ORIGIN = Symbol('test.peer');
/** Origin of updates applied as a saved-board load (stands in for story 4's LOAD_ORIGIN). */
export const LOAD_ORIGIN = Symbol('test.load');

/** Two docs kept in sync synchronously in both directions. `local` is the doc under test. */
export function connectedPeer(local: Y.Doc = new Y.Doc()): { local: Y.Doc; peer: Y.Doc; disconnect(): void } {
  const peer = new Y.Doc();
  initDoc(local);
  const fromLocal = Symbol('test.from-local');
  const toPeer = (update: Uint8Array, origin: unknown) => {
    if (origin !== PEER_ORIGIN) Y.applyUpdate(peer, update, fromLocal);
  };
  const toLocal = (update: Uint8Array, origin: unknown) => {
    if (origin !== fromLocal) Y.applyUpdate(local, update, PEER_ORIGIN);
  };
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), fromLocal);
  local.on('update', toPeer);
  peer.on('update', toLocal);
  return {
    local,
    peer,
    disconnect() {
      local.off('update', toPeer);
      peer.off('update', toLocal);
    },
  };
}

/** Applies everything `source` holds to `target` with the load origin, as opening a saved board does. */
export function loadInto(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
}
