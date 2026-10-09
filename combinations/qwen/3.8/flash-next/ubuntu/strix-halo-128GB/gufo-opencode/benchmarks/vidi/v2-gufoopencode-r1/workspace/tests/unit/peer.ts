import * as Y from 'yjs';

// Story 4 replays persisted updates on load; like the provider, that origin is
// never LOCAL_ORIGIN, so the undo manager must ignore it.
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-test-load');
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-test-peer');

// Wire two real docs like a sync provider would: every local update is applied
// to the other doc under PEER_ORIGIN. Guarding on PEER_ORIGIN stops echoes.
export function linkPeers(local: Y.Doc, peer: Y.Doc): () => void {
  const forward =
    (target: Y.Doc) =>
    (update: Uint8Array, origin: unknown): void => {
      if (origin === PEER_ORIGIN) return;
      target.transact(() => Y.applyUpdate(target, update), PEER_ORIGIN);
    };
  const onLocal = forward(peer);
  const onPeer = forward(local);
  local.on('update', onLocal);
  peer.on('update', onPeer);
  peer.transact(() => Y.applyUpdate(peer, Y.encodeStateAsUpdate(local)), PEER_ORIGIN);
  return () => {
    local.off('update', onLocal);
    peer.off('update', onPeer);
  };
}

export function applyAsLoad(doc: Y.Doc, update: Uint8Array): void {
  doc.transact(() => Y.applyUpdate(doc, update), LOAD_ORIGIN);
}

export function encode(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
