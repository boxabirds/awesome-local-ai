import { useCallback, useEffect, useState } from 'react';

/**
 * Active tool (story 9, text.tool). 'select' is the default; 'text' creates a
 * text object on the next board click. Stories 10-12 add more tools here.
 *
 * The tool is per-client state (never persisted). While the board cannot be
 * edited (story 4 load-failure), an active Text tool reverts to Select and
 * the Text button is disabled (text.not_editable).
 */
export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback((t: Tool) => setToolState(t), []);
  // Edit lock: an active Text tool reverts to Select (text.not_editable).
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);
  return { tool, setTool };
}
