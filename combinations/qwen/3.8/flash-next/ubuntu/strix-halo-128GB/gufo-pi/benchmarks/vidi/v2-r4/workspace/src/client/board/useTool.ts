/**
 * useTool: active tool state for the board (select | text).
 *
 * When canEdit turns false an active Text tool reverts to Select.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text'; // stories 10-12 extend

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  // When canEdit becomes false, revert to Select
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback(
    (t: Tool) => {
      // Cannot activate a non-select tool when !canEdit
      if (!canEdit && t !== 'select') return;
      setToolState(t);
    },
    [canEdit],
  );

  return { tool, setTool };
}
