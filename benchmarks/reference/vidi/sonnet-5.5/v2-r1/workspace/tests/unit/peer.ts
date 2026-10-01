import * as Y from 'yjs';

export const REMOTE_ORIGIN = Symbol('remote');
export const LOAD_ORIGIN = Symbol('load');

/** A second real Y.Doc kept in sync with `local`; its updates reach `local` with a non-local origin. */
export function connectPeer(local: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), 'sync');
  local.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(peer, u, REMOTE_ORIGIN);
  });
  peer.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) Y.applyUpdate(local, u, REMOTE_ORIGIN);
  });
  return peer;
}

export function applyAsLoad(doc: Y.Doc, from: Y.Doc): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(from), LOAD_ORIGIN);
}
