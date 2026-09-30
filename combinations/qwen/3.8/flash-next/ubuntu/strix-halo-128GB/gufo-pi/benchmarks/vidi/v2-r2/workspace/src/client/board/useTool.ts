import { useState, useEffect, useCallback, useRef } from 'react';

export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Manages the active tool mode. When canEdit becomes false, non-select tools
 * revert to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // Revert to Select when canEdit becomes false
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  const setTool = useCallback(
    (t: Tool) => {
      if (t !== 'select' && !canEditRef.current) return;
      setToolState(t);
    },
    [],
  );

  return { tool, setTool };
}
