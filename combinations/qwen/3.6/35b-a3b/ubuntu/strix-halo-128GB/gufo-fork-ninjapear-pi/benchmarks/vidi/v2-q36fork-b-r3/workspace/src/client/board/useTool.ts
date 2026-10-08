import { useState, useEffect, useCallback } from 'react';

export type Tool = 'select' | 'text';   // stories 10-12 extend later

interface UseToolReturn {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Hook for managing the active board tool.
 * When canEdit becomes false, reverts active Text to Select.
 */
export function useTool(canEdit: boolean): UseToolReturn {
  const [tool, setToolState] = useState<Tool>('select');

  // Revert to Select if editing is disabled
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
