import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text'; // stories 10-12 extend

/** The active board tool (per client, not persisted). Text is unavailable, and reverts to Select, while the board cannot be edited. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback(
    (next: Tool) => setToolState(next === 'select' || canEdit ? next : 'select'),
    [canEdit],
  );
  return { tool: canEdit ? tool : 'select', setTool };
}
