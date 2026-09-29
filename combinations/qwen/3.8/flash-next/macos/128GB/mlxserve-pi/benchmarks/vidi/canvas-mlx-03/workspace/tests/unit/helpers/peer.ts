// A simulated remote collaborator for the undo unit tests (design Test Strategy:
// "a second real Y.Doc exchanging updates with the local doc using a non-local
// origin"). No mocks: two real documents that really sync with each other, in both
// directions, exactly as two browser tabs do — with one difference that is the
// whole point. Every update that lands in the *local* doc is applied with an
// origin that is not LOCAL_ORIGIN, because that is what the y-websocket provider
// does with anything a colleague sent. A controller that filters by origin
// therefore sees this peer the same way it sees a real collaborator.
//
// `applyWithLoadOrigin` is the other origin a change arrives with in production:
// story 4's Durable Object loading a saved board into a fresh document.

import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model.ts';
import { LOAD_ORIGIN } from '../../../src/worker/board-store.ts';
import type { StickyColor } from '../../../src/shared/config.ts';

/** The origin a colleague's updates are applied to the local doc with. */
export const PEER_ORIGIN: unique symbol = Symbol('vidi6-test-peer');

export interface Peer {
  /** The colleague's document; write to it with the ordinary model functions. */
  readonly doc: Y.Doc;
  stop(): void;
}

export interface PeerStickySeed {
  text: string;
  x: number;
  y: number;
  color?: StickyColor;
  width?: number;
  height?: number;
}

/**
 * Link a second document to `local` and keep both in step. Updates written by
 * `local` reach the peer as remote changes; updates written by the peer reach
 * `local` with {@link PEER_ORIGIN}, including the ones an undo produces.
 */
export function connectPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();

  const onLocal = (update: Uint8Array, origin: unknown) => {
    // Anything that arrived *from* the peer is skipped: forwarding it back would
    // be a conversation that never ends.
    if (origin === PEER_ORIGIN) return;
    Y.applyUpdate(peer, update, PEER_ORIGIN);
  };
  const onPeer = (update: Uint8Array) => {
    Y.applyUpdate(local, update, PEER_ORIGIN);
  };

  local.on('update', onLocal as (u: Uint8Array) => void);
  peer.on('update', onPeer);
  // The state the local doc already holds (schema, seeded notes) goes over first.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), PEER_ORIGIN);

  return {
    doc: peer,
    stop() {
      local.off('update', onLocal as (u: Uint8Array) => void);
      peer.off('update', onPeer);
      peer.destroy();
    },
  };
}

/** Apply `update` to `doc` the way story 4's server-side load does. */
export function applyWithLoadOrigin(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

/**
 * Create a note as the colleague. It is written with `LOCAL_ORIGIN` — on *their*
 * document, which is what their tab does — and reaches `peer.doc`'s changes to
 * the local doc as a remote update.
 */
export function addSticky(peer: Y.Doc, seed: PeerStickySeed): string {
  const id = createSticky(peer, { x: seed.x, y: seed.y }, seed.color);
  const obj = peer.getMap<Y.Map<unknown>>('objects').get(id)!;
  if (seed.width !== undefined) obj.set('width', seed.width);
  if (seed.height !== undefined) obj.set('height', seed.height);
  const text = getStickyText(peer, id);
  if (seed.text.length > 0 && text) text.insert(0, seed.text);
  return id;
}

/** Recolour a note as the colleague. */
export function setColor(peer: Y.Doc, id: string, color: StickyColor): boolean {
  return setStickyColor(peer, id, color);
}

/** Move a note as the colleague. */
export function move(peer: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObject(peer, id, x, y);
}

/** Delete a note as the colleague. */
export function remove(peer: Y.Doc, id: string): boolean {
  return deleteObject(peer, id);
}
