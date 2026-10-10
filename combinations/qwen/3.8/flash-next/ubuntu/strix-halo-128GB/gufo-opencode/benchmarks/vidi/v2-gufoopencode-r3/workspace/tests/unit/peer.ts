import * as Y from 'yjs';

// Origin for everything arriving from the simulated peer: never LOCAL_ORIGIN,
// so a local UndoManager tracking LOCAL_ORIGIN cannot capture it.
export const REMOTE_ORIGIN: unique symbol = Symbol('test-remote-peer');

// Stand-in for src/worker/board-store's LOAD_ORIGIN (importing it there would
// pull the worker's Cloudflare types into the client typecheck). The undo
// controller only distinguishes LOCAL_ORIGIN from everything else, and the
// real storage load path is covered end to end (undo.spec.ts TC-24).
const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export interface Peer {
  doc: Y.Doc;
  destroy(): void;
}

// A second real Y.Doc wired to the local doc the way two browsers are wired
// through a room: each side's own changes are applied on the other side with
// REMOTE_ORIGIN, and remote changes are never echoed back.
export function createPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  const offLocal = relay(local, doc);
  const offPeer = relay(doc, local);
  Y.applyUpdate(local, Y.encodeStateAsUpdate(doc), REMOTE_ORIGIN);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  return {
    doc,
    destroy(): void {
      offLocal();
      offPeer();
      doc.destroy();
    }
  };
}

function relay(from: Y.Doc, to: Y.Doc): () => void {
  const handler = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return;
    Y.applyUpdate(to, update, REMOTE_ORIGIN);
  };
  from.on('update', handler);
  return () => from.off('update', handler);
}

// Story 4 load path: updates pulled from storage are applied with LOAD_ORIGIN.
export function applyAsLoadUpdate(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), LOAD_ORIGIN);
}
