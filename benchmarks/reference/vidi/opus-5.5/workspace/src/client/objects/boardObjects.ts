import { createContext, useContext } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Reads the board's current objects at the moment of the call (story 10: arrow end handles look
 * up the object under the pointer on release). A getter, not the list itself, so objects that
 * only need it during a gesture do not re-render on every board change.
 */
export type GetBoardObjects = () => readonly ObjectSnapshot[];

const NONE: readonly ObjectSnapshot[] = [];

export const BoardObjectsContext = createContext<GetBoardObjects>(() => NONE);

export function useBoardObjects(): GetBoardObjects {
  return useContext(BoardObjectsContext);
}
