import { useState, useEffect, useCallback } from 'react';
import type { Tool as ToolType } from '@/client/board/useTool';

/** Active tool types. Stories 10-12 extend this union. */
export type Tool = 'select' | 'text';

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
