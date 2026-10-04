/**
 * Tool mode hook (story 9). Manages the active tool state: 'select' | 'text'.
 * Stories 10-12 will add more tools.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

interface UseToolResult {
  tool: Tool;
  setTool: (t: Tool) => void;
}

/**
 * Hook that manages the active tool state.
 * - When `canEdit` turns false, an active Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  // When canEdit becomes false, revert to select
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  return { tool, setTool };
}
