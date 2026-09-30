// A second real Y.Doc standing in for another person's tab (undo unit tests).
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

/** Origin of updates that arrive from the peer (like the provider's origin in the app). */
export const REMOTE_ORIGIN: unique symbol = Symbol('test-remote');

/**
 * Connects `local` to a new peer doc: every update on either side is applied to the
 * other at once, and the peer's updates arrive in `local` with REMOTE_ORIGIN.
 */
export function connectPeer(local: Y.Doc): { peer: Y.Doc; disconnect(): void } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  initDoc(peer);
  const toPeer = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(peer, update, REMOTE_ORIGIN);
  };
  const toLocal = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, update, REMOTE_ORIGIN);
  };
  local.on('update', toPeer);
  peer.on('update', toLocal);
  return {
    peer,
    disconnect() {
      local.off('update', toPeer);
      peer.off('update', toLocal);
    },
  };
}

/**
 * Stands in for story 4's LOAD_ORIGIN (src/worker/board-store.ts, not importable
 * here because it needs the Workers types): any origin other than LOCAL_ORIGIN.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** Applies `source`'s state to `target` as a story 4 load (LOAD_ORIGIN). */
export function loadInto(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
}
