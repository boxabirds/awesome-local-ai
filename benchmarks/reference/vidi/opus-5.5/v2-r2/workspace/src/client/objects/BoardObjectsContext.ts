import { createContext, useContext } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** The board's current objects snapshot, for components that hit-test other objects (arrow end handles). */
export const BoardObjectsContext = createContext<readonly ObjectSnapshot[]>([]);

export function useBoardObjects(): readonly ObjectSnapshot[] {
  return useContext(BoardObjectsContext);
}
