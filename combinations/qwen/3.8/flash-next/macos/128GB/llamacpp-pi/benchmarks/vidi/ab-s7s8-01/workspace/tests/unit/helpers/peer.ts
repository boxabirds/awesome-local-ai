// Story 8 unit tests — a second real Y.Doc playing "someone else".
//
// Design rule (TC-01..TC-03): remote changes must arrive through an ordinary
// Y.Doc update, applied with a NON-local origin — exactly what y-websocket
// (story 3) and story 4's load path do — instead of poking anything about the
// product code. Peer writes run on the peer doc with the real board model, so
// after the update exchange the local doc cannot tell them apart from a real
// collaborator's transactions.

import * as Y from 'yjs';
import { initDoc } from '../../../src/shared/board-model';

/** Origin used when applying remote updates locally — deliberately not
 * LOCAL_ORIGIN, so the undo controller ignores those transactions. */
export const PEER_ORIGIN = Symbol('test.peer');

/** Mirror of story 4's server-side load origin: a local update that is not a
 * user action (TC-03). */
export const LOAD_ORIGIN = Symbol('test.load');

export interface Peer {
  readonly doc: Y.Doc;
  /** Flush pending updates so both docs are in sync. Yjs update events are
   * synchronous, so this only exists for readability of the tests. */
  sync(): void;
  destroy(): void;
}

/** A second real Y.Doc exchanging updates with `localDoc`, every applied
 * update carrying a non-local origin.
 *
 * Like a real provider, the join starts with a FULL state exchange — yjs
 * updates are per-client contiguous clock segments, and a doc that joined
 * after `initDoc` would otherwise buffer (and effectively lose) every later
 * segment. Only the relay needs to be delta-based. */
export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc), PEER_ORIGIN);
  Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc), PEER_ORIGIN);
  const onLocal = (update: Uint8Array, origin: unknown) => {
    if (origin !== PEER_ORIGIN) Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
  };
  const onPeer = (update: Uint8Array) => {
    Y.applyUpdate(localDoc, update, PEER_ORIGIN);
  };
  localDoc.on('update', onLocal);
  peerDoc.on('update', onPeer);
  return {
    doc: peerDoc,
    sync() {
      /* exchanges happen synchronously in the update handlers above */
    },
    destroy() {
      localDoc.off('update', onLocal);
      peerDoc.off('update', onPeer);
      peerDoc.destroy();
    },
  };
}

/** Apply `update` to `doc` with the load origin (story 4's board-load path). */
export function applyWithLoadOrigin(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

/** A full state update for a doc holding `n` minimal sticky maps — the bytes
 * a story 4 load would apply (applied with LOAD_ORIGIN in TC-03). */
export function makeUpdateWithStickies(n: number): Uint8Array {
  const scratch = new Y.Doc();
  initDoc(scratch);
  const objects = scratch.getMap<Y.Map<unknown>>('objects');
  for (let i = 0; i < n; i++) {
    objects.set(`fixture-${i}`, new Y.Map<unknown>([['type', 'sticky'], ['x', i * 100], ['y', 0], ['z', i]]));
  }
  const update = Y.encodeStateAsUpdate(scratch);
  scratch.destroy();
  return update;
}
