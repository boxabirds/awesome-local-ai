import { useState, useCallback, useEffect } from 'react';

export type Tool =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen';

interface UseToolReturn {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Hook for managing the active board tool.
 * When canEdit becomes false, reverts editing tools to Select.
 */
export function useTool(canEdit: boolean): UseToolReturn {
  const [tool, setToolState] = useState<Tool>('select');

  // Revert to Select if editing is disabled
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit]);

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  return { tool, setTool };
}
