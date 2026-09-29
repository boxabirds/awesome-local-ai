/**
 * Story 8 (undo.history): a simulated remote peer for unit tests.
 *
 * `createPeer(localDoc)` returns a second REAL Y.Doc that exchanges updates
 * with `localDoc` in both directions. Every change the peer makes is applied
 * to the local doc with `PEER_ORIGIN` (never `LOCAL_ORIGIN`), exactly like
 * the story 3 provider delivers remote updates — so a local UndoManager that
 * tracks `LOCAL_ORIGIN` only must never capture peer changes.
 *
 * `loadFrom(serverDoc)` simulates the story 4 initial load: the server's
 * state is applied to the local doc with `LOAD_ORIGIN` (a non-local origin,
 * as with the real provider).
 */
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD } from 'src/shared/config';

/** Origin of the simulated remote peer's updates. */
export const PEER_ORIGIN = Symbol('vidi6-peer-origin');
/** Origin of story 4 load updates (the server is the source). */
export const LOAD_ORIGIN = Symbol('vidi6-load-origin');

export interface Peer {
  /** The peer's real Y.Doc. */
  doc: Y.Doc;
  /** Create a sticky note on the peer's doc (synced to the local doc). */
  createSticky(id: string, at: { x: number; y: number }, color?: string): void;
  /** Move a note on the peer's doc. */
  moveObject(id: string, x: number, y: number): void;
  /** Recolour a note on the peer's doc. */
  setStickyColor(id: string, color: string): void;
  /** Delete a note on the peer's doc. */
  deleteObject(id: string): void;
  /** Insert text into a note's Y.Text on the peer's doc. */
  insertText(id: string, text: string): void;
  /**
   * Apply the state of `serverDoc` to the local doc with the story 4 LOAD
   * origin (non-local, like the real provider).
   */
  loadFrom(serverDoc: Y.Doc): void;
}

export function createPeer(localDoc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();

  // Bidirectional relay: an update on one doc is applied to the other with
  // PEER_ORIGIN. Applying an update that only contains already-known items is
  // a no-op in Yjs (no change → no further 'update' event), so the relay
  // terminates instead of pinging forever.
  const relay = (from: Y.Doc, to: Y.Doc): void => {
    from.on('update', (update: Uint8Array) => {
      Y.applyUpdate(to, update, PEER_ORIGIN);
    });
  };
  relay(localDoc, peerDoc);
  relay(peerDoc, localDoc);

  const objects = (): Y.Map<Y.Map<unknown>> => peerDoc.getMap('objects');
  const obj = (id: string): Y.Map<unknown> | undefined => {
    const o = objects().get(id);
    return o instanceof Y.Map ? o : undefined;
  };

  return {
    doc: peerDoc,
    createSticky(id, at, color = 'yellow') {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', at.x - STICKY_SIZE_WORLD / 2);
      note.set('y', at.y - STICKY_SIZE_WORLD / 2);
      note.set('color', color);
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      peerDoc.transact(() => {
        objects().set(id, note);
      }, PEER_ORIGIN);
    },
    moveObject(id, x, y) {
      const o = obj(id);
      if (!o) return;
      peerDoc.transact(() => {
        o.set('x', x);
        o.set('y', y);
      }, PEER_ORIGIN);
    },
    setStickyColor(id, color) {
      const o = obj(id);
      if (!o) return;
      peerDoc.transact(() => {
        o.set('color', color);
      }, PEER_ORIGIN);
    },
    deleteObject(id) {
      peerDoc.transact(() => {
        objects().delete(id);
      }, PEER_ORIGIN);
    },
    insertText(id, text) {
      const o = obj(id);
      const t = o?.get('text');
      if (!(t instanceof Y.Text)) return;
      peerDoc.transact(() => {
        t.insert(0, text);
      }, PEER_ORIGIN);
    },
    loadFrom(serverDoc) {
      const update = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(localDoc, update, LOAD_ORIGIN);
    },
  };
}
