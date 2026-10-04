import { createContext, useContext, type ReactNode } from 'react';
import type { Doc } from 'yjs';
import type { Camera } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { UndoController } from './undo';

/**
 * What the board hands to the things inside it that are not objects.
 *
 * The document, the right to write to it, this person's undo history, and where everything on the
 * board is. The last of those four is the reason this exists at all: a tool that draws an arrow has
 * to know where the shapes are to know which side of one the arrow is pointing at, and a tool is not
 * an object - it is not in the snapshot, it has no id, and so it is not handed anything by the loop
 * that renders objects. Passing the whole board's boxes down through props would mean every object
 * component carrying a map of every other object's box in its props, for the one type that needs it.
 *
 * It is a context and not a prop list because that is what "everything below here knows this" means.
 * It is read rather than subscribed to: the value is rebuilt whenever the snapshot is, so a component
 * that reads it re-renders with the board rather than ahead of it.
 */
export interface BoardServices {
  doc: Doc;
  /** False while the board could not be loaded: the tools stay armed but write nothing. */
  canEdit: boolean;
  /** This person's own undo history; `null` when there is no history to open a step in. */
  undo: UndoController | null;
  /** Everything on the board, in stacking order. */
  objects: readonly ObjectSnapshot[];
  /**
   * Where every object is, by id, in board units - the derived boxes included, which is what makes
   * this the map to hand to `resolveEndpoints`. A connector in here is where its two ends are, not
   * the box it was last stored with.
   */
  rects: ReadonlyMap<string, Rect>;
  /**
   * The camera: how far away the board is, and what it is looking at.
   *
   * An object is handed the zoom and not the camera, because nothing an object draws inside its own
   * box needs to know where that box is on the screen. A pointer being dragged over the board is the
   * exception: a screen position becomes a board position only with both halves, and the thing that
   * gets dragged (an arrow's end) is drawn by the one component that does not know where the board's
   * top-left is.
   */
  camera: Camera;
}

const BoardContext = createContext<BoardServices | null>(null);

export interface BoardProviderProps {
  services: BoardServices;
  children?: ReactNode;
}

export function BoardProvider({ services, children }: BoardProviderProps): ReactNode {
  return <BoardContext.Provider value={services}>{children}</BoardContext.Provider>;
}

/**
 * The board's services, or `null` when this component is not inside a board.
 *
 * `null` rather than a throw, because a component that cannot find its board is a component that was
 * mounted on its own - which is what a component test does when it mounts one tool in front of a
 * document of its own - and the honest answer to that is that there is no board to write to.
 */
export function useBoard(): BoardServices | null {
  return useContext(BoardContext);
}

/** Where everything is; empty when there is no board, which draws an arrow at its stored points. */
export function useBoardRects(): ReadonlyMap<string, Rect> {
  return useContext(BoardContext)?.rects ?? EMPTY_RECTS;
}

const EMPTY_RECTS: ReadonlyMap<string, Rect> = new Map<string, Rect>();
