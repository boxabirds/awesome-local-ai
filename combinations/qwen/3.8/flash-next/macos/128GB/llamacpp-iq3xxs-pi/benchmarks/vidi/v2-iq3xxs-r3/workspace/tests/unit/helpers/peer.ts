/**
 * A second document that behaves like another person's tab
 * (`tests/unit` only).
 *
 * Story 3's point is that a change from the room is *the same content* arriving
 * through a different door: `y-websocket` applies what the room sent with the
 * provider as the transaction origin, never with `LOCAL_ORIGIN` and never with
 * `null`. A second `Y.Doc` exchanging updates that way gives the undo tests
 * remote changes they can be sure about — no server, no sockets, no timing:
 * when this helper says a note exists on both sides, it exists, and the only
 * thing that differs is which door it came in through.
 */

import * as Y from 'yjs';

import { initDoc } from '../../../src/shared/board-model';

/**
 * The mark a change carries when it arrived from somebody else — one origin for
 * both directions, exactly as y-websocket uses one provider for the wire.
 */
export const PEER_ORIGIN: unique symbol = Symbol('test.peer');

/** Re-exported so a test can say "story 4's door" without reaching into the worker. */
export { LOAD_ORIGIN } from '../../../src/worker/board-store';

/** Another person's document, holding the same board schema. */
export function peerDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * Put two documents in the same room, both from now on.
 *
 * Each side's own work (written with `LOCAL_ORIGIN`, or with none) is forwarded
 * to the other marked as something that came in from outside, and updates that
 * came in from outside are never sent back out — which is both how a real client
 * avoids an echo and why applying an update that is already known costs nothing.
 * The initial exchange is what a socket does on connect: each side is handed
 * what it did not have yet.
 */
export function link(a: Y.Doc, b: Y.Doc): void {
  const forward = (from: Y.Doc, to: Y.Doc): void => {
    from.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === PEER_ORIGIN) return;
      Y.applyUpdate(to, update, PEER_ORIGIN);
    });
  };
  forward(a, b);
  forward(b, a);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), PEER_ORIGIN);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), PEER_ORIGIN);
}

/**
 * A board, another person, and the two of them in a room together.
 * `peer` is what a collaborator's tab would write into with their own toolbar.
 */
export function withPeer(): { readonly local: Y.Doc; readonly peer: Y.Doc } {
  const local = new Y.Doc();
  initDoc(local);
  const peer = peerDoc();
  link(local, peer);
  return { local, peer };
}

/**
 * Apply `source`'s whole state to `target` with `origin` — the door story 4's
 * board load comes through, and the reason its rows are nobody's to undo.
 */
export function applyWithOrigin(target: Y.Doc, source: Y.Doc, origin: unknown): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), origin);
}

/**
 * What the two sides hold, as the ids of their objects and the fields a test
 * cares about: everything undo must not have mixed up is visible here.
 */
export function boardState(doc: Y.Doc): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const rows: string[] = [];
  for (const [id, entry] of objects) {
    const cells: string[] = [id];
    entry.forEach((value: unknown, key: string) => {
      cells.push(`${key}=${value instanceof Y.Text ? JSON.stringify(value.toString()) : String(value)}`);
    });
    rows.push(cells.sort().join('|'));
  }
  return rows.sort().join('\n');
}

/** Do the two documents hold the same board, field for field? */
export function sameBoard(a: Y.Doc, b: Y.Doc): boolean {
  return boardState(a) === boardState(b);
}

