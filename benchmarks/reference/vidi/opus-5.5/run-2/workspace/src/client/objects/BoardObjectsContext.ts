/**
 * Every object of the board and their rects, for components that depend on other objects
 * (story 10 arrows: attached ends and drop targets). Provided by App.
 */
import { createContext } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';

export interface BoardObjects {
  objects: readonly ObjectSnapshot[];
  /** Rects of every object that is not an arrow, by id. */
  rects: ReadonlyMap<string, Rect>;
}

export const BoardObjectsContext = createContext<BoardObjects>({ objects: [], rects: new Map() });
