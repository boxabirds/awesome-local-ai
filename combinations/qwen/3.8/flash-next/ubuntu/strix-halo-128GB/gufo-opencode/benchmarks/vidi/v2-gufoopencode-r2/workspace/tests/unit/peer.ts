// Shared helper for story 8 undo unit tests: a simulated remote peer and the
// story 4 load origin. The peer is a second real Y.Doc exchanging updates
// with the local doc. Updates are applied to each side under PEER_ORIGIN —
// mirroring the y-websocket provider, which applies remote bytes with the
// provider instance as origin — so the local UndoManager (tracking
// LOCAL_ORIGIN only) never captures anything that came over the wire.

import * as Y from 'yjs';

// Non-local origin used for every cross-doc update application.
export const PEER_ORIGIN: unique symbol = Symbol('unit-peer');

// Mirrors the story 4 load origin in src/worker/board-store.ts (kept local so
// unit tests do not import from src/worker, which the main tsconfig excludes).
export const LOAD_ORIGIN: unique symbol = Symbol('unit-load');

export interface Peer {
  doc: Y.Doc;
  dispose(): void;
}

export function connectPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  const toPeer = (update: Uint8Array, origin: unknown): void => {
    if (origin === PEER_ORIGIN) return; // never echo wire bytes back
    Y.applyUpdate(peer, update, PEER_ORIGIN);
  };
  const toLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin === PEER_ORIGIN) return;
    Y.applyUpdate(local, update, PEER_ORIGIN);
  };
  local.on('update', toPeer);
  peer.on('update', toLocal);
  // Bidirectional initial sync, as a provider handshake would do.
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peer), PEER_ORIGIN);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), PEER_ORIGIN);
  return {
    doc: peer,
    dispose(): void {
      local.off('update', toPeer);
      peer.off('update', toLocal);
      peer.destroy();
    },
  };
}

// Applies a pre-encoded update to `doc` with the story 4 LOAD origin.
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
