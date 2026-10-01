import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-client tool mode. Stories 10–12 add their tools.
 * `select` is the default.
 *
 * When `canEdit` becomes false while any non-select tool is active, reverts to 'select'.
 */
export type Tool = 'select' | 'text' | 'shape' | 'connector';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((t: Tool): void => {
    if (t === 'text' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  // Revert to select when canEdit becomes false
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  return { tool, setTool };
}
