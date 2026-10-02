/**
 * Test helper: a simulated remote peer exchanging updates with the local doc
 * using a non-local origin, plus a helper applying updates with the LOAD origin.
 */
import * as Y from 'yjs';

/** Arbitrary origin representing the websocket provider. */
export const PROVIDER_ORIGIN = Symbol('provider');

/** Arbitrary origin representing story 4 board load. */
export const LOAD_ORIGIN = Symbol('load');

export interface Peer {
  doc: Y.Doc;
  /** Sync local → peer and peer → local. Must be called after changes on either side. */
  sync(): void;
  /** Apply changes on the peer doc with PROVIDER_ORIGIN, then sync back. */
  applyOnPeer(fn: (doc: Y.Doc) => void): void;
  destroy(): void;
}

export function createPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();

  // Initial bidirectional sync
  const state1 = Y.encodeStateAsUpdate(local);
  const state2 = Y.encodeStateAsUpdate(peer);
  // Apply local state into peer with PROVIDER_ORIGIN
  peer.transact(() => Y.applyUpdate(peer, state1), PROVIDER_ORIGIN);
  // Apply peer state into local with PROVIDER_ORIGIN
  local.transact(() => Y.applyUpdate(local, state2), PROVIDER_ORIGIN);

  let syncing = false;

  function onLocalUpdate(update: Uint8Array, origin: unknown) {
    if (syncing) return;
    if (origin === PROVIDER_ORIGIN || origin === LOAD_ORIGIN) return;
    syncing = true;
    peer.transact(() => Y.applyUpdate(peer, update), PROVIDER_ORIGIN);
    syncing = false;
  }

  function onPeerUpdate(update: Uint8Array) {
    if (syncing) return;
    syncing = true;
    local.transact(() => Y.applyUpdate(local, update), PROVIDER_ORIGIN);
    syncing = false;
  }

  local.on('update', onLocalUpdate);
  peer.on('update', onPeerUpdate);

  return {
    doc: peer,
    sync() {
      // Force a full resync
      const s1 = Y.encodeStateAsUpdate(peer);
      local.transact(() => Y.applyUpdate(local, s1), PROVIDER_ORIGIN);
    },
    applyOnPeer(fn: (doc: Y.Doc) => void) {
      peer.transact(() => fn(peer), PROVIDER_ORIGIN);
      // Sync back to local
      const update = Y.encodeStateAsUpdate(peer);
      local.transact(() => Y.applyUpdate(local, update), PROVIDER_ORIGIN);
    },
    destroy() {
      local.off('update', onLocalUpdate);
      peer.off('update', onPeerUpdate);
      peer.destroy();
    },
  };
}

/** Apply changes to the local doc with LOAD_ORIGIN (story 4 initial load). */
export function applyWithLoadOrigin(doc: Y.Doc, fn: (doc: Y.Doc) => void): void {
  doc.transact(() => fn(doc), LOAD_ORIGIN);
}
