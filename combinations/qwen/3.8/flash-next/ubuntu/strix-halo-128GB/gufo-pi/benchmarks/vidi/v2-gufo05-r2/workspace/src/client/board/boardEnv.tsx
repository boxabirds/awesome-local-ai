/**
 * The board a registered object or an active tool can look at, beyond its own fields.
 *
 * The registry hands an object component its own snapshot, the document, the zoom and
 * the selection — which is enough for a sticky note, whose whole life is inside its own
 * map. Story 10's objects and tools need more than that:
 *
 * - A connector's line is not in its own record. It is derived from the current boxes of
 *   the objects at each end, so it needs the board's snapshot rects — and it needs the
 *   ones the board is drawing this frame, so that when somebody else moves a shape the
 *   arrow moves with it in the same render (story 3 delivers the change; the snapshot
 *   recomputes; nothing writes).
 * - A selected connector draws two end handles, and dragging one needs to know what is
 *   under the pointer at release: the same rects, plus the camera to convert.
 * - The Shape and Connector tools need the document, this page's identity and the same
 *   screen-to-board conversion the viewport uses, without BoardSurface having to hand
 *   each of them round.
 *
 * Passing all that through `ObjectProps` would mean changing every object in the registry
 * for the benefit of one type, so the board provides it once, as context. An object that
 * does not ask for it never sees it.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';

export interface BoardEnv {
  /** The camera this page is looking through, current as of this render. */
  camera: Camera;
  /** Every object on the board, as the board is drawing them right now. */
  objects: readonly ObjectSnapshot[];
  /** The box of every object by id — the same rects the selection chrome uses. */
  rects: ReadonlyMap<string, Rect>;
  /** The live board document. */
  doc: Y.Doc;
  /** Whether this page may change the board. */
  editable: boolean;
  /** What this page signs the objects it makes with (`createdBy`). */
  identity: string;
  /**
   * A screen point (CSS pixels from the top-left of the window) as a board point,
   * through the camera above. The board area fills the window, so the two origins
   * are the one point; this is the conversion, in the one place that knows the
   * camera, so nothing outside the viewport re-derives it.
   */
  toWorld(client: Point): Point;
}

const BoardEnvContext = createContext<BoardEnv | null>(null);

export function BoardEnvProvider({ value, children }: { value: BoardEnv; children: ReactNode }) {
  return <BoardEnvContext.Provider value={value}>{children}</BoardEnvContext.Provider>;
}

/** The board around this object, or null when it is rendered outside a board. */
export function useBoardEnv(): BoardEnv | null {
  return useContext(BoardEnvContext);
}
