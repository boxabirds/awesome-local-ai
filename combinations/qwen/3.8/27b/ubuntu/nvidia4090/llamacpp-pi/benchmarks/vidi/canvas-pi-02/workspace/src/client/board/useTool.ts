/**
 * Board tool state (story 9, extended in story 10 and 11):
 * 'select' (default), 'text', 'shape', 'connector', 'pen'.
 * The tool determines what a click/drag on the board does.
 */

import { useCallback, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

export interface ToolState {
  tool: Tool;
  setTool: (tool: Tool) => void;
  /** The shape kind selected in the Shape menu (story 10). */
  shapeKind: ShapeKind;
  /** Change the shape kind (story 10). */
  setShapeKind: (k: ShapeKind) => void;
}

export function useTool(canEdit: boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  const setTool = useCallback(
    (t: Tool) => {
      // The text/shape/connector/pen tools are only available when the board is editable.
      if ((t === 'text' || t === 'shape' || t === 'connector' || t === 'pen') && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  return { tool, setTool, shapeKind, setShapeKind };
}
