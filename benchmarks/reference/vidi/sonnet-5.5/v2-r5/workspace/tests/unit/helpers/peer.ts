import * as Y from 'yjs';
import { initDoc } from '../../../src/shared/board-model';
import { LOAD_ORIGIN } from '../../../src/worker/board-store';

export const REMOTE_ORIGIN = Symbol('remote');

/** A second real doc exchanging updates with `local` under a non-local origin (simulates the provider). */
export function connectPeer(local: Y.Doc, origin: unknown = REMOTE_ORIGIN): Y.Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), 'sync');
  local.on('update', (u: Uint8Array, o: unknown) => { if (o !== origin) Y.applyUpdate(peer, u, 'sync'); });
  peer.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'sync') Y.applyUpdate(local, u, origin); });
  return peer;
}

/** Applies `source`'s whole state to `target` the way story 4's load does. */
export function applyAsLoad(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
}

export function newBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}
