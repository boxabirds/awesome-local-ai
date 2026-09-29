// The active tool (story 9). Per tab, never stored. Stories 10–12 add their tools.
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

/**
 * Active tool state: Select by default. Text can only be chosen while the board can be edited,
 * and an active Text tool returns to Select when the board becomes locked.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: Tool) => {
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );
  return { tool: canEdit ? tool : 'select', setTool };
}
