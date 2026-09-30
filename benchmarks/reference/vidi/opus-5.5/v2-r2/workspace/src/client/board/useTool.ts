import { useCallback, useEffect, useState } from 'react';

/** The active board tool (per client, never persisted). Stories 10–12 add more. */
export type Tool = 'select' | 'text';

/**
 * Active tool state (text.tool_ui). The Text tool needs `canEdit`: it cannot be
 * chosen while the board cannot be edited, and an active Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [state, setState] = useState<Tool>('select');
  useEffect(() => {
    if (!canEdit) setState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: Tool) => {
      if (t === 'text' && !canEdit) return;
      setState(t);
    },
    [canEdit],
  );
  return { tool: canEdit ? state : 'select', setTool };
}
