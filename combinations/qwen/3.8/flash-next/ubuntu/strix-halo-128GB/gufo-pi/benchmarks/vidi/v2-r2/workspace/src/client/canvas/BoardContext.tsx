import { createContext, useContext } from 'react';
import type { Size } from '@client/canvas/camera';
import type { CameraApi } from '@client/canvas/useCamera';

export interface BoardValue extends CameraApi {
  viewport: Size;
}

export const BoardContext = createContext<BoardValue | null>(null);

// Access the shared board camera from anywhere inside <BoardViewport>.
export function useBoard(): BoardValue {
  const value = useContext(BoardContext);
  if (!value) {
    throw new Error('useBoard must be used within a <BoardViewport>');
  }
  return value;
}
