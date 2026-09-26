// Test-only peer model for the undo unit tests.
//
// A second, real Y.Doc exchanging updates with the local doc, applied with a
// NON-local origin (so they never enter the local UndoController's stacks, just
// like the real y-websocket provider applies remote updates). No mocks: the
// docs are real and share state through real update logs.

import * as Y from 'yjs';

/** Origin used for a change that came from another person (never tracked). */
export const PEER_ORIGIN = Symbol('peer');

/** Story-4 board-load origin: updates replayed from storage on a fresh tab. */
export const LOAD_ORIGIN = Symbol('load');

/** Bind two docs so an update made in one (with a local origin) is applied in
 * the other under `PEER_ORIGIN`, in both directions. Relayed updates are
 * applied with `PEER_ORIGIN` and are not echoed back. */
export function linkPeers(a: Y.Doc, b: Y.Doc): () => void {
  const forward = (from: Y.Doc, to: Y.Doc) => {
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === PEER_ORIGIN || origin === LOAD_ORIGIN) return; // already relayed
      Y.applyUpdate(to, update, PEER_ORIGIN);
    };
    from.on('update', handler);
    return () => from.off('update', handler);
  };
  const offA = forward(a, b);
  const offB = forward(b, a);
  return () => {
    offA();
    offB();
  };
}

/** The id under which a note lives in the objects map. */
function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Seed a note in `doc` from a plain description, applied under `origin` so it
 * looks like it arrived from elsewhere (or from a load). */
export function remoteSeedSticky(
  doc: Y.Doc,
  id: string,
  at: { x: number; y: number },
  opts: { color?: string; text?: string; z?: number } = {},
  origin: unknown = PEER_ORIGIN,
): void {
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x);
    note.set('y', at.y);
    note.set('color', opts.color ?? 'yellow');
    const text = new Y.Text(opts.text ?? '');
    note.set('text', text);
    note.set('z', opts.z ?? 1);
    note.set('createdAt', 0);
    objects(doc).set(id, note);
  }, origin);
}

/** Apply a peer change to a note's colour, under `origin` (non-local). */
export function remoteSetColor(
  doc: Y.Doc,
  id: string,
  color: string,
  origin: unknown = PEER_ORIGIN,
): void {
  const note = objects(doc).get(id);
  if (!note) return;
  doc.transact(() => {
    note.set('color', color);
  }, origin);
}

/** Apply a peer delete of a note, under `origin` (non-local). */
export function remoteDelete(doc: Y.Doc, id: string, origin: unknown = PEER_ORIGIN): void {
  doc.transact(() => {
    objects(doc).delete(id);
  }, origin);
}

/** Apply a peer edit of a note's text, under `origin` (non-local). */
export function remoteEditText(
  doc: Y.Doc,
  id: string,
  text: string,
  origin: unknown = PEER_ORIGIN,
): void {
  const note = objects(doc).get(id);
  if (!note) return;
  const ytext = note.get('text') as Y.Text | undefined;
  if (!ytext) return;
  doc.transact(() => {
    ytext.insert(0, text);
  }, origin);
}
