import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text'; // stories 10-12 extend

/** The active board tool, local to this tab. Text needs an editable board and falls back to Select when editing stops. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: Tool) => {
      setToolState(t === 'text' && !canEdit ? 'select' : t);
    },
    [canEdit],
  );
  return { tool: canEdit ? tool : 'select', setTool };
}
