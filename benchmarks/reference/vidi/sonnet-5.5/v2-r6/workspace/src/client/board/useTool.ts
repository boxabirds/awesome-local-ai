import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text'; // stories 10-12 extend

/** The active board tool (per client, not persisted). Text needs an editable board. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback((t: Tool) => {
    setToolState(t === 'select' || canEdit ? t : 'select');
  }, [canEdit]);
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  return { tool: canEdit ? tool : 'select', setTool };
}
