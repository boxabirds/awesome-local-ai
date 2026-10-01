import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, setStickyColor } from '../../src/shared/board-model';

/**
 * Retro board with 18 notes in varied colours: C1..C8 form a 4x2 cluster (200x200, centres 260 apart,
 * x -700..280, y -250..210); F1..F10 sit in two rows below it (y 250..700), five per row.
 */
export function undoBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const colours = ['yellow', 'blue', 'pink', 'green'] as const;
  const add = (text: string, x: number, y: number, i: number) => {
    const id = createSticky(doc, { x, y });
    getStickyText(doc, id)!.insert(0, text);
    setStickyColor(doc, id, colours[i % colours.length]);
  };
  for (let i = 0; i < 8; i++) add(`C${i + 1}`, -600 + (i % 4) * 260, i < 4 ? -150 : 110, i);
  for (let i = 0; i < 10; i++) add(`F${i + 1}`, -520 + (i % 5) * 260, i < 5 ? 350 : 600, i);
  return doc;
}
