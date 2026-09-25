import { createContext } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

/** What an object needs to know about the rest of the board (story 10: arrow end handles find their target). */
export interface BoardContextValue {
  /** Every object on the board, in stacking order. */
  objects: readonly ObjectSnapshot[];
  /** The world point under a pointer's client coordinates. */
  toWorld(clientX: number, clientY: number): Point;
}

export const BoardContext = createContext<BoardContextValue>({
  objects: [],
  toWorld: (x, y) => ({ x, y }),
});
