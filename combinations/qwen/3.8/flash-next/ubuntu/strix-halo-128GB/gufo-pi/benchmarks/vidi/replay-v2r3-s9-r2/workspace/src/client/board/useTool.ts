import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The creation tool that is active on the board. Stories 10-12 extend this with
 * shape, arrow and pen tools; `select` is the default (stories 1-8 behaviour).
 */
export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Per-client tool state (never persisted). A board that cannot be edited has no
 * Text tool: an active Text tool reverts to Select the moment `canEdit` turns
 * false, and `setTool('text')` is ignored.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((next: Tool) => {
    if (next !== 'select' && !canEditRef.current) {
      setToolState('select');
      return;
    }
    setToolState(next);
  }, []);

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool, setTool };
}
