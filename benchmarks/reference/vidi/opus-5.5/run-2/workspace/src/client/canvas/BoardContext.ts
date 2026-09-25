import { createContext, useContext } from 'react';
import type { CameraApi } from './useCamera';
import type { Size } from './camera';

export interface BoardContextValue {
  board: CameraApi;
  /** Reports the measured size of the board area. */
  setViewport(size: Size): void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext);
  if (value === null) throw new Error('useBoard must be used inside BoardContext');
  return value;
}
