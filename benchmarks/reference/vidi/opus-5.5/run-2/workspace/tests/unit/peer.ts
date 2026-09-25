/**
 * A simulated remote participant for undo tests: a second real Y.Doc exchanging updates
 * with the local doc. Updates arrive with a non-local origin, like the y-websocket provider.
 */
import * as Y from 'yjs';

export const REMOTE_ORIGIN: unique symbol = Symbol('test.remote');
/**
 * Same shape as the worker's LOAD_ORIGIN (src/worker/board-store.ts), which cannot be
 * imported into the DOM-typed test build; any origin other than LOCAL_ORIGIN behaves alike.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export interface Peer {
  doc: Y.Doc;
  disconnect(): void;
}

/** Connects `local` to a new peer doc; both see each other's changes at once. */
export function connectPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  Y.applyUpdate(local, Y.encodeStateAsUpdate(doc), REMOTE_ORIGIN);
  const toPeer = (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(doc, u, REMOTE_ORIGIN);
  };
  const toLocal = (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, u, REMOTE_ORIGIN);
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

/** Applies a board built elsewhere to `doc` with the story 4 LOAD origin. */
export function applyLoaded(doc: Y.Doc, from: Y.Doc): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(from), LOAD_ORIGIN);
}
