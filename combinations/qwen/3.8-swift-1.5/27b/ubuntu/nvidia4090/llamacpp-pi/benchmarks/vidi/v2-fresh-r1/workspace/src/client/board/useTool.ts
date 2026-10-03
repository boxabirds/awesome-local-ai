// Active tool state (story 9): 'select' (default) or 'text'.
// Stories 10-12 extend the union. The Text tool is only available when the
// board is editable; when editing becomes unavailable an active Text tool
// reverts to Select.

import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  // Revert to Select when editing becomes unavailable.
  useEffect(() => {
    if (!canEdit && tool === 'text') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback(
    (t: Tool): void => {
      // The Text tool requires an editable board.
      if (t === 'text' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  return { tool, setTool };
}
