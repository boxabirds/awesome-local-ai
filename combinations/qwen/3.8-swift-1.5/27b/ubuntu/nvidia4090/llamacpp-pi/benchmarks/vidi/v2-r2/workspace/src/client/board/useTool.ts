import { useCallback, useEffect, useState } from 'react';

/**
 * Tool state (story 9). The board has a Select tool (story 7 default) and a
 * Text tool. `canEdit` false (a board that failed to load) reverts any active
 * tool to Select — a failed board must not be edited.
 */
export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // Revert to Select when the board becomes non-editable (load failed).
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  return { tool, setTool };
}
