/**
 * Story 10: the board's shared context — the per-connector extras the object
 * registry can't carry in ObjectProps (the live camera, the board's identity
 * id, and the ends-changed callback). Provided by Board, consumed by
 * ConnectorObject through a registry bridge.
 */
import { createContext, useContext } from 'react';
import type { Camera } from '../canvas/camera';

export interface BoardContextValue {
  camera: Camera;
  /** The board's identity id (createdBy). */
  identity: string;
  /** Keeps the board in sync after a connector re-attach. */
  onEndsChanged(): void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

/** The board context; throws when a board object renders outside a Board. */
export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('BoardContext is missing — render objects inside <Board>');
  return ctx;
}
