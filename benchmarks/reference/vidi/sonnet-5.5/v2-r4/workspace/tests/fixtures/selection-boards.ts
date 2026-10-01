import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, moveObject } from '../../src/shared/board-model';

function note(doc: Y.Doc, text: string, centre: { x: number; y: number }) {
  const id = createSticky(doc, centre);
  getStickyText(doc, id)!.insert(0, text);
  return id;
}

/**
 * 20-note retro board in two clusters (world units, 200x200 notes):
 * S1..S6 form a 3x2 cluster (centres 260 apart, x -550..170, y -250..210); S7 is a lone note at x 350..550;
 * F1..F13 sit far away. Notes overlap nothing inside a cluster so geometry is easy to reason about.
 */
export function selectionBoard20(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const xs = [-450, -190, 70];
  const ys = [-150, 110];
  let n = 1;
  for (const y of ys) for (const x of xs) note(doc, `S${n++}`, { x, y });
  note(doc, 'S7', { x: 450, y: -150 });
  for (let i = 1; i <= 13; i++) note(doc, `F${i}`, { x: 5000 + (i % 5) * 260, y: Math.floor(i / 5) * 260 });
  return doc;
}

/** `groups` groups of `perGroup` notes in a row; group k spans world x = k*480-1000 .. +430, y -200..0. */
export function groupsBoard(groups: number, perGroup: number): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  for (let k = 0; k < groups; k++) {
    for (let i = 0; i < perGroup; i++) {
      const id = note(doc, `G${k}-${i}`, { x: k * 480 - 900 + i * 230, y: -100 });
      moveObject(doc, id, k * 480 - 1000 + i * 230, -200);
    }
  }
  return doc;
}
