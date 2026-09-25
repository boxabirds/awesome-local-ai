import { useCallback, useEffect, useState } from 'react';

/** The active board tool. Stories 10-12 add theirs. */
export type Tool = 'select' | 'text';

/**
 * This client's active tool (never persisted). Text needs an editable board: it cannot be chosen while the board
 * cannot be edited, and an active Text tool reverts to Select when editing becomes impossible.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
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
