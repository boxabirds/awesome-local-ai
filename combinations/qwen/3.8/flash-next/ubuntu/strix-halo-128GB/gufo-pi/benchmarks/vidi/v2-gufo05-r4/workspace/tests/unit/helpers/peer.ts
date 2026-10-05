/**
 * A second, real `Y.Doc` standing in for another person's browser, for the undo
 * unit tests.
 *
 * The peer edits its own document and the change is pushed into the local one the
 * way the network provider pushes a remote change: as an `applyUpdate` whose origin
 * is *not* `LOCAL_ORIGIN`. That origin is the whole point — it is what makes the
 * peer's change invisible to the local undo controller, so a test can prove that
 * undo reverses only your own work and never a colleague's (`undo.own`).
 *
 * `applyAsLoad` is the other untracked origin: story 4 opens a board by applying its
 * stored state under `LOAD_ORIGIN`, which likewise must not become undoable.
 */

import * as Y from 'yjs';
import { createSticky, initDoc, LOCAL_ORIGIN, setStickyColor } from '../../../src/shared/board-model';
import { LOAD_ORIGIN } from '../../../src/worker/board-store';

/** The origin a `WebsocketProvider` applies a remote update under — not ours. */
export const PROVIDER_ORIGIN: unique symbol = Symbol('vidi6-test-provider');

export interface Peer {
  readonly doc: Y.Doc;
  /** Make a change on the peer's own document and sync it into `local` as a remote change. */
  change<T>(fn: (peer: Y.Doc) => T): T;
  /** Convenience: the peer creates a note at a point and returns its id. */
  createSticky(x: number, y: number): string;
  /** Convenience: the peer recolours an existing note. */
  recolor(id: string, color: Parameters<typeof setStickyColor>[2]): boolean;
}

/**
 * A peer that shares `local`'s content. The two documents are kept in sync in both
 * directions; every update travels with a non-local origin, so neither document
 * captures the other's work in its own undo history.
 */
export function connectPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  // Bring the peer up to date with what the local document already holds, then wire a
  // two-way relay with non-local origins in both directions.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), PROVIDER_ORIGIN);

  const relayPeerToLocal = (update: Uint8Array) => Y.applyUpdate(local, update, PROVIDER_ORIGIN);
  const relayLocalToPeer = (update: Uint8Array, origin: unknown) => {
    // Do not bounce the peer's own updates back, and do not let a local undo write
    // re-enter as a tracked change on the peer either.
    if (origin === PROVIDER_ORIGIN) return;
    Y.applyUpdate(peer, update, PROVIDER_ORIGIN);
  };
  peer.on('update', relayPeerToLocal);
  local.on('update', (_update: Uint8Array, origin: unknown) => relayLocalToPeer(_update, origin));

  return {
    doc: peer,
    change<T>(fn: (peerDoc: Y.Doc) => T): T {
      const result = fn(peer);
      return result;
    },
    createSticky(x: number, y: number): string {
      return createSticky(peer, { x, y });
    },
    recolor(id: string, color: Parameters<typeof setStickyColor>[2]): boolean {
      return setStickyColor(peer, id, color);
    }
  };
}

/** Apply `update` to `doc` under story 4's load origin (a board being opened). */
export function applyAsLoad(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

/** Re-exported so a test can build a fresh initialised document. */
export function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

export { LOCAL_ORIGIN };
