/**
 * Another person, for unit tests.
 *
 * Story 8 is a story about who made a change, and nothing tests that as honestly as a
 * second real document exchanging updates with the first: the change arrives over a
 * socket-shaped path with the peer's origin, exactly as it does in the browser, so the
 * undo controller has to work it out for itself rather than be told.
 *
 * Two origins matter here and neither is the app's local one:
 *
 * - `REMOTE_ORIGIN` is what an update from the peer is applied with, standing in for the
 *   WebSocket provider in `y-websocket`. Anything applied with it is somebody else's work.
 * - `LOAD_ORIGIN` stands in for the worker reading a board out of durable storage
 *   (story 4's own origin, `board-store.ts`). A board read back this way contains changes
 *   this tab "made" in a previous session, and must not offer them for undo.
 *
 * The relay is synchronous — `Y.applyUpdate` is — so a test can write on one side and
 * read the result on the other with no waiting.
 */
import * as Y from 'yjs';

import { STICKY_TYPE } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** The origin a peer's updates are applied with locally. */
export const REMOTE_ORIGIN = Symbol('remote-peer');

/**
 * The origin the relay itself writes with. It marks "this document already has that",
 * which is what stops the two sides echoing one update back and forth for ever.
 */
const RELAY = Symbol('relay');

/** The origin of a board read back out of storage (story 4). */
export const LOAD_ORIGIN = Symbol('storage-load');

export interface Peer {
  /** The other person's document. */
  readonly doc: Y.Doc;
  /** Make a change on their side; it reaches the local document immediately. */
  transact(fn: () => void): void;
  /** Stop relaying, and throw the peer away. */
  destroy(): void;
}

/**
 * Keep two documents in step, both ways, and say who each change came from.
 *
 * `originFromA` tags every update as it is applied into `b`, and `originFromB` every update
 * as it is applied into `a`. Those tags are also what stops the echo: an update that
 * arrived in `a` already carrying `originFromB` came from `b`, so it is not sent back.
 * Without that rule a naive relay bounces one update between the two documents forever,
 * which is the first thing a relay gets wrong.
 *
 * Returns the function that unlinks them.
 */
export function linkDocs(
  a: Y.Doc,
  b: Y.Doc,
  originFromA: unknown,
  originFromB: unknown,
): () => void {
  const fromA = (update: Uint8Array, origin: unknown) => {
    if (origin === originFromB) return;
    Y.applyUpdate(b, update, originFromA);
  };
  const fromB = (update: Uint8Array, origin: unknown) => {
    if (origin === originFromA) return;
    Y.applyUpdate(a, update, originFromB);
  };
  a.on('update', fromA);
  b.on('update', fromB);
  // Whatever `a` already holds is where `b` starts.
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), originFromA);
  return () => {
    a.off('update', fromA);
    b.off('update', fromB);
  };
}

/**
 * Join a second document to `local`, both ways.
 *
 * The peer's updates arrive with `origin` (the remote origin by default), so they are
 * never anything this document's undo history is watching for.
 */
export function connectPeer(local: Y.Doc, origin: unknown = REMOTE_ORIGIN): Peer {
  const peer = new Y.Doc();
  const unlink = linkDocs(local, peer, RELAY, origin);

  return {
    doc: peer,
    transact(fn: () => void) {
      peer.transact(fn);
    },
    destroy() {
      unlink();
      peer.destroy();
    },
  };
}

/**
 * A board snapshot from storage, applied to `local` with the load origin.
 *
 * `update` is normally taken from a throwaway document holding the board as it was saved.
 */
export function loadInto(local: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(local, update, LOAD_ORIGIN);
}

/**
 * The update a test can hand to `loadInto`: a document holding the given notes, as the
 * storage layer would have them.
 */
export function savedBoard(notes: { id: string; x: number; y: number }[]): Uint8Array {
  const saved = new Y.Doc();
  const objects = saved.getMap('objects');
  saved.transact(() => {
    notes.forEach((note, index) => {
      const entry = new Y.Map<unknown>();
      entry.set('type', STICKY_TYPE);
      entry.set('x', note.x);
      entry.set('y', note.y);
      entry.set('width', STICKY_SIZE_WORLD);
      entry.set('height', STICKY_SIZE_WORLD);
      entry.set('color', DEFAULT_STICKY_COLOR);
      entry.set('z', index + 1);
      entry.set('createdAt', 0);
      entry.set('text', new Y.Text(''));
      objects.set(note.id, entry);
    });
  });
  const update = Y.encodeStateAsUpdate(saved);
  saved.destroy();
  return update;
}
