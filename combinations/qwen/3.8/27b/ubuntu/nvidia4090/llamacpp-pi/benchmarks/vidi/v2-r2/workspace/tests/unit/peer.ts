/**
 * Story 8 test helper: simulates a remote peer (and story 4's load path)
 * against a local Y.Doc using real, connected Y.Docs.
 *
 * - `connectPeer` attaches a second real Y.Doc and mirrors every update both
 *   ways. Updates that reach the LOCAL doc from the peer are always applied
 *   with PEER_ORIGIN — never LOCAL_ORIGIN — exactly like remote updates
 *   arriving through the y-websocket provider.
 * - `applyAsLoad` applies an encoded board state to the local doc under a
 *   dedicated LOAD_ORIGIN, mirroring story 4's room load
 *   (persist.load_origin): those updates must never enter undo history.
 *
 * The peer's convenience methods use the shared board-model functions on the
 * peer doc (LOCAL_ORIGIN on the peer side is irrelevant — what matters is
 * the origin updates carry when they reach the local doc).
 */
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  moveObjects,
  setStickyColor,
  snapshotAll,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';

/** Origin for every update the peer applies to the local doc (never local). */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6.test-peer-origin');

/** Origin standing in for story 4's load origin (never local). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.test-load-origin');

export interface Peer {
  /** The peer's own Y.Doc. */
  readonly peerDoc: Y.Doc;
  /** Apply `fn` to the peer doc (one transaction); the update reaches the local doc remotely. */
  mutate(fn: (txn: Y.Transaction) => void): void;
  createSticky(at: { x: number; y: number }, color?: StickyColor): string;
  recolor(id: string, color: string): void;
  move(id: string, to: { x: number; y: number }): void;
  deleteNote(id: string): void;
  /** Append to a note's text on the peer side (remote edit). */
  appendText(id: string, text: string): void;
  text(id: string): string;
  snapshot(): readonly ObjectSnapshot[];
  dispose(): void;
}

/**
 * Connect a simulated peer to `doc`. `doc` must already exist; any current
 * state is exchanged first.
 */
export function connectPeer(doc: Y.Doc): Peer {
  const peerDoc = new Y.Doc();

  // Direction is determined by which doc emitted the update, not by origin:
  // local -> peer and peer -> local both apply under PEER_ORIGIN on the
  // receiving side. Re-applying an already-known update is a no-op in Yjs
  // (no change, no 'update' event), so this cannot loop.
  const onPeerUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(doc, update, PEER_ORIGIN);
  };
  const onLocalUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(peerDoc, update, PEER_ORIGIN);
  };

  peerDoc.on('update', onPeerUpdate);
  doc.on('update', onLocalUpdate);
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(doc), PEER_ORIGIN);

  return {
    peerDoc,
    mutate: (fn): void => {
      peerDoc.transact(fn, PEER_ORIGIN);
    },
    createSticky: (at, color): string => createSticky(peerDoc, at, color),
    recolor: (id, color): void => {
      setStickyColor(peerDoc, id, color);
    },
    move: (id, to): void => {
      moveObjects(peerDoc, new Map([[id, to]]));
    },
    deleteNote: (id): void => {
      deleteObjects(peerDoc, [id]);
    },
    appendText: (id, text): void => {
      const t = getStickyText(peerDoc, id);
      if (t !== undefined) {
        t.insert(t.length, text);
      }
    },
    text: (id): string => getStickyText(peerDoc, id)?.toString() ?? '',
    snapshot: (): readonly ObjectSnapshot[] => snapshotAll(peerDoc),
    dispose: (): void => {
      peerDoc.off('update', onPeerUpdate);
      doc.off('update', onLocalUpdate);
      peerDoc.destroy();
    },
  };
}

/**
 * Apply an encoded board state to `doc` under the load origin — the same
 * shape as story 4's room load (persist.load_origin).
 */
export function applyAsLoad(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
