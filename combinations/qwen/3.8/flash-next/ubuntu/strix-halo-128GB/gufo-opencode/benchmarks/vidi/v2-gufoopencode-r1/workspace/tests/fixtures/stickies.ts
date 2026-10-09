import type * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';

// createSticky refuses non-finite positions; in tests that is always a bug.
export function makeSticky(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x, y });
  if (id === false) throw new Error(`createSticky rejected (${x}, ${y})`);
  return id;
}
