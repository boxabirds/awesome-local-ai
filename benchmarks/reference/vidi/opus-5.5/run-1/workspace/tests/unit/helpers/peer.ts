/**
 * A simulated remote person for undo tests: a second real Y.Doc that exchanges every update
 * with the local doc, delivered with a non-local origin (as the y-websocket provider does).
 */
import * as Y from 'yjs';
import { LOAD_ORIGIN } from '../../../src/worker/board-store';

/** Origin of updates arriving from the other person (stands in for the provider). */
export const REMOTE_ORIGIN: unique symbol = Symbol('test.remote');

export interface Peer {
  /** The other person's copy of the board; change it with the board-model functions. */
  doc: Y.Doc;
  /** Stops exchanging updates. */
  disconnect(): void;
}

/** Links a new peer to `local`: both start identical and stay in sync synchronously. */
export function linkPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  const toPeer = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  };
  const toLocal = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, update, REMOTE_ORIGIN);
  };
  local.on('update', toPeer);
  doc.on('update', toLocal);
  return {
    doc,
    disconnect() {
      local.off('update', toPeer);
      doc.off('update', toLocal);
    },
  };
}

/** Applies `source`'s whole state to `target` the way story 4 loads a saved board. */
export function applyLoaded(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
}
