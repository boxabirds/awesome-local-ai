import { createContext, useContext } from 'react';
import type { UndoController } from './undo';

const UndoContext = createContext<UndoController | null>(null);

export const UndoProvider = UndoContext.Provider;

export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}
