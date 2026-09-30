import { useCallback, useEffect, useState } from 'react';

/** The active board tool (story 9). Stories 10–12 add their tools here. */
export type Tool = 'select' | 'text';

export interface ToolApi {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Per-client active tool, never persisted (text.tool_ui). Text needs an
 * editable board: while `canEdit` is false it cannot be chosen and an active
 * Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: Tool) => {
      if (t === 'text' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );
  return { tool: canEdit ? tool : 'select', setTool };
}
