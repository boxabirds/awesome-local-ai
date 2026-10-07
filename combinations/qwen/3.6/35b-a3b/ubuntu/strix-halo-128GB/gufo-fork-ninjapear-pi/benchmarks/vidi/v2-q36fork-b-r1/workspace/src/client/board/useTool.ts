import { useState, useEffect, useCallback } from 'react';
import type { ToolId } from '@/client/tools/useActiveTool';

/** Active tool types — extends from useActiveTool in story 10+. */
export type Tool = ToolId;

interface UseToolReturn {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Hook for active tool state. When canEdit turns false, active Text reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolReturn {
  const [tool, setToolState] = useState<Tool>('select');

  // Revert to select when canEdit becomes false
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => {
    // If canEdit is false and someone tries to set text, ignore
    if (!canEdit && t === 'text') return;
    setToolState(t);
  }, [canEdit]);

  return { tool, setTool };
}
