/**
 * Tool mode hook (story 9, text.tool_ui).
 *
 * Active tool: 'select' | 'text'. Stories 10–12 add their tools.
 * When canEdit becomes false, an active Text tool reverts to Select.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  // If canEdit becomes false, revert to select
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback(
    (t: Tool) => {
      if (t === 'text' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  return { tool, setTool };
}
