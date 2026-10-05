import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../src/shared/board-model';

/**
 * A second `Y.Doc` standing in for another person on the same board (story 8
 * unit tests), plus the load origin story 4 uses.
 *
 * The two documents exchange every update with the *peer doc* as transaction
 * origin: exactly what a network provider does, so the local doc sees a remote
 * change whose origin is neither {@link LOCAL_ORIGIN} nor `null` — which the undo
 * controller must ignore.
 */
export interface Peer {
  /** The local document the controller watches. */
  readonly doc: Y.Doc;
  /** The other person's document; write here to make a remote change. */
  readonly peer: Y.Doc;
  /** Objects map of the local document. */
  objects(doc?: Y.Doc): Y.Map<Y.Map<unknown>>;
  /** Stop syncing (the person closed their tab). */
  disconnect(): void;
}

export function withPeer(): Peer {
  const doc = new Y.Doc();
  const peer = new Y.Doc();
  // Handshake: both start from the same state.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

  const forwardToPeer = (update: Uint8Array, origin: unknown): void => {
    if (origin === peer) return;
    Y.applyUpdate(peer, update, doc);
  };
  const forwardToDoc = (update: Uint8Array, origin: unknown): void => {
    if (origin === doc) return;
    Y.applyUpdate(doc, update, peer);
  };
  doc.on('update', forwardToPeer);
  peer.on('update', forwardToDoc);

  return {
    doc,
    peer,
    objects: (target = doc) => target.getMap<Y.Map<unknown>>('objects'),
    disconnect() {
      doc.off('update', forwardToPeer);
      peer.off('update', forwardToDoc);
    },
  };
}

/**
 * A transaction origin for updates applied while the board is being loaded
 * (story 4: the provider hands the stored state to the doc). It is *not*
 * {@link LOCAL_ORIGIN}, so a load can never be undone.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/**
 * Apply `mutate` to `doc` as though the change came from the network: a
 * transaction whose origin is {@link LOAD_ORIGIN}.
 */
export function withLoadOrigin(doc: Y.Doc, mutate: () => void): void {
  doc.transact(mutate, LOAD_ORIGIN);
}

/** Apply `mutate` to `peer` in a transaction tagged with the given origin. */
export function withOrigin(doc: Y.Doc, origin: unknown, mutate: () => void): void {
  doc.transact(mutate, origin);
}
