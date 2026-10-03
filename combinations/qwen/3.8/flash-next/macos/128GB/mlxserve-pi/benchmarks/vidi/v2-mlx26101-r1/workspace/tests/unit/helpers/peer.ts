// A simulated remote peer for the undo.history unit tests.
//
// undo.own is entirely about transaction *origin*: the UndoController tracks only
// LOCAL_ORIGIN, so anything that arrives from another person (the provider's
// origin) or from a story-4 board load (LOAD_ORIGIN) must never enter this tab's
// undo stack. A mock cannot prove that — only a real second `Y.Doc` whose changes
// are applied locally with a *non-local* origin can. So this helper:
//
//   - makes a second real `Y.Doc`, syncs it with the local one both ways, and
//   - applies every remote update into the local doc with `PEER_ORIGIN`, and
//   - exposes `applyAsLoad` for the story-4 load origin (TC-03).
//
// The local doc's own writes already carry LOCAL_ORIGIN (the board model does
// that), and this helper never re-applies a local update back into the local doc,
// so the only origin the local UndoManager ever sees for a remote change is
// PEER_ORIGIN (or LOAD_ORIGIN) — exactly the real-world condition.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../../src/shared/board-model';

/**
 * The origin a story-3 provider would apply remote updates with. It is a
 * distinct object so it is *not* LOCAL_ORIGIN and the UndoManager must skip it.
 */
export const PEER_ORIGIN: unique symbol = Symbol('test-peer');

/**
 * The story-4 Durable-Object load origin (a copy of `LOAD_ORIGIN`'s meaning:
 * updates replayed from storage when a board is first read). Applied locally,
 * these represent "the board content loaded underneath me", which undo must
 * never offer to reverse.
 */
export const LOAD_ORIGIN_TEST: unique symbol = Symbol('test-load');

export interface Peer {
  /** The second, independent document. */
  readonly doc: Y.Doc;
  /** The `objects` map on the local doc, for convenience. */
  readonly objects: Y.Map<Y.Map<unknown>>;
  /** The matching map on the peer doc. */
  readonly peerObjects: Y.Map<Y.Map<unknown>>;
  /**
   * Flush any updates the local doc made since the peer was last caught up, so
   * the peer can then act on the same content. Call before the peer reads.
   */
  syncLocalToPeer(): void;
  /** Force every pending peer change into the local doc under PEER_ORIGIN. */
  syncPeerToLocal(): void;
  /** Run `fn` on the peer doc, then propagate the result to the local doc. */
  edit(fn: (peer: Y.Doc) => void): void;
  /** Run `fn` and apply its updates into the local doc with the LOAD origin. */
  applyAsLoad(fn: (peer: Y.Doc) => void): void;
}

/**
 * Wire a peer document to `doc`. Local→peer and peer→local updates are applied
 * by hand rather than automatically, so a test controls exactly when a remote
 * change lands and under which origin — origin is what undo.history is testing.
 */
export function createPeer(doc: Y.Doc): Peer {
  const peer = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const peerObjects = peer.getMap<Y.Map<unknown>>('objects');

  // Buffer the peer's updates; a test drains them with an explicit origin. This
  // is the only path that feeds a remote change into the local doc, which is
  // what keeps PEER_ORIGIN distinct from LOCAL_ORIGIN in the tests.
  let pending: Uint8Array[] = [];
  peer.on('update', (update: Uint8Array) => {
    pending.push(update);
  });

  const drainInto = (origin: unknown): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const u of batch) Y.applyUpdate(doc, u, origin);
  };

  // Keep the peer initialised to the local doc's current state so it can accept
  // edits against the notes the local tab created.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

  return {
    doc: peer,
    objects,
    peerObjects,
    syncLocalToPeer(): void {
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    },
    syncPeerToLocal(): void {
      drainInto(PEER_ORIGIN);
    },
    edit(fn: (d: Y.Doc) => void): void {
      fn(peer);
      drainInto(PEER_ORIGIN);
    },
    applyAsLoad(fn: (d: Y.Doc) => void): void {
      fn(peer);
      drainInto(LOAD_ORIGIN_TEST);
    },
  };
}

/**
 * Create a note directly on a doc (the peer's own copy) so the peer's changes do
 * not depend on a local controller capturing anything. Mirrors the sticky schema.
 */
export function peerCreateSticky(
  peer: Y.Doc,
  id: string,
  x: number,
  y: number,
  opts: { color?: string; text?: string } = {},
): Y.Map<unknown> {
  const objects = peer.getMap<Y.Map<unknown>>('objects');
  peer.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', x);
    note.set('y', y);
    note.set('color', opts.color ?? 'yellow');
    note.set('text', new Y.Text(opts.text ?? ''));
    note.set('z', 1);
    note.set('createdAt', 0);
    objects.set(id, note);
  });
  return objects.get(id)!;
}

export { LOCAL_ORIGIN };
