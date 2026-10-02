/**
 * Tool mode state (story 9): 'select' | 'text'.
 * Stories 10-12 will extend the Tool type.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Per-client active tool state. When canEdit becomes false and tool is 'text',
 * reverts to 'select'.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // When canEdit becomes false, revert text to select
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  return { tool, setTool };
}
