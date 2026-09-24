import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { screenToWorld } from '../canvas/camera';
import type { Point, Size } from '../canvas/camera';
import type { CameraApi } from '../canvas/useCamera';
import { createSticky } from '../../shared/board-model';
import type { Selection } from './useSelection';

export interface BoardActions {
  /**
   * Create a sticky note centred on a screen point (inside the board area),
   * then select and start editing it.
   */
  createAtScreenPoint(p: Point): void;
  /** Create a sticky note centred in the visible board area. */
  createAtCentre(): void;
}

/**
 * Note-creation wiring shared by App and the component-test harness, so the
 * behaviour (centre conversion, select + start-edit) has one implementation.
 */
export function useBoardActions(args: { doc: Y.Doc; api: CameraApi; size: Size; selection: Selection }): BoardActions {
  const { doc, selection } = args;
  const apiRef = useRef(args.api);
  apiRef.current = args.api;
  const sizeRef = useRef(args.size);
  sizeRef.current = args.size;

  const createAtScreenPoint = useCallback(
    (p: Point) => {
      const world = screenToWorld(apiRef.current.camera, p);
      const id = createSticky(doc, world);
      if (id !== '') {
        selection.select(id);
        selection.startEdit(id);
      }
    },
    [doc, selection],
  );

  const createAtCentre = useCallback(() => {
    createAtScreenPoint({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });
  }, [createAtScreenPoint]);

  return { createAtScreenPoint, createAtCentre };
}
