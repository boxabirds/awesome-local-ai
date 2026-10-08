import * as Y from 'yjs'
import { initDoc } from '../../src/shared/board-model'

/**
 * Origin used when a change is applied to the *local* doc as if it arrived
 * from another client (story 3 provider).  The UndoController tracks only
 * `LOCAL_ORIGIN`, so anything applied under these origins is never captured.
 */
export const REMOTE_ORIGIN: unique symbol = Symbol('remote-provider')

/** Origin used for story 4 load-time updates (applying the persisted log). */
export const LOAD_ORIGIN: unique symbol = Symbol('load')

/**
 * Link a second, real `Y.Doc` so a change authored on one appears on the other
 * with a non-local origin.  This models a remote peer without a server: the
 * local UndoController must ignore everything that reaches it through here.
 */
export interface PeerPair {
  local: Y.Doc
  peer: Y.Doc
  disconnect(): void
}

export function linkPeers(): PeerPair {
  const local = new Y.Doc()
  const peer = new Y.Doc()
  initDoc(local)
  initDoc(peer)

  const onLocal = (update: Uint8Array) => {
    Y.applyUpdate(peer, update, REMOTE_ORIGIN)
  }
  const onPeer = (update: Uint8Array) => {
    Y.applyUpdate(local, update, REMOTE_ORIGIN)
  }

  // Bring both docs to the same baseline, then forward every future change.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN)
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peer), REMOTE_ORIGIN)
  local.on('update', onLocal)
  peer.on('update', onPeer)

  return {
    local,
    peer,
    disconnect() {
      local.off('update', onLocal)
      peer.off('update', onPeer)
    },
  }
}

/**
 * Apply `update` to `doc` under {@link LOAD_ORIGIN} (story 4 load path), which
 * the UndoController must also ignore.
 */
export function applyLoad(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN)
}