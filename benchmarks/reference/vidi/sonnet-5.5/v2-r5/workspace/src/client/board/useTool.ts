import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text'; // stories 10-12 extend

/** Per-client active tool (never persisted). Text is only available while the board can be edited. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback((t: Tool) => setToolState(t), []);
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  return { tool: canEdit ? tool : 'select', setTool };
}
