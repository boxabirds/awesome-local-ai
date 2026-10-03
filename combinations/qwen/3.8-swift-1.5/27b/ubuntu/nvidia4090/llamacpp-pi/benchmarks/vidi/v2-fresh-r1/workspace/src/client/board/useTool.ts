// Active tool state (story 9+): 'select' (default), 'text', 'shape', 'connector'.
// The Text/Shape/Connector tools are only available when the board is editable;
// when editing becomes unavailable an active non-select tool reverts to Select.

import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type Tool = 'select' | 'text' | 'shape' | 'connector';

export function useTool(canEdit: boolean): {
  tool: Tool;
  shapeKind: ShapeKind;
  setTool(t: Tool): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
  onToolCreated: (select: (id: string) => void) => void;
} {
  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [selectRef, setSelectRef] = useState<((id: string) => void) | null>(null);

  // Revert to Select when editing becomes unavailable.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback(
    (t: Tool): void => {
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  /** Called by tools after creating an object: selects it and returns to Select. */
  const toolCreated = useCallback(
    (id: string): void => {
      selectRef?.(id);
      setToolState('select');
    },
    [selectRef],
  );

  /** Register the selection callback (called by BoardContent). */
  const onToolCreated = useCallback(
    (select: (id: string) => void): void => {
      setSelectRef(select);
    },
    [],
  );

  return { tool, shapeKind, setTool, setShapeKind, toolCreated, onToolCreated };
}
